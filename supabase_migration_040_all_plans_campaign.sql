-- =============================================================================
-- Migration 040: lansman kampanyasi TUM PerdePRO paketlerinde (aylik + yillik), ORTAK kontenjan
--
-- 039 uygulanmis ve DEGISTIRILMEDI; bu migration uzerine biner.
--   * Kampanya (billing_campaigns.applies_to_all_plans=true): %50 indirim, her planin ILK satin alinan donemi icin
--       aylik  499 TL -> 249,50 TL (24950 kurus) | yillik 4.990 TL -> 2.495 TL (249500 kurus), KDV dahil.
--   * Ilk 20 farkli isletme icin iki paket TEK kontenjani paylasir (claim anahtari: kampanya + isletme).
--   * Isletme kampanyadan YALNIZ bir kez, sectigi paketin ilk alimda yararlanir; aylik indirimi kullanan sonradan
--     yillik indirimi kullanamaz (ve tersi).
--   * Onceki ucretli satin alimi olan isletme (herhangi bir plan: basarili billing odemesi, odenmis niyet,
--     manuel olmayan abonelik, kesinlesmis kampanya, elle verilmis ucretli aktif lisans) dislanir.
--     Ucretsiz deneme ve ozel erisim/hediye satin alim sayilmaz (039 ile ayni; super admin istisnasi gecerli).
--   * Sonraki alimlar normal plan fiyati; otomatik yenileme yok.
--   * billing_campaign_public_status(): eski alanlar (yillik) KORUNUR + tum planlari iceren `plans` dizisi eklenir.
--   * Kampanya KAPALI (is_enabled) kalir; bu migration acmaz. Baslatilmis odemelerin tutari ve kesinlesme mantigi
--     (billing_apply_charge) degismez: eski "yillik satin alim" yardimcisi artik "herhangi ucretli satin alim"i kontrol eder.
-- ONKOSUL: 039.   GERI ALMA: supabase_migration_040_rollback.sql
-- =============================================================================
BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.billing_campaigns') IS NULL THEN RAISE EXCEPTION 'PREFLIGHT: migration 039 uygulanmamis.'; END IF;
  IF to_regprocedure('public.billing_create_intent(text,uuid,text,uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: 039 billing_create_intent yok.';
  END IF;
END
$pre$;

ALTER TABLE public.billing_campaigns ADD COLUMN IF NOT EXISTS applies_to_all_plans boolean NOT NULL DEFAULT false;
UPDATE public.billing_campaigns SET applies_to_all_plans = true,
       title = 'Lansmana özel: ilk 20 işletmeye tüm PerdePRO paketlerinde %50 indirim',
       updated_at = now()
 WHERE code = 'launch_solo_yearly_50';

-- Herhangi bir plandaki onceki ucretli satin alim (ucretsiz deneme / hediye sayilmaz).
CREATE OR REPLACE FUNCTION public.billing_company_has_paid_purchase(p_company_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_allow boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM public.billing_payments bp
              WHERE bp.company_id = p_company_id AND bp.kind = 'charge' AND bp.status IN ('succeeded','refunded'))
     OR EXISTS (SELECT 1 FROM public.billing_intents i WHERE i.company_id = p_company_id AND i.status = 'paid')
     OR EXISTS (SELECT 1 FROM public.billing_subscriptions s
                 WHERE s.company_id = p_company_id AND s.channel <> 'manual' AND s.status <> 'pending')
     OR EXISTS (SELECT 1 FROM public.billing_campaign_claims c
                 WHERE c.company_id = p_company_id AND c.status = 'consumed' AND NOT c.is_test) THEN
    RETURN true;
  END IF;
  SELECT o.allow INTO v_allow FROM public.billing_campaign_overrides o WHERE o.company_id = p_company_id;
  IF FOUND THEN RETURN NOT v_allow; END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.companies c
     WHERE c.id = p_company_id AND lower(coalesce(c.plan_status, '')) = 'active'
       AND NOT EXISTS (SELECT 1 FROM public.billing_payments bp WHERE bp.company_id = c.id)
       AND NOT (coalesce(c.is_pilot, false) AND (c.pilot_until IS NULL OR c.pilot_until > now())));
END
$fn$;

