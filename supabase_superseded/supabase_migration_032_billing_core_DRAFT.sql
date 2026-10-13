-- !!! TASLAK — URETIME UYGULANMADI. Saglayici secimi ve entegrasyon tamamlanmadan uygulanmamalidir.
-- Amac: tum satis kanallari (web: iyzico/PayTR, Android: Google Play, iOS: App Store) ayni firma aboneligine baglanir.
-- ODEME MODELI: TEK SEFERLIK DONEM SATIN ALIMI (otomatik yenileme/kart saklama YOK). Yenileme = kullanicinin yeniden satin almasi.
-- Ilke: istemci (anon/authenticated) bu tablolara YAZAMAZ; yazan tek yol service_role ile calisan
--       sunucu fonksiyonlaridir (Edge Function webhook'lari). Lisans alanlari companies uzerinde zaten
--       protect_license_fields tetikleyicisiyle korunur (auth.uid() NULL = sistem cagrisi).
-- Gerekli: migration 024-027 (company_subscription_allows_write, is_company_admin, is_super_admin).
BEGIN;

CREATE TABLE IF NOT EXISTS public.billing_plans (
  code text PRIMARY KEY,
  name text NOT NULL,
  period text NOT NULL CHECK (period IN ('month','year')),
  price_minor integer NOT NULL CHECK (price_minor > 0),
  currency text NOT NULL DEFAULT 'TRY',
  package_code text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.billing_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plan_code text REFERENCES public.billing_plans(code),
  channel text NOT NULL CHECK (channel IN ('iyzico','paytr','google_play','app_store','manual')),
  provider_subscription_ref text,
  status text NOT NULL CHECK (status IN ('pending','active','past_due','canceled','expired','refunded')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- Bir firmanin ayni anda tek "canli" aboneligi olur (kanallar arasi cift abonelik yok).
CREATE UNIQUE INDEX IF NOT EXISTS billing_one_live_subscription_per_company
  ON public.billing_subscriptions(company_id) WHERE status IN ('pending','active','past_due');
CREATE UNIQUE INDEX IF NOT EXISTS billing_provider_ref_uidx
  ON public.billing_subscriptions(channel, provider_subscription_ref) WHERE provider_subscription_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  company_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome text,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (channel, provider_event_id)
);

CREATE TABLE IF NOT EXISTS public.billing_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES public.billing_subscriptions(id) ON DELETE SET NULL,
  channel text NOT NULL,
  provider_payment_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('charge','refund')),
  status text NOT NULL CHECK (status IN ('succeeded','failed','refunded')),
  amount_minor integer NOT NULL,
  currency text NOT NULL,
  period_start timestamptz,
  period_end timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (channel, provider_payment_id, kind)
);

ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_plans_read ON public.billing_plans;
CREATE POLICY billing_plans_read ON public.billing_plans FOR SELECT TO authenticated USING (is_active);
DROP POLICY IF EXISTS billing_subscriptions_read ON public.billing_subscriptions;
CREATE POLICY billing_subscriptions_read ON public.billing_subscriptions FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_company_admin(company_id));
DROP POLICY IF EXISTS billing_payments_read ON public.billing_payments;
CREATE POLICY billing_payments_read ON public.billing_payments FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_company_admin(company_id));
-- billing_events: istemciye kapali (yalnizca service_role / super-admin RPC'leri).

REVOKE ALL ON public.billing_plans, public.billing_subscriptions, public.billing_events, public.billing_payments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.billing_plans, public.billing_subscriptions, public.billing_payments TO authenticated;

-- Basarili tahsilat: IDEMPOTENT. Ayni (channel, provider_event_id) veya ayni odeme ikinci kez sure uzatmaz.
CREATE OR REPLACE FUNCTION public.billing_apply_charge(
  p_channel text, p_event_id text, p_company_id uuid, p_plan_code text,
  p_provider_payment_id text, p_amount_minor integer, p_currency text,
  p_provider_subscription_ref text DEFAULT NULL, p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_plan public.billing_plans%ROWTYPE;
  v_company public.companies%ROWTYPE;
  v_event_id uuid;
  v_base timestamptz;
  v_end timestamptz;
  v_sub_id uuid;
  v_inserted int;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: yalnizca sunucu cagrisi'; END IF;

  INSERT INTO public.billing_events(channel, provider_event_id, event_type, company_id, payload)
  VALUES (p_channel, p_event_id, 'charge.succeeded', p_company_id, coalesce(p_payload,'{}'::jsonb))
  ON CONFLICT (channel, provider_event_id) DO NOTHING
  RETURNING id INTO v_event_id;
  IF v_event_id IS NULL THEN RETURN jsonb_build_object('status','duplicate'); END IF;

  SELECT * INTO v_plan FROM public.billing_plans WHERE code = p_plan_code AND is_active;
  IF NOT FOUND THEN
    UPDATE public.billing_events SET outcome='rejected_unknown_plan', processed_at=now() WHERE id=v_event_id;
    RETURN jsonb_build_object('status','rejected','reason','unknown_plan');
  END IF;
  IF p_amount_minor IS DISTINCT FROM v_plan.price_minor OR upper(p_currency) IS DISTINCT FROM v_plan.currency THEN
    UPDATE public.billing_events SET outcome='rejected_amount_mismatch', processed_at=now() WHERE id=v_event_id;
    RETURN jsonb_build_object('status','rejected','reason','amount_mismatch');
  END IF;

  SELECT * INTO v_company FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    UPDATE public.billing_events SET outcome='rejected_unknown_company', processed_at=now() WHERE id=v_event_id;
    RETURN jsonb_build_object('status','rejected','reason','unknown_company');
  END IF;
  IF lower(coalesce(v_company.plan_status,'')) = 'suspended' THEN
    UPDATE public.billing_events SET outcome='blocked_suspended', processed_at=now() WHERE id=v_event_id;
    RETURN jsonb_build_object('status','blocked','reason','company_suspended');
  END IF;

  -- Erisim, mevcut odenmis donemin sonundan (varsa) uzar; gecmisse simdiden baslar.
  v_base := greatest(coalesce(CASE WHEN lower(coalesce(v_company.plan_status,''))='active' THEN v_company.license_expires_at END, now()), now());
  v_end := v_base + CASE v_plan.period WHEN 'year' THEN interval '1 year' ELSE interval '1 month' END;

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

  INSERT INTO public.billing_payments(company_id, subscription_id, channel, provider_payment_id, kind, status, amount_minor, currency, period_start, period_end)
  VALUES (p_company_id, v_sub_id, p_channel, p_provider_payment_id, 'charge', 'succeeded', p_amount_minor, v_plan.currency, v_base, v_end)
  ON CONFLICT (channel, provider_payment_id, kind) DO NOTHING;
  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 0 THEN
    UPDATE public.billing_events SET outcome='duplicate_payment', processed_at=now() WHERE id=v_event_id;
    RETURN jsonb_build_object('status','duplicate');
  END IF;

  UPDATE public.companies SET plan_status='active', subscription_status='active', license_expires_at=v_end,
         package_code=v_plan.package_code, updated_at=now()
   WHERE id = p_company_id;

  UPDATE public.billing_events SET outcome='applied', processed_at=now() WHERE id=v_event_id;
  RETURN jsonb_build_object('status','applied','period_end',v_end,'subscription_id',v_sub_id);
END
$fn$;

-- Basarisiz/bekleyen odeme: kayit tutulur, ERISIM ACILMAZ.
CREATE OR REPLACE FUNCTION public.billing_record_failure(
  p_channel text, p_event_id text, p_company_id uuid, p_reason text DEFAULT NULL, p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: yalnizca sunucu cagrisi'; END IF;
  INSERT INTO public.billing_events(channel, provider_event_id, event_type, company_id, payload, outcome, processed_at)
  VALUES (p_channel, p_event_id, 'charge.failed', p_company_id, coalesce(p_payload,'{}'::jsonb) || jsonb_build_object('reason', p_reason), 'recorded_no_access', now())
  ON CONFLICT (channel, provider_event_id) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    UPDATE public.billing_subscriptions SET status = CASE WHEN status='active' THEN 'past_due' ELSE status END, updated_at=now()
     WHERE company_id = p_company_id AND status IN ('active');
  END IF;
  RETURN jsonb_build_object('status', CASE WHEN v_id IS NULL THEN 'duplicate' ELSE 'recorded' END);
END
$fn$;

-- Iade: erisim hemen sona erer (politika karari: iade = erisim kapanir; degistirilebilir).
CREATE OR REPLACE FUNCTION public.billing_apply_refund(
  p_channel text, p_event_id text, p_company_id uuid, p_provider_payment_id text, p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_id uuid; v_pay public.billing_payments%ROWTYPE;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: yalnizca sunucu cagrisi'; END IF;
  INSERT INTO public.billing_events(channel, provider_event_id, event_type, company_id, payload)
  VALUES (p_channel, p_event_id, 'charge.refunded', p_company_id, coalesce(p_payload,'{}'::jsonb))
  ON CONFLICT (channel, provider_event_id) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('status','duplicate'); END IF;
  SELECT * INTO v_pay FROM public.billing_payments
   WHERE channel=p_channel AND provider_payment_id=p_provider_payment_id AND kind='charge' AND company_id=p_company_id;
  IF NOT FOUND THEN
    UPDATE public.billing_events SET outcome='rejected_unknown_payment', processed_at=now() WHERE id=v_id;
    RETURN jsonb_build_object('status','rejected','reason','unknown_payment');
  END IF;
  UPDATE public.billing_payments SET status='refunded' WHERE id=v_pay.id;
  UPDATE public.billing_subscriptions SET status='refunded', updated_at=now() WHERE id=v_pay.subscription_id;
  UPDATE public.companies SET plan_status='expired', subscription_status='expired', license_expires_at=now(), updated_at=now()
   WHERE id=p_company_id AND lower(coalesce(plan_status,''))='active';
  UPDATE public.billing_events SET outcome='applied', processed_at=now() WHERE id=v_id;
  RETURN jsonb_build_object('status','applied');
END
$fn$;

-- Iptal: donem sonuna kadar erisim surer (otomatik yenileme durur).
CREATE OR REPLACE FUNCTION public.billing_apply_cancel(
  p_channel text, p_event_id text, p_company_id uuid, p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: yalnizca sunucu cagrisi'; END IF;
  INSERT INTO public.billing_events(channel, provider_event_id, event_type, company_id, payload)
  VALUES (p_channel, p_event_id, 'subscription.canceled', p_company_id, coalesce(p_payload,'{}'::jsonb))
  ON CONFLICT (channel, provider_event_id) DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN jsonb_build_object('status','duplicate'); END IF;
  UPDATE public.billing_subscriptions SET cancel_at_period_end=true, canceled_at=coalesce(canceled_at, now()), updated_at=now()
   WHERE company_id=p_company_id AND status IN ('active','past_due');
  UPDATE public.billing_events SET outcome='applied', processed_at=now() WHERE id=v_id;
  RETURN jsonb_build_object('status','applied');
END
$fn$;


-- Tek seferlik donem satin alma NIYETI: fiyat/plan SUNUCUDA sabitlenir. Saglayicidan gelen sonuc yalnizca bu kayitla eslesirse uygulanir.
CREATE TABLE IF NOT EXISTS public.billing_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  plan_code text NOT NULL REFERENCES public.billing_plans(code),
  channel text NOT NULL,
  amount_minor integer NOT NULL CHECK (amount_minor > 0),
  currency text NOT NULL,
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','paid','failed','expired')),
  provider_token text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);
ALTER TABLE public.billing_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_intents FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.billing_create_intent(p_channel text, p_company_id uuid, p_plan_code text, p_created_by uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_plan public.billing_plans%ROWTYPE; v_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: yalnizca sunucu cagrisi'; END IF;
  SELECT * INTO v_plan FROM public.billing_plans WHERE code = p_plan_code AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERDEPRO_NOT_FOUND: plan'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id) THEN RAISE EXCEPTION 'PERDEPRO_NOT_FOUND: firma'; END IF;
  INSERT INTO public.billing_intents(company_id, plan_code, channel, amount_minor, currency, created_by)
  VALUES (p_company_id, p_plan_code, p_channel, v_plan.price_minor, v_plan.currency, p_created_by) RETURNING id INTO v_id;
  RETURN jsonb_build_object('intent_id', v_id, 'amount_minor', v_plan.price_minor, 'currency', v_plan.currency);
END
$fn$;

CREATE OR REPLACE FUNCTION public.billing_get_intent(p_intent_id uuid)
RETURNS TABLE(id uuid, company_id uuid, plan_code text, channel text, amount_minor integer, currency text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT i.id, i.company_id, i.plan_code, i.channel, i.amount_minor, i.currency, i.status FROM public.billing_intents i WHERE i.id = p_intent_id
$fn$;

CREATE OR REPLACE FUNCTION public.billing_set_intent_token(p_intent_id uuid, p_token text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: yalnizca sunucu cagrisi'; END IF;
  UPDATE public.billing_intents SET provider_token = p_token WHERE id = p_intent_id AND status = 'created';
END
$fn$;

CREATE OR REPLACE FUNCTION public.billing_mark_intent(p_intent_id uuid, p_status text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: yalnizca sunucu cagrisi'; END IF;
  IF p_status NOT IN ('paid','failed','expired') THEN RAISE EXCEPTION 'gecersiz durum'; END IF;
  UPDATE public.billing_intents SET status = p_status, paid_at = CASE WHEN p_status='paid' THEN now() ELSE paid_at END
   WHERE id = p_intent_id AND status = 'created';
END
$fn$;

REVOKE ALL ON FUNCTION public.billing_apply_charge(text,text,uuid,text,text,integer,text,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_record_failure(text,text,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_apply_refund(text,text,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_apply_cancel(text,text,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_apply_charge(text,text,uuid,text,text,integer,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_record_failure(text,text,uuid,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_apply_refund(text,text,uuid,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_apply_cancel(text,text,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.billing_create_intent(text,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_get_intent(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_set_intent_token(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_mark_intent(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_create_intent(text,uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_get_intent(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_set_intent_token(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_mark_intent(uuid,text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
