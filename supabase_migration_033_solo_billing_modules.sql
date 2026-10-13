-- =============================================================================
-- Migration 033: Solo satin alma cekirdegi (PayTR, tek seferlik donem) +
--                paket modullerinin SUNUCUDA zorlanmasi
--
-- NE YAPAR
--   1) billing_plans / billing_subscriptions / billing_events / billing_payments /
--      billing_intents / billing_test_companies tablolari ve yalniz service_role'un
--      cagirabildigi billing_* RPC'leri (supabase_migration_032_billing_core_DRAFT.sql'den
--      turetildi; DRAFT dosyasi bu migration ile yerini almistir).
--      Duzeltmeler: (a) ayni odeme ikinci kez geldiginde sure/abonelik YENIDEN
--      uzatilmaz (odeme kaydi once yazilir), (b) kalan deneme suresi korunur,
--      (c) 1 ay/1 yil Europe/Istanbul takvimine gore eklenir, (d) PayTR TEST modu
--      odemeleri yalniz billing_test_companies'teki test firmalarinda lisans acar.
--   2) company_has_module(): istemcideki AuthContext (SOLO/PRO/ENTERPRISE/CORE,
--      takma adlar) ile birebir ayni modul karari. Solo paketinde olmayan
--      modullerin tablolari (faturalar, kartela, sube, arac, depo) icin RESTRICTIVE
--      RLS (okuma) + BEFORE tetikleyici (SECURITY DEFINER RPC'ler dahil yazma).
--
-- NE YAPMAZ
--   - Hicbir mevcut firmanin plan/deneme/lisans/modul alanini DEGISTIRMEZ.
--   - Fiyat YAZMAZ: billing_plans bos olusur; plan ancak onayli fiyatla
--     (INSERT, service_role/SQL Editor) eklenir. Plan yokken satin alma kapali kalir.
--   - Solo'nun kullandigi tablolara (orders, customers, suppliers, income, expenses,
--     payments, employees ...) DOKUNMAZ.
-- GERI ALMA: supabase_migration_033_rollback.sql
-- =============================================================================
BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.companies') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: public.companies yok.';
  END IF;
  IF to_regprocedure('public.is_super_admin()') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: public.is_super_admin() yok.';
  END IF;
  IF to_regprocedure('public.is_company_admin(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: public.is_company_admin(uuid) yok.';
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------
-- 1) Satin alma tablolari
-- ---------------------------------------------------------------------------
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

-- PayTR TEST modu odemelerinin lisans acabildigi firmalar (yalniz service_role/SQL).
CREATE TABLE IF NOT EXISTS public.billing_test_companies (
  company_id uuid PRIMARY KEY REFERENCES public.companies(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_test_companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS billing_plans_read ON public.billing_plans;
CREATE POLICY billing_plans_read ON public.billing_plans FOR SELECT TO authenticated USING (is_active);
DROP POLICY IF EXISTS billing_subscriptions_read ON public.billing_subscriptions;
CREATE POLICY billing_subscriptions_read ON public.billing_subscriptions FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_company_admin(company_id));
DROP POLICY IF EXISTS billing_payments_read ON public.billing_payments;
CREATE POLICY billing_payments_read ON public.billing_payments FOR SELECT TO authenticated
  USING (public.is_super_admin() OR public.is_company_admin(company_id));

REVOKE ALL ON public.billing_plans, public.billing_subscriptions, public.billing_events,
  public.billing_payments, public.billing_intents, public.billing_test_companies FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.billing_plans, public.billing_subscriptions, public.billing_payments TO authenticated;

-- ---------------------------------------------------------------------------
-- 2) Sunucu-tarafi RPC'ler (yalniz service_role; auth.uid() dolu ise reddedilir)
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
  v_event_id uuid;
  v_base timestamptz;
  v_end timestamptz;
  v_sub_id uuid;
  v_inserted int;
  v_pay_id uuid;
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

  -- TEST modu odemesi: gercek firmanin lisansini ACMAZ.
  IF coalesce(p_test_mode, false)
     AND NOT EXISTS (SELECT 1 FROM public.billing_test_companies t WHERE t.company_id = p_company_id) THEN
    UPDATE public.billing_events SET outcome='test_payment_no_license', processed_at=now() WHERE id=v_event_id;
    RETURN jsonb_build_object('status','test_no_license');
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

