-- =============================================================================
-- Migration 039: "Lansmana ozel" yillik paket kampanyasi (ilk 20 isletme, %50)
--
-- KURALLAR (sunucuda zorlanir; istemciden gelen fiyat/indirim HICBIR yerde kullanilmaz)
--   * Yalniz yillik plan (period='year'), isletmenin ilk yillik satin alimi, ilk N (varsayilan 20) isletme.
--   * Fiyat = plan fiyati x (100 - indirim%) / 100  -> 4.990 TL plan icin 2.495 TL (249500 kurus).
--     Aylik paket ve diger tum planlar aynen kalir.
--   * Odeme baslatilirken (billing_create_intent) SURELI REZERVASYON alinir; rezervasyon bekleyen odemeleri
--     de kontenjana sayar. Kontenjani yalniz DOGRULANMIS BASARILI odeme (billing_apply_charge) kesinlestirir.
--     Basarisiz / iptal / suresi dolan / TEST odemeleri kontenjan tuketmez.
--   * Tutar billing_intents.amount_minor'da SABITLENIR; kampanya sonradan dolsa / kapansa bile o odemenin
--     tutari degismez ve o tutarla gelen dogrulanmis bildirim kabul edilir.
--   * Rezervasyon suresi = PayTR odeme suresi (timeout_limit) + tampon (varsayilan 30 + 15 dk).
--   * Gec gelen bildirim: kontenjan hala bos ve isletme daha once yararlanmadiysa kesinlestirilir;
--     degilse lisans ACILMAZ, olay 'rejected_campaign_unavailable_refund_required' olarak kaydedilir
--     (PayTR panelinden iade gerekir) -- fazla satis ve yanlis tahsilat sessizce gecmez.
--   * Elle verilmis ucretli yillik lisans (billing kaydi olmayan AKTIF lisans) isletmeyi kampanyadan dislar;
--     ucretsiz deneme ve "ozel erisim" (hediye) dislamaz. Super admin istisna koyabilir (billing_campaign_overrides).
--   * Para tahsil edilip kampanya artik gecerli degilse billing_refund_cases'e ACIK IADE KAYDI acilir; super admin
--     listeler/kapatir, firma yoneticisi kendi kaydini gorur (musteriye "basarili" mesaji gosterilmez).
--   * Kampanya yonetici (super admin) veya SQL ile kapatilabilir: billing_campaign_set_enabled().
--   * KAMPANYA VARSAYILAN KAPALI (is_enabled=false) olusur; acmak ayri, bilincli bir adimdir.
--
-- NE YAPMAZ: mevcut odeme / abonelik / lisans / plan satirlarini DEGISTIRMEZ (yalniz yeni sutun/tablo ekler;
--   billing_plans fiyatlari aynen kalir).
-- ONKOSUL: 033, 034, 035, 036.   GERI ALMA: supabase_migration_039_rollback.sql
-- =============================================================================
BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.billing_plans') IS NULL OR to_regclass('public.billing_intents') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: migration 033 uygulanmamis.';
  END IF;
  IF to_regprocedure('public.billing_apply_charge(text,text,uuid,text,text,integer,text,text,jsonb,boolean)') IS NULL
     OR to_regprocedure('public.billing_create_intent(text,uuid,text,uuid)') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: billing RPC''leri yok (033-036).';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.billing_plans WHERE code = 'solo_yearly' AND period = 'year') THEN
    RAISE EXCEPTION 'PREFLIGHT: solo_yearly plani yok (034).';
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------
-- 1) Tablolar
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.billing_campaigns (
  code text PRIMARY KEY,
  plan_code text NOT NULL REFERENCES public.billing_plans(code),
  title text NOT NULL,
  discount_percent smallint NOT NULL CHECK (discount_percent BETWEEN 1 AND 99),
  max_slots integer NOT NULL CHECK (max_slots > 0),
  payment_timeout_minutes integer NOT NULL DEFAULT 30 CHECK (payment_timeout_minutes BETWEEN 5 AND 120),
  reservation_grace_minutes integer NOT NULL DEFAULT 15 CHECK (reservation_grace_minutes BETWEEN 5 AND 240),
  is_enabled boolean NOT NULL DEFAULT false,
  -- QA onizleme: is_enabled=false iken kampanya YALNIZ billing_test_companies firmalari icin uygulanir (genel kullanima acmadan test).
  qa_preview boolean NOT NULL DEFAULT false,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.billing_intents ADD COLUMN IF NOT EXISTS list_price_minor integer;
ALTER TABLE public.billing_intents ADD COLUMN IF NOT EXISTS campaign_code text REFERENCES public.billing_campaigns(code);

CREATE TABLE IF NOT EXISTS public.billing_campaign_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_code text NOT NULL REFERENCES public.billing_campaigns(code),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  intent_id uuid NOT NULL UNIQUE REFERENCES public.billing_intents(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('reserved','consumed','released','expired')),
  is_test boolean NOT NULL DEFAULT false,
  list_price_minor integer NOT NULL,
  amount_minor integer NOT NULL,
  reserved_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  released_at timestamptz,
  release_reason text
);
-- Bir isletme kampanyadan en fazla bir kez yararlanir; ayni anda tek aktif rezervasyon.
CREATE UNIQUE INDEX IF NOT EXISTS billing_campaign_one_consumed_per_company
  ON public.billing_campaign_claims(campaign_code, company_id) WHERE status = 'consumed' AND NOT is_test;