-- 039'un billing_apply_charge / eval / durum fonksiyonlari bu adi cagirir; anlami artik "herhangi ucretli alim".
CREATE OR REPLACE FUNCTION public.billing_company_has_yearly_purchase(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT public.billing_company_has_paid_purchase(p_company_id)
$fn$;

REVOKE ALL ON FUNCTION public.billing_company_has_paid_purchase(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_company_has_paid_purchase(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.billing_campaign_eval(p_company_id uuid, p_plan_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_plan public.billing_plans%ROWTYPE;
  v_c public.billing_campaigns%ROWTYPE;
  v_test boolean;
  v_base jsonb;
BEGIN
  SELECT * INTO v_plan FROM public.billing_plans WHERE code = p_plan_code;
  IF NOT FOUND THEN RETURN jsonb_build_object('applied', false, 'reason', 'unknown_plan'); END IF;
  v_base := jsonb_build_object('applied', false, 'plan_code', v_plan.code, 'currency', v_plan.currency,
                               'list_price_minor', v_plan.price_minor, 'amount_minor', v_plan.price_minor);

  v_test := EXISTS (SELECT 1 FROM public.billing_test_companies t WHERE t.company_id = p_company_id);
  SELECT * INTO v_c FROM public.billing_campaigns
   WHERE (plan_code = p_plan_code OR applies_to_all_plans) AND (is_enabled OR (qa_preview AND v_test))
     AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())
   ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RETURN v_base || jsonb_build_object('reason', 'no_campaign'); END IF;

  IF NOT v_test THEN
    IF public.billing_company_has_paid_purchase(p_company_id) THEN
      RETURN v_base || jsonb_build_object('reason', 'already_purchased');
    END IF;
    IF public.billing_campaign_used(v_c.code, p_company_id) >= v_c.max_slots THEN
      RETURN v_base || jsonb_build_object('reason', 'sold_out');
    END IF;
  END IF;

  RETURN v_base || jsonb_build_object(
    'applied', true, 'reason', 'ok', 'campaign_code', v_c.code, 'discount_percent', v_c.discount_percent,
    'max_slots', v_c.max_slots, 'payment_timeout_minutes', v_c.payment_timeout_minutes,
    'reservation_minutes', v_c.payment_timeout_minutes + v_c.reservation_grace_minutes,
    'amount_minor', round(v_plan.price_minor * (100 - v_c.discount_percent) / 100.0)::int);
END
$fn$;

-- Odeme niyeti: kampanya kilidi artik planin degil KAMPANYANIN (tum planlar) uzerinden.
CREATE OR REPLACE FUNCTION public.billing_create_intent(
  p_channel text, p_company_id uuid, p_plan_code text, p_created_by uuid, p_expected_amount_minor integer DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_plan public.billing_plans%ROWTYPE;
  v_id uuid;
  v_test boolean;
  v_camp_code text;
  v_ev jsonb;
  v_amount integer;
  v_applied boolean;
  v_swept record;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: yalnizca sunucu cagrisi'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.billing_test_companies t WHERE t.company_id = p_company_id) INTO v_test;
  SELECT * INTO v_plan FROM public.billing_plans
   WHERE code = p_plan_code AND is_active AND (is_purchasable OR v_test);
  IF NOT FOUND THEN RAISE EXCEPTION 'PERDEPRO_NOT_FOUND: plan'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id) THEN RAISE EXCEPTION 'PERDEPRO_NOT_FOUND: firma'; END IF;

  -- Eszamanli istekleri seri hale getir: kontenjan kontrolu + rezervasyon ayni kilit altinda.
  SELECT code INTO v_camp_code FROM public.billing_campaigns WHERE plan_code = p_plan_code OR applies_to_all_plans ORDER BY created_at LIMIT 1;
  IF v_camp_code IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('perdepro_campaign:' || v_camp_code, 0));
    -- Suresi dolan rezervasyonlari serbest birak (ve bekleyen niyetlerini kapat).
    FOR v_swept IN
      UPDATE public.billing_campaign_claims SET status = 'expired', released_at = now(), release_reason = 'reservation_expired'
       WHERE campaign_code = v_camp_code AND status = 'reserved' AND reserved_until <= now()
       RETURNING intent_id
    LOOP
      UPDATE public.billing_intents SET status = 'expired' WHERE id = v_swept.intent_id AND status = 'created';
    END LOOP;
  END IF;

  v_ev := public.billing_campaign_eval(p_company_id, p_plan_code);
  v_applied := coalesce((v_ev ->> 'applied')::boolean, false);
  v_amount := CASE WHEN v_applied THEN (v_ev ->> 'amount_minor')::int ELSE v_plan.price_minor END;

  -- Gosterilen fiyat degistiyse (or. kontenjan doldu) odeme BASLATILMAZ; istemci yeni fiyati gosterir.
  -- Beklenen tutar yalniz bir ONAY korumasidir, fiyati asla belirlemez.
  IF p_expected_amount_minor IS NOT NULL AND p_expected_amount_minor <> v_amount THEN
    RAISE EXCEPTION 'PERDEPRO_PRICE_CHANGED: %', v_amount;
  END IF;

  INSERT INTO public.billing_intents(company_id, plan_code, channel, amount_minor, currency, created_by, list_price_minor, campaign_code)
  VALUES (p_company_id, p_plan_code, p_channel, v_amount, v_plan.currency, p_created_by, v_plan.price_minor,
          CASE WHEN v_applied THEN v_ev ->> 'campaign_code' END)
  RETURNING id INTO v_id;

  IF v_applied THEN
    -- Ayni isletmenin onceki aktif rezervasyonunu devral (tek aktif rezervasyon).
    UPDATE public.billing_intents SET status = 'expired'
     WHERE status = 'created' AND id IN (
       SELECT intent_id FROM public.billing_campaign_claims
        WHERE campaign_code = v_ev ->> 'campaign_code' AND company_id = p_company_id AND status = 'reserved' AND NOT is_test);
    UPDATE public.billing_campaign_claims SET status = 'released', released_at = now(), release_reason = 'superseded'
     WHERE campaign_code = v_ev ->> 'campaign_code' AND company_id = p_company_id AND status = 'reserved' AND NOT is_test;

    INSERT INTO public.billing_campaign_claims(campaign_code, company_id, intent_id, status, is_test, list_price_minor, amount_minor, reserved_until)
    VALUES (v_ev ->> 'campaign_code', p_company_id, v_id, 'reserved', v_test, v_plan.price_minor, v_amount,
            now() + make_interval(mins => (v_ev ->> 'reservation_minutes')::int));
  END IF;

  RETURN jsonb_build_object(
    'intent_id', v_id, 'amount_minor', v_amount, 'list_price_minor', v_plan.price_minor, 'currency', v_plan.currency,
    'plan_name', v_plan.name, 'campaign_code', CASE WHEN v_applied THEN v_ev ->> 'campaign_code' END,
    'payment_timeout_minutes', CASE WHEN v_applied THEN (v_ev ->> 'payment_timeout_minutes')::int ELSE 30 END);
END
$fn$;

-- Herkese acik durum: eski (yillik) alanlar korunur; tum planlar `plans` dizisinde.
CREATE OR REPLACE FUNCTION public.billing_campaign_public_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_c public.billing_campaigns%ROWTYPE;
  v_yearly public.billing_plans%ROWTYPE;
  v_plans jsonb;
BEGIN
  SELECT * INTO v_c FROM public.billing_campaigns c
   WHERE c.is_enabled AND (c.starts_at IS NULL OR c.starts_at <= now()) AND (c.ends_at IS NULL OR c.ends_at > now())
   ORDER BY c.created_at LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('active', false); END IF;
  IF public.billing_campaign_used(v_c.code) >= v_c.max_slots THEN RETURN jsonb_build_object('active', false); END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'plan_code', p.code, 'period', p.period, 'currency', p.currency, 'list_price_minor', p.price_minor,
           'price_minor', round(p.price_minor * (100 - v_c.discount_percent) / 100.0)::int) ORDER BY p.sort_order), '[]'::jsonb)
    INTO v_plans
    FROM public.billing_plans p
   WHERE p.is_active AND p.is_purchasable AND (p.code = v_c.plan_code OR v_c.applies_to_all_plans);
  IF jsonb_array_length(v_plans) = 0 THEN RETURN jsonb_build_object('active', false); END IF;

  SELECT * INTO v_yearly FROM public.billing_plans WHERE code = 'solo_yearly' AND is_active AND is_purchasable;
  RETURN jsonb_build_object('active', true, 'campaign_code', v_c.code, 'all_plans', v_c.applies_to_all_plans,
    'discount_percent', v_c.discount_percent, 'max_slots', v_c.max_slots, 'plans', v_plans)
    || CASE WHEN v_yearly.code IS NULL THEN '{}'::jsonb ELSE jsonb_build_object(
         'plan_code', v_yearly.code, 'currency', v_yearly.currency, 'list_price_minor', v_yearly.price_minor,
         'price_minor', round(v_yearly.price_minor * (100 - v_c.discount_percent) / 100.0)::int) END;
END
$fn$;

REVOKE ALL ON FUNCTION public.billing_campaign_eval(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_campaign_eval(uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.billing_create_intent(text, uuid, text, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_create_intent(text, uuid, text, uuid, integer) TO service_role;
REVOKE ALL ON FUNCTION public.billing_campaign_public_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.billing_campaign_public_status() TO anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.billing_company_has_yearly_purchase(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_company_has_yearly_purchase(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