CREATE OR REPLACE FUNCTION public.billing_record_failure(
  p_channel text, p_event_id text, p_company_id uuid, p_reason text DEFAULT NULL, p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: yalnizca sunucu cagrisi'; END IF;
  INSERT INTO public.billing_events(channel, provider_event_id, event_type, company_id, payload, outcome, processed_at)
  VALUES (p_channel, p_event_id, 'charge.failed', p_company_id, coalesce(p_payload,'{}'::jsonb) || jsonb_build_object('reason', p_reason), 'recorded_no_access', now())
  ON CONFLICT (channel, provider_event_id) DO NOTHING RETURNING id INTO v_id;
  RETURN jsonb_build_object('status', CASE WHEN v_id IS NULL THEN 'duplicate' ELSE 'recorded' END);
END
$fn$;

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
  RETURN jsonb_build_object('intent_id', v_id, 'amount_minor', v_plan.price_minor, 'currency', v_plan.currency, 'plan_name', v_plan.name);
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
   WHERE id = p_intent_id AND status IN ('created','failed');
END
$fn$;

CREATE OR REPLACE FUNCTION public.billing_is_test_company(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.billing_test_companies t WHERE t.company_id = p_company_id)
$fn$;

REVOKE ALL ON FUNCTION public.billing_apply_charge(text,text,uuid,text,text,integer,text,text,jsonb,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_record_failure(text,text,uuid,text,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_create_intent(text,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_get_intent(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_set_intent_token(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_mark_intent(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.billing_is_test_company(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_apply_charge(text,text,uuid,text,text,integer,text,text,jsonb,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_record_failure(text,text,uuid,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_create_intent(text,uuid,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_get_intent(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_set_intent_token(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_mark_intent(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.billing_is_test_company(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3) Paket modulleri: istemcideki AuthContext ile ayni karar
-- ---------------------------------------------------------------------------
-- Modul korumasi YALNIZCA bu andan SONRA olusturulan firmalara uygulanir. Mevcut firmalar
-- (musteri, pilot, Apple Test, mevcut denemeler) geriye donuk etkilenmez: mevcut fatura/kartela
-- verilerini gizlemez ve yazma izinlerini degistirmez.
CREATE TABLE IF NOT EXISTS public.module_enforcement (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enforce_from timestamptz NOT NULL
);
INSERT INTO public.module_enforcement (id, enforce_from) VALUES (1, now()) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.module_enforcement ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.module_enforcement FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.company_has_module(p_company_id uuid, p_module text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  c public.companies%ROWTYPE;
  v_mods text[];
  v_pkg text;
  v_aliases text[];
BEGIN
  -- Sistem (oturumsuz) cagrilari ve super admin muaf.
  IF auth.uid() IS NULL OR public.is_super_admin() THEN RETURN true; END IF;
  SELECT * INTO c FROM public.companies WHERE id = p_company_id;
  IF NOT FOUND THEN RETURN false; END IF;
  -- Gecis kurali: koruma baslangicindan once olusturulan firmalar muaf.
  IF c.created_at < (SELECT enforce_from FROM public.module_enforcement WHERE id = 1) THEN RETURN true; END IF;

  v_mods := coalesce(c.enabled_modules, ARRAY[]::text[]);
  IF array_length(v_mods, 1) IS NULL THEN
    v_pkg := lower(coalesce(nullif(c.package_code,''), c.subscription_plan, ''));
    v_mods := CASE
      WHEN v_pkg IN ('solo','solo_perdeci') THEN
        ARRAY['admin','measurements','orders','customers','appointments','suppliers','installation','collections']
      WHEN v_pkg IN ('enterprise','lifetime','ekip') THEN
        ARRAY['admin','measurements','orders','customers','appointments','suppliers','installation','collections',
              'accounting','staff','catalogs','reports','expenses','profit','vehicles','commissions','warehouse','branches']
      WHEN v_pkg IN ('pro','yonetici') THEN
        ARRAY['admin','measurements','orders','customers','appointments','suppliers','installation','collections',
              'accounting','staff','catalogs','reports','expenses','profit']
      ELSE ARRAY['admin','measurements','orders','customers','appointments','catalogs','staff']
    END;
  END IF;

  v_aliases := CASE p_module
    WHEN 'admin' THEN ARRAY['admin','manager']
    WHEN 'measurements' THEN ARRAY['measurements','measure','appointments']
    WHEN 'installation' THEN ARRAY['installation','montaj']
    WHEN 'staff' THEN ARRAY['staff','personnel']
    WHEN 'catalogs' THEN ARRAY['catalogs','products','urunler','ürünler']
    ELSE ARRAY[p_module]
  END;
  RETURN v_mods && v_aliases;
END
$fn$;
REVOKE ALL ON FUNCTION public.company_has_module(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_has_module(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_company_module_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_module text := TG_ARGV[0];
  v_company uuid;
BEGIN
  IF auth.uid() IS NULL OR public.is_super_admin() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  v_company := CASE WHEN TG_OP = 'DELETE' THEN OLD.company_id ELSE NEW.company_id END;
  IF v_company IS NOT NULL AND NOT public.company_has_module(v_company, v_module) THEN
    RAISE EXCEPTION 'PERDEPRO_MODULE_NOT_IN_PACKAGE: Bu özellik paketinize dahil değil.' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END
$fn$;

-- Solo'da OLMAYAN modullerin ozel tablolari (Solo'nun kullandigi tablolara dokunulmaz).
DO $mod$
DECLARE
  r record;
  v_done text[] := ARRAY[]::text[];
BEGIN
  FOR r IN SELECT * FROM (VALUES
      ('invoices','accounting'), ('invoice_items','accounting'),
      ('catalog_series','catalogs'), ('catalog_variants','catalogs'),
      ('branches','branches'), ('vehicles','vehicles'), ('warehouse_items','warehouse')
    ) AS t(tbl, module)
  LOOP
    IF to_regclass('public.' || r.tbl) IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name=r.tbl AND column_name='company_id') THEN
      EXECUTE format('drop policy if exists perdepro_module_gate on public.%I', r.tbl);
      EXECUTE format(
        'create policy perdepro_module_gate on public.%I as restrictive for select to authenticated using (public.company_has_module(company_id, %L))',
        r.tbl, r.module);
      EXECUTE format('drop trigger if exists trg_module_write_guard on public.%I', r.tbl);
      EXECUTE format(
        'create trigger trg_module_write_guard before insert or update or delete on public.%I for each row execute function public.enforce_company_module_write(%L)',
        r.tbl, r.module);
      v_done := v_done || r.tbl;
    END IF;
  END LOOP;
  RAISE NOTICE 'Modul korumasi kuruldu: %', array_to_string(v_done, ', ');
END
$mod$;

-- ---------------------------------------------------------------------------
-- 4) On-dogrulama (GERI ALINAMAZ KONTROL): modul korumasi, mevcut bir firmanin
--    ZATEN VAR OLAN verisini gizleyecekse migration iptal edilir (hicbir sey uygulanmaz).
-- ---------------------------------------------------------------------------
DO $chk$
DECLARE
  r record;
  v_n bigint;
  v_bad text := '';
BEGIN
  PERFORM set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000c0de', true);
  FOR r IN SELECT * FROM (VALUES
      ('invoices','accounting'), ('invoice_items','accounting'),
      ('catalog_series','catalogs'), ('catalog_variants','catalogs'),
      ('branches','branches'), ('vehicles','vehicles'), ('warehouse_items','warehouse')
    ) AS t(tbl, module)
  LOOP
    IF to_regclass('public.' || r.tbl) IS NOT NULL
       AND EXISTS (SELECT 1 FROM information_schema.columns
                   WHERE table_schema='public' AND table_name=r.tbl AND column_name='company_id') THEN
      EXECUTE format('select count(*) from public.%I t where not public.company_has_module(t.company_id, %L)', r.tbl, r.module)
        INTO v_n;
      IF v_n > 0 THEN v_bad := v_bad || format('%s=%s(%s) ', r.tbl, v_n, r.module); END IF;
    END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claim.sub', '', true);
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'PREFLIGHT: modul korumasi mevcut firma verisini gizleyecek, migration iptal: %', v_bad;
  END IF;
END
$chk$;

NOTIFY pgrst, 'reload schema';
COMMIT;