CREATE UNIQUE INDEX IF NOT EXISTS billing_campaign_one_reserved_per_company
  ON public.billing_campaign_claims(campaign_code, company_id) WHERE status = 'reserved' AND NOT is_test;
CREATE INDEX IF NOT EXISTS billing_campaign_claims_count_idx
  ON public.billing_campaign_claims(campaign_code, status) WHERE NOT is_test;

ALTER TABLE public.billing_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_campaign_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_campaigns, public.billing_campaign_claims FROM PUBLIC, anon, authenticated;
-- Firma yoneticisi yalniz KENDI firmasinin kampanya kayitlarini okuyabilir; yazma yalniz RPC / service_role.
DROP POLICY IF EXISTS billing_campaign_claims_read ON public.billing_campaign_claims;
CREATE POLICY billing_campaign_claims_read ON public.billing_campaign_claims FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_company_admin(company_id));
GRANT SELECT ON public.billing_campaign_claims TO authenticated;

-- Super admin istisnasi: allow=false -> elle verilmis ucretli yillik lisans (kampanya YOK);
--                        allow=true  -> hediye/ucretsiz erisim (otomatik tespit yanlis dislasa bile kampanya VAR).
CREATE TABLE IF NOT EXISTS public.billing_campaign_overrides (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  allow boolean NOT NULL,
  note text,
  set_by uuid,
  set_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.billing_campaign_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_campaign_overrides FROM PUBLIC, anon, authenticated;

-- Tahsil edildi ama lisans/kampanya uygulanamadi -> manuel iade takibi.
CREATE TABLE IF NOT EXISTS public.billing_refund_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  intent_id uuid NOT NULL UNIQUE REFERENCES public.billing_intents(id) ON DELETE CASCADE,
  event_id uuid,
  provider_ref text NOT NULL,
  amount_minor integer NOT NULL,
  currency text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','refunded','dismissed')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid
);
CREATE INDEX IF NOT EXISTS billing_refund_cases_open_idx ON public.billing_refund_cases(status, created_at);
ALTER TABLE public.billing_refund_cases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_refund_cases FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS billing_refund_cases_read ON public.billing_refund_cases;
CREATE POLICY billing_refund_cases_read ON public.billing_refund_cases FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_company_admin(company_id));
GRANT SELECT ON public.billing_refund_cases TO authenticated;

