-- =============================================================================
-- Migration 040 GERI ALMA: kampanya yalniz yillik plana (039 davranisi) doner.
-- ONCE kampanyayi kapatin ve bekleyen kampanyali aylik niyetlerin bitmesini (45 dk) bekleyin:
-- kampanyali AYLIK niyetler (campaign_code dolu, plan solo_monthly, status created) varken 039 eval'i bunlari tanimaz.
-- Kesinlesmis kampanya claim'leri / odemeler / niyetler KORUNUR. applies_to_all_plans sutunu denetim icin korunur.
-- =============================================================================
BEGIN;
DO $chk$
BEGIN
  IF EXISTS (SELECT 1 FROM public.billing_intents i JOIN public.billing_plans p ON p.code = i.plan_code
              WHERE i.campaign_code IS NOT NULL AND p.period = 'month' AND i.status = 'created'
                AND i.created_at > now() - interval '120 minutes') THEN
    RAISE EXCEPTION 'GERI ALMA DURDURULDU: odemesi suren kampanyali aylik niyet var; kampanyayi kapatip bekleyin.';
  END IF;
END
$chk$;
UPDATE public.billing_campaigns SET applies_to_all_plans = false, is_enabled = false, updated_at = now();
CREATE OR REPLACE FUNCTION public.billing_company_has_yearly_purchase(p_company_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_allow boolean;
BEGIN
  -- 1) Faturalama gecmisi: odenmis yillik niyet / manuel olmayan yillik abonelik / kesinlesmis kampanya
  IF EXISTS (SELECT 1 FROM public.billing_intents i JOIN public.billing_plans p ON p.code = i.plan_code
              WHERE i.company_id = p_company_id AND i.status = 'paid' AND p.period = 'year')
     OR EXISTS (SELECT 1 FROM public.billing_subscriptions s JOIN public.billing_plans p ON p.code = s.plan_code
                 WHERE s.company_id = p_company_id AND p.period = 'year' AND s.channel <> 'manual')
     OR EXISTS (SELECT 1 FROM public.billing_campaign_claims c
                 WHERE c.company_id = p_company_id AND c.status = 'consumed' AND NOT c.is_test) THEN
    RETURN true;
  END IF;
  -- 2) Super admin istisnasi
  SELECT o.allow INTO v_allow FROM public.billing_campaign_overrides o WHERE o.company_id = p_company_id;
  IF FOUND THEN RETURN NOT v_allow; END IF;
  -- 3) Varsayilan: ELLE verilmis aktif lisans (faturalama odemesi yok) ucretli sayilir. Deneme (trial) ve
  --    ozel erisim/hediye (is_pilot) sayilmaz. Hediye ise super admin allow=true koyar.
  RETURN EXISTS (
    SELECT 1 FROM public.companies c
     WHERE c.id = p_company_id AND lower(coalesce(c.plan_status, '')) = 'active'
       AND NOT EXISTS (SELECT 1 FROM public.billing_payments bp WHERE bp.company_id = c.id)
       AND NOT (coalesce(c.is_pilot, false) AND (c.pilot_until IS NULL OR c.pilot_until > now())));
END
$fn$;

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
  IF v_plan.period <> 'year' THEN RETURN v_base || jsonb_build_object('reason', 'not_yearly'); END IF;

  v_test := EXISTS (SELECT 1 FROM public.billing_test_companies t WHERE t.company_id = p_company_id);
  SELECT * INTO v_c FROM public.billing_campaigns
   WHERE plan_code = p_plan_code AND (is_enabled OR (qa_preview AND v_test))
     AND (starts_at IS NULL OR starts_at <= now()) AND (ends_at IS NULL OR ends_at > now())
   ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RETURN v_base || jsonb_build_object('reason', 'no_campaign'); END IF;

  IF NOT v_test THEN
    IF public.billing_company_has_yearly_purchase(p_company_id) THEN
      RETURN v_base || jsonb_build_object('reason', 'already_purchased_yearly');
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
  SELECT code INTO v_camp_code FROM public.billing_campaigns WHERE plan_code = p_plan_code ORDER BY created_at LIMIT 1;
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

CREATE OR REPLACE FUNCTION public.billing_campaign_public_status()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_c public.billing_campaigns%ROWTYPE;
  v_plan public.billing_plans%ROWTYPE;
BEGIN
  SELECT * INTO v_c FROM public.billing_campaigns c
   WHERE c.is_enabled AND (c.starts_at IS NULL OR c.starts_at <= now()) AND (c.ends_at IS NULL OR c.ends_at > now())
   ORDER BY c.created_at LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('active', false); END IF;
  SELECT * INTO v_plan FROM public.billing_plans WHERE code = v_c.plan_code AND is_active AND is_purchasable AND period = 'year';
  IF NOT FOUND THEN RETURN jsonb_build_object('active', false); END IF;
  IF public.billing_campaign_used(v_c.code) >= v_c.max_slots THEN RETURN jsonb_build_object('active', false); END IF;
  RETURN jsonb_build_object('active', true, 'campaign_code', v_c.code, 'plan_code', v_plan.code,
    'discount_percent', v_c.discount_percent, 'max_slots', v_c.max_slots, 'currency', v_plan.currency,
    'list_price_minor', v_plan.price_minor,
    'price_minor', round(v_plan.price_minor * (100 - v_c.discount_percent) / 100.0)::int);
END
$fn$;

DROP FUNCTION IF EXISTS public.billing_company_has_paid_purchase(uuid);
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