-- Varsayilan KAPALI. Fiyat plandan hesaplanir; burada fiyat saklanmaz.
INSERT INTO public.billing_campaigns (code, plan_code, title, discount_percent, max_slots, is_enabled)
VALUES ('launch_solo_yearly_50', 'solo_yearly', 'Lansmana özel: ilk 20 işletmeye yıllık pakette %50 indirim', 50, 20, false)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) Dahili yardimcilar (istemciye acik DEGIL)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_campaign_used(p_code text, p_exclude_company uuid DEFAULT NULL)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT count(*)::int FROM public.billing_campaign_claims c
   WHERE c.campaign_code = p_code AND NOT c.is_test
     AND (c.status = 'consumed' OR (c.status = 'reserved' AND c.reserved_until > now()))
     AND (p_exclude_company IS NULL OR c.company_id <> p_exclude_company)
$fn$;

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

-- Kilitsiz degerlendirme: bu firma icin bu planin kampanyali fiyati nedir?
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

REVOKE ALL ON FUNCTION public.billing_campaign_used(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_company_has_yearly_purchase(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_campaign_eval(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_campaign_used(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_company_has_yearly_purchase(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_campaign_eval(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Odeme niyeti: fiyat + kampanya + rezervasyon (tek islem, kampanya kilidi altinda)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.billing_create_intent(text, uuid, text, uuid);
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
REVOKE ALL ON FUNCTION public.billing_create_intent(text, uuid, text, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_create_intent(text, uuid, text, uuid, integer) TO service_role;

-- Niyet basarisiz/iptal olunca rezervasyonu serbest birak (kesinlesmis olana dokunma).
CREATE OR REPLACE FUNCTION public.billing_mark_intent(p_intent_id uuid, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: yalnizca sunucu cagrisi'; END IF;
  IF p_status NOT IN ('paid','failed','expired') THEN RAISE EXCEPTION 'gecersiz durum'; END IF;
  UPDATE public.billing_intents SET status = p_status, paid_at = CASE WHEN p_status='paid' THEN now() ELSE paid_at END
   WHERE id = p_intent_id AND status IN ('created','failed');
  IF p_status IN ('failed','expired') THEN
    UPDATE public.billing_campaign_claims
       SET status = CASE p_status WHEN 'expired' THEN 'expired' ELSE 'released' END,
           released_at = now(), release_reason = 'payment_' || p_status
     WHERE intent_id = p_intent_id AND status = 'reserved';
  END IF;
END
$fn$;
REVOKE ALL ON FUNCTION public.billing_mark_intent(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_mark_intent(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) Dogrulanmis odeme: tutar NIYETIN sabit tutariyla karsilastirilir; kontenjan burada kesinlesir
--    (035 govdesinin uzerine; imza ayni)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.billing_apply_charge(
  p_channel text, p_event_id text, p_company_id uuid, p_plan_code text,
  p_provider_payment_id text, p_amount_minor integer, p_currency text,
  p_provider_subscription_ref text DEFAULT NULL, p_payload jsonb DEFAULT '{}'::jsonb,
  p_test_mode boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_plan public.billing_plans%ROWTYPE;
  v_company public.companies%ROWTYPE;
  v_intent public.billing_intents%ROWTYPE;
  v_claim public.billing_campaign_claims%ROWTYPE;
  v_event_id uuid;
  v_base timestamptz;
  v_end timestamptz;
  v_sub_id uuid;
  v_inserted int;
  v_pay_id uuid;
  v_hex text;
  v_expected integer;
  v_camp public.billing_campaigns%ROWTYPE;
  v_used_other int;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: yalnizca sunucu cagrisi'; END IF;

  INSERT INTO public.billing_events(channel, provider_event_id, event_type, company_id, payload)
  VALUES (p_channel, p_event_id, 'charge.succeeded', p_company_id, coalesce(p_payload,'{}'::jsonb))
  ON CONFLICT (channel, provider_event_id) DO NOTHING
  RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN RETURN jsonb_build_object('status','duplicate'); END IF;

  SELECT * INTO v_plan FROM public.billing_plans WHERE code = p_plan_code AND is_active;
  IF NOT FOUND THEN
    UPDATE public.billing_events SET outcome='rejected_unknown_plan', processed_at=now(),
      provider_event_id = provider_event_id || ':rejected_unknown_plan:' || id::text WHERE id=v_event_id;
    RETURN jsonb_build_object('status','rejected','reason','unknown_plan');
  END IF;

  -- Niyet: merchant_oid = 'PRD' + niyet UUID'si (tire'siz). Beklenen tutar NIYETTE sabitlenmis tutardir.
  IF p_channel = 'paytr' AND p_provider_payment_id ~* '^PRD[0-9a-f]{32}$' THEN
    v_hex := lower(substr(p_provider_payment_id, 4));
    SELECT * INTO v_intent FROM public.billing_intents
     WHERE id = (substr(v_hex,1,8)||'-'||substr(v_hex,9,4)||'-'||substr(v_hex,13,4)||'-'||substr(v_hex,17,4)||'-'||substr(v_hex,21))::uuid
     FOR UPDATE;
    IF FOUND AND (v_intent.company_id IS DISTINCT FROM p_company_id OR v_intent.plan_code IS DISTINCT FROM p_plan_code) THEN
      UPDATE public.billing_events SET outcome='rejected_intent_mismatch', processed_at=now(),
        provider_event_id = provider_event_id || ':rejected_intent_mismatch:' || id::text WHERE id=v_event_id;
      RETURN jsonb_build_object('status','rejected','reason','intent_mismatch');
    END IF;
  END IF;
  v_expected := CASE WHEN v_intent.id IS NOT NULL THEN v_intent.amount_minor ELSE v_plan.price_minor END;

  IF p_amount_minor IS DISTINCT FROM v_expected OR upper(p_currency) IS DISTINCT FROM v_plan.currency THEN
    UPDATE public.billing_events SET outcome='rejected_amount_mismatch', processed_at=now(),
      provider_event_id = provider_event_id || ':rejected_amount_mismatch:' || id::text WHERE id=v_event_id;
    RETURN jsonb_build_object('status','rejected','reason','amount_mismatch');
  END IF;

  -- Kampanyali niyet: ONCE kampanya kilidi, SONRA firma satiri (create_intent ile ayni sira; kilitlenme yok).
  IF v_intent.campaign_code IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('perdepro_campaign:' || v_intent.campaign_code, 0));
  END IF;

  SELECT * INTO v_company FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE public.billing_events SET outcome='rejected_unknown_company', processed_at=now(),
      provider_event_id = provider_event_id || ':rejected_unknown_company:' || id::text WHERE id=v_event_id;
    RETURN jsonb_build_object('status','rejected','reason','unknown_company');
  END IF;
  IF lower(coalesce(v_company.plan_status,'')) = 'suspended' THEN
    UPDATE public.billing_events SET outcome='blocked_suspended', processed_at=now(),
      provider_event_id = provider_event_id || ':blocked_suspended:' || id::text WHERE id=v_event_id;
    RETURN jsonb_build_object('status','blocked','reason','company_suspended');
  END IF;

  -- TEST modu odemesi: gercek firmanin lisansini ACMAZ ve kontenjan TUKETMEZ.
  IF coalesce(p_test_mode, false)
     AND NOT EXISTS (SELECT 1 FROM public.billing_test_companies t WHERE t.company_id = p_company_id) THEN
    UPDATE public.billing_campaign_claims SET status='released', released_at=now(), release_reason='test_payment'
     WHERE intent_id = v_intent.id AND status = 'reserved';
    UPDATE public.billing_events SET outcome='test_payment_no_license', processed_at=now(),
      provider_event_id = provider_event_id || ':test_payment_no_license:' || id::text WHERE id=v_event_id;
    RETURN jsonb_build_object('status','test_no_license');
  END IF;

  -- Kampanya kontenjani: yalniz dogrulanmis basarili odeme kesinlestirir.
  IF v_intent.campaign_code IS NOT NULL THEN
    SELECT * INTO v_claim FROM public.billing_campaign_claims WHERE intent_id = v_intent.id FOR UPDATE;
    IF FOUND AND v_claim.status <> 'consumed' AND NOT v_claim.is_test THEN
      SELECT * INTO v_camp FROM public.billing_campaigns WHERE code = v_intent.campaign_code;
      SELECT count(*)::int INTO v_used_other FROM public.billing_campaign_claims c
       WHERE c.campaign_code = v_intent.campaign_code AND NOT c.is_test AND c.id <> v_claim.id
         AND (c.status = 'consumed' OR (c.status = 'reserved' AND c.reserved_until > now()));
      IF v_used_other >= v_camp.max_slots
         OR public.billing_company_has_yearly_purchase(p_company_id) THEN
        -- Para tahsil edildi ama indirimli tutar artik gecerli degil: lisans ACILMAZ, iade gerekir.
        UPDATE public.billing_campaign_claims SET status='released', released_at=now(), release_reason='late_payment_unavailable'
         WHERE id = v_claim.id AND status <> 'released';
        INSERT INTO public.billing_refund_cases(company_id, intent_id, event_id, provider_ref, amount_minor, currency, reason)
        VALUES (p_company_id, v_intent.id, v_event_id, p_provider_payment_id, p_amount_minor, v_plan.currency, 'campaign_unavailable')
        ON CONFLICT (intent_id) DO NOTHING;
        UPDATE public.billing_events SET outcome='rejected_campaign_unavailable_refund_required', processed_at=now(),
          provider_event_id = provider_event_id || ':rejected_campaign_unavailable:' || id::text WHERE id=v_event_id;
        RETURN jsonb_build_object('status','rejected','reason','campaign_unavailable','refund_required',true);
      END IF;
    END IF;
  END IF;

  -- Ayni odeme ikinci kez gelirse HICBIR sey degismez: once odeme kaydi.
  INSERT INTO public.billing_payments(company_id, channel, provider_payment_id, kind, status, amount_minor, currency)
  VALUES (p_company_id, p_channel, p_provider_payment_id, 'charge', 'succeeded', p_amount_minor, v_plan.currency)
  ON CONFLICT (channel, provider_payment_id, kind) DO NOTHING
  RETURNING id INTO v_pay_id;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    UPDATE public.billing_events SET outcome='duplicate_payment', processed_at=now() WHERE id=v_event_id;
    RETURN jsonb_build_object('status','duplicate');
  END IF;

  IF v_claim.id IS NOT NULL AND v_claim.status <> 'consumed' THEN
    UPDATE public.billing_campaign_claims SET status='consumed', consumed_at=now(), released_at=NULL, release_reason=NULL
     WHERE id = v_claim.id;
  END IF;

  -- Erisim, kalan odenmis donem/deneme sonundan uzar; gecmisse simdiden baslar.
  v_base := greatest(now(), coalesce(
    CASE WHEN lower(coalesce(v_company.plan_status,'')) = 'active' THEN v_company.license_expires_at
         WHEN lower(coalesce(v_company.plan_status,'')) IN ('trial','') THEN v_company.trial_ends_at
    END, now()));
  v_end := ((v_base AT TIME ZONE 'Europe/Istanbul')
            + CASE v_plan.period WHEN 'year' THEN interval '1 year' ELSE interval '1 month' END)
           AT TIME ZONE 'Europe/Istanbul';

  SELECT id INTO v_sub_id FROM public.billing_subscriptions
   WHERE company_id = p_company_id AND status IN ('pending','active','past_due') FOR UPDATE;
  IF v_sub_id IS NULL THEN
    INSERT INTO public.billing_subscriptions(company_id, plan_code, channel, provider_subscription_ref, status, current_period_start, current_period_end)
    VALUES (p_company_id, p_plan_code, p_channel, p_provider_subscription_ref, 'active', v_base, v_end)
    RETURNING id INTO v_sub_id;
  ELSE
    UPDATE public.billing_subscriptions SET plan_code=p_plan_code, channel=p_channel,
      provider_subscription_ref=coalesce(p_provider_subscription_ref, provider_subscription_ref),
      status='active', current_period_end=v_end, updated_at=now() WHERE id=v_sub_id;
  END IF;

  UPDATE public.billing_payments SET subscription_id = v_sub_id, period_start = v_base, period_end = v_end WHERE id = v_pay_id;

  UPDATE public.companies SET plan_status='active', subscription_status='active', license_expires_at=v_end,
         package_code=v_plan.package_code,
         subscription_plan = CASE WHEN lower(v_plan.package_code) = 'solo' THEN 'solo' ELSE subscription_plan END,
         is_active = true, updated_at=now()
   WHERE id = p_company_id;

  UPDATE public.billing_events SET outcome='applied', processed_at=now() WHERE id=v_event_id;
  RETURN jsonb_build_object('status','applied','period_end',v_end,'subscription_id',v_sub_id);
END
$fn$;
REVOKE ALL ON FUNCTION public.billing_apply_charge(text,text,uuid,text,text,integer,text,text,jsonb,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_apply_charge(text,text,uuid,text,text,integer,text,text,jsonb,boolean) TO service_role;

-- billing_get_intent: kampanya alanlarini da dondur (callback gunlugu/denetim icin); eski kolonlar ayni.
-- (Donus tipi degisecegi icin yeniden olusturulmaz; callback yalnizca mevcut kolonlari kullanir.)

-- ---------------------------------------------------------------------------
-- 5) Istemciye acik RPC'ler
-- ---------------------------------------------------------------------------
-- (a) Uygulamadaki fiyat gosterimi: firma yoneticisi kendi firmasi icin sunucu kararini gorur.
CREATE OR REPLACE FUNCTION public.billing_campaign_quote(p_company_id uuid, p_plan_code text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT (public.is_super_admin() OR public.is_company_admin(p_company_id)) THEN
    RAISE EXCEPTION 'PERDEPRO_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  RETURN public.billing_campaign_eval(p_company_id, p_plan_code);
END
$fn$;

-- (b) Herkese acik web sitesi durumu: yalniz "gosterilsin mi" + fiyatlar. Kalan kontenjan SAYISI verilmez.
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

-- (c) Yonetici: kapat/ac. Oturumlu cagri yalniz super admin; oturumsuz (SQL Editor / service_role) serbest.
CREATE OR REPLACE FUNCTION public.billing_campaign_set_enabled(p_code text, p_enabled boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'PERDEPRO_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  UPDATE public.billing_campaigns SET is_enabled = p_enabled, updated_at = now() WHERE code = p_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERDEPRO_NOT_FOUND: kampanya'; END IF;
  RETURN public.billing_campaign_admin_status(p_code);
END
$fn$;

CREATE OR REPLACE FUNCTION public.billing_campaign_set_qa_preview(p_code text, p_on boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'PERDEPRO_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  UPDATE public.billing_campaigns SET qa_preview = p_on, updated_at = now() WHERE code = p_code;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERDEPRO_NOT_FOUND: kampanya'; END IF;
  RETURN public.billing_campaign_admin_status(p_code);
END
$fn$;

CREATE OR REPLACE FUNCTION public.billing_campaign_admin_status(p_code text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_c public.billing_campaigns%ROWTYPE;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'PERDEPRO_FORBIDDEN' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_c FROM public.billing_campaigns WHERE p_code IS NULL OR code = p_code ORDER BY created_at LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('code', v_c.code, 'plan_code', v_c.plan_code, 'is_enabled', v_c.is_enabled, 'qa_preview', v_c.qa_preview,
    'discount_percent', v_c.discount_percent, 'max_slots', v_c.max_slots,
    'consumed', (SELECT count(*) FROM public.billing_campaign_claims c WHERE c.campaign_code = v_c.code AND c.status = 'consumed' AND NOT c.is_test),
    'reserved_active', (SELECT count(*) FROM public.billing_campaign_claims c WHERE c.campaign_code = v_c.code AND c.status = 'reserved' AND c.reserved_until > now() AND NOT c.is_test));
END
$fn$;

REVOKE ALL ON FUNCTION public.billing_campaign_quote(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_campaign_public_status() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.billing_campaign_set_enabled(text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_campaign_admin_status(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_campaign_set_qa_preview(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_campaign_set_qa_preview(text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.billing_campaign_quote(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.billing_campaign_public_status() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.billing_campaign_set_enabled(text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.billing_campaign_admin_status(text) TO authenticated, service_role;

-- (d) Super admin: iade kayitlari
CREATE OR REPLACE FUNCTION public.billing_refund_cases_list(p_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin() THEN RAISE EXCEPTION 'PERDEPRO_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (
    SELECT r.id, r.company_id, co.name AS company_name, r.provider_ref, r.amount_minor, r.currency, r.reason, r.status, r.note,
           r.created_at, r.resolved_at
      FROM public.billing_refund_cases r LEFT JOIN public.companies co ON co.id = r.company_id
     WHERE p_status IS NULL OR r.status = p_status
     ORDER BY r.created_at DESC LIMIT 100) x), '[]'::jsonb);
END
$fn$;

CREATE OR REPLACE FUNCTION public.billing_refund_case_resolve(p_id uuid, p_status text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_row public.billing_refund_cases%ROWTYPE;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin() THEN RAISE EXCEPTION 'PERDEPRO_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF p_status NOT IN ('refunded','dismissed') THEN RAISE EXCEPTION 'PERDEPRO_INVALID: durum'; END IF;
  IF coalesce(btrim(p_note), '') = '' THEN RAISE EXCEPTION 'PERDEPRO_INVALID: Iade referansi/notu zorunlu.'; END IF;
  UPDATE public.billing_refund_cases SET status = p_status, note = btrim(p_note), resolved_at = now(), resolved_by = auth.uid()
   WHERE id = p_id AND status = 'open' RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERDEPRO_NOT_FOUND: acik iade kaydi'; END IF;
  RETURN to_jsonb(v_row);
END
$fn$;

-- (e) Super admin: bir firmanin kampanya uygunlugu + istisna
CREATE OR REPLACE FUNCTION public.billing_campaign_company_status(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_ov public.billing_campaign_overrides%ROWTYPE;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin() THEN RAISE EXCEPTION 'PERDEPRO_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_ov FROM public.billing_campaign_overrides WHERE company_id = p_company_id;
  RETURN jsonb_build_object('eval', public.billing_campaign_eval(p_company_id, 'solo_yearly'),
    'has_yearly_purchase', public.billing_company_has_yearly_purchase(p_company_id),
    'override', CASE WHEN v_ov.company_id IS NULL THEN NULL ELSE jsonb_build_object('allow', v_ov.allow, 'note', v_ov.note, 'set_at', v_ov.set_at) END);
END
$fn$;

-- p_allow: false = ucretli yillik lisans (kampanya yok), true = hediye/ucretsiz (kampanya var), NULL = istisnayi kaldir
CREATE OR REPLACE FUNCTION public.billing_campaign_set_override(p_company_id uuid, p_allow boolean, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_super_admin() THEN RAISE EXCEPTION 'PERDEPRO_FORBIDDEN' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id) THEN RAISE EXCEPTION 'PERDEPRO_NOT_FOUND: firma'; END IF;
  IF p_allow IS NULL THEN
    DELETE FROM public.billing_campaign_overrides WHERE company_id = p_company_id;
  ELSE
    INSERT INTO public.billing_campaign_overrides(company_id, allow, note, set_by) VALUES (p_company_id, p_allow, nullif(btrim(p_note), ''), auth.uid())
    ON CONFLICT (company_id) DO UPDATE SET allow = EXCLUDED.allow, note = EXCLUDED.note, set_by = EXCLUDED.set_by, set_at = now();
  END IF;
  RETURN public.billing_campaign_company_status(p_company_id);
END
$fn$;

REVOKE ALL ON FUNCTION public.billing_refund_cases_list(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_refund_case_resolve(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_campaign_company_status(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.billing_campaign_set_override(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.billing_refund_cases_list(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.billing_refund_case_resolve(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.billing_campaign_company_status(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.billing_campaign_set_override(uuid, boolean, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
