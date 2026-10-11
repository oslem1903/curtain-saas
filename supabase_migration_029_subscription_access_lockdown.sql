-- !!! UYGULAMAYIN (2026-10-11 karari): bu dosya sure bitince is verisi OKUMAYI da kapatir.
-- Guncel urun karari: sure bitince goruntuleme ve disa aktarma ACIK, yazma sunucuda kapali.
-- Yazma korumasi uretimde 024-026 ile zaten vardir. 029 yalnizca yazma kisitlayacak sekilde
-- yeniden yazilip ayri testten gecmeden uretime alinmamalidir.
-- Migration 029: deneme/abonelik erisimini RLS SELECT dahil sunucuda uygula.
-- Gereksinim: 024, 025 (varsa bagli tablolar), 026.
-- Once 029_precheck_readonly.sql; RLS kapali/sema uyumsuz tablo varsa durur.
-- Mevcut sirket, kullanici, uyelik, deneme veya is verisini degistirmez/silmez.
-- Ozel erisim: aktif firmada, pilot_until NULL ise suresiz; aksi halde bitise kadar.
-- Ozel erisim yalnizca deneme/abonelik bitisini gecer; pasif/askida/read-only
-- firma bayraklarini gecerli kilmaz. Ucretli ve lifetime haklari korunur.

BEGIN;

DO $pre$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'customers','customer_rooms','appointments','measurements','orders','order_items',
    'order_payment_plans','order_installments','quotes','quote_items','products','catalogs',
    'catalog_series','catalog_variants','catalog_code_photos','suppliers','supplier_transactions',
    'supplier_payments','supplier_product_prices','installation_jobs','installer_transactions',
    'installer_earnings','employees','employee_transactions','staff','payments',
    'customer_collections','income','expenses','transactions','invoices','invoice_items',
    'visual_previews','field_info','branches','vehicles','warehouse_items','accounts',
    'appointment_assignees','catalog_collections','catalog_items','expense_categories',
    'income_categories','installer_payments','supplier_work_orders'
  ];
BEGIN
  IF to_regprocedure('public.is_super_admin()') IS NULL
     OR to_regprocedure('public.is_company_member(uuid)') IS NULL
     OR to_regprocedure('public.company_subscription_allows_write(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: migrations 012/024/026 prerequisites missing.';
  END IF;
  IF to_regprocedure('public.register_device_and_touch_login(text,text,text)') IS NULL
     OR to_regprocedure('public.is_company_writable(uuid)') IS NULL
     OR to_regprocedure('public.check_subscription_active(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: expected access functions missing.';
  END IF;

  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN CONTINUE; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid=to_regclass('public.' || v_table)
        AND a.attname='company_id' AND NOT a.attisdropped AND a.atttypid='uuid'::regtype
    ) THEN
      RAISE EXCEPTION 'PREFLIGHT: public.%.company_id uuid degil/yok.', v_table;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('public.' || v_table) AND c.relrowsecurity
    ) THEN
      RAISE EXCEPTION 'PREFLIGHT: public.% icin RLS kapali. Once mevcut RLS politikalari incelenmeli; migration durduruldu.', v_table;
    END IF;
    IF EXISTS (
      SELECT 1 FROM pg_class c WHERE c.oid=to_regclass('public.' || v_table) AND c.relforcerowsecurity
    ) THEN
      RAISE EXCEPTION 'PREFLIGHT: public.% zaten FORCE ROW LEVEL SECURITY kullaniyor. Rollback state guvenle korunamayacagi icin migration durduruldu.', v_table;
    END IF;
  END LOOP;
END
$pre$;

-- Tek sunucu karari: aktif ozel erisim, ucretli/lifetime lisans veya devam
-- eden deneme. PostgreSQL now() kullanir; istemci/cihaz saati kullanilmaz.
CREATE OR REPLACE FUNCTION public.company_subscription_access_allowed(p_company_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT coalesce((
    SELECT (public.is_super_admin() OR (
         EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND coalesce(p.is_active,true))
         AND EXISTS (SELECT 1 FROM public.company_members m
           WHERE m.user_id=auth.uid() AND m.company_id=c.id AND coalesce(m.is_active,true))
       ))
       AND coalesce(c.is_active, true)
       AND lower(coalesce(c.plan_status, '')) <> 'suspended'
       AND (
         (coalesce(c.is_pilot, false) AND (c.pilot_until IS NULL OR c.pilot_until > now()))
         OR CASE lower(coalesce(c.plan_status, ''))
              WHEN 'expired' THEN false
              WHEN 'lifetime' THEN true
              WHEN 'active' THEN c.license_expires_at IS NULL OR c.license_expires_at > now()
              ELSE c.trial_ends_at IS NOT NULL AND c.trial_ends_at > now()
            END
       )
    FROM public.companies c WHERE c.id=p_company_id
  ), false)
$fn$;
REVOKE ALL ON FUNCTION public.company_subscription_access_allowed(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_subscription_access_allowed(uuid) TO authenticated;
-- Migration 029: Add company subscription access snapshot function

CREATE OR REPLACE FUNCTION public.company_subscription_access_snapshot(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public
AS $fn$
DECLARE
  v_company public.companies%ROWTYPE;
  v_special_active boolean;
  v_access_kind text;
  v_access_end timestamptz;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin() AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND coalesce(p.is_active,true)
  ) THEN
    RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: Erişim durumu okunamadı.' USING ERRCODE='42501';
  END IF;
  SELECT * INTO v_company FROM public.companies WHERE id=p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERDEPRO_NOT_FOUND: Firma bulunamadı.'; END IF;
  IF NOT public.is_super_admin() AND NOT EXISTS (
    SELECT 1 FROM public.company_members m
    WHERE m.user_id=auth.uid() AND m.company_id=p_company_id AND coalesce(m.is_active,true)
  ) THEN
    RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: Bu firmanın erişim durumu okunamaz.' USING ERRCODE='42501';
  END IF;

  v_special_active := coalesce(v_company.is_pilot,false)
    AND (v_company.pilot_until IS NULL OR v_company.pilot_until>now());
  IF v_special_active THEN
    v_access_kind := 'special_access';
    v_access_end := v_company.pilot_until;
  ELSIF lower(coalesce(v_company.plan_status,''))='active' THEN
    v_access_kind := 'paid';
    v_access_end := v_company.license_expires_at;
  ELSIF lower(coalesce(v_company.plan_status,''))='lifetime' THEN
    v_access_kind := 'lifetime';
  ELSIF lower(coalesce(v_company.plan_status,'')) IN ('suspended','expired') OR NOT coalesce(v_company.is_active,true) THEN
    v_access_kind := 'expired';
  ELSE
    v_access_kind := 'trial';
    v_access_end := v_company.trial_ends_at;
  END IF;

  RETURN jsonb_build_object(
    'company_id',p_company_id,
    'access_allowed',public.company_subscription_access_allowed(p_company_id),
    'access_kind',v_access_kind,
    'access_expires_at',v_access_end,
    'server_time',now()
  );
END
$fn$;
REVOKE ALL ON FUNCTION public.company_subscription_access_snapshot(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.company_subscription_access_snapshot(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.super_admin_access_snapshot(p_company_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public
AS $fn$
  SELECT jsonb_build_object(
    'company_id',c.id,'name',c.name,'plan_status',c.plan_status,
    'subscription_status',c.subscription_status,'subscription_plan',c.subscription_plan,
    'package_code',c.package_code,'is_active',c.is_active,'read_only',c.read_only,
    'trial_started_at',coalesce(c.trial_started_at,c.trial_start),'trial_ends_at',c.trial_ends_at,
    'license_expires_at',c.license_expires_at,'is_pilot',coalesce(c.is_pilot,false),
    'pilot_until',c.pilot_until,'pilot_note',c.pilot_note,
    'special_access_active',coalesce(c.is_pilot,false) AND (c.pilot_until IS NULL OR c.pilot_until>now()),
    'writable',public.company_subscription_allows_write(c.id),'signup_source',c.signup_source,'server_time',now()
  ) FROM public.companies c WHERE c.id=p_company_id
$fn$;

CREATE OR REPLACE FUNCTION public.company_subscription_allows_write(p_company_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT coalesce((
    SELECT public.company_subscription_access_allowed(c.id)
       AND NOT coalesce(c.read_only, false)
    FROM public.companies c WHERE c.id=p_company_id
  ), false)
$fn$;

CREATE OR REPLACE FUNCTION public.is_company_writable(p_company_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  RETURN public.is_super_admin() OR (
    EXISTS (
      SELECT 1 FROM public.company_members
      WHERE user_id=auth.uid() AND company_id=p_company_id AND role IN ('admin','owner') AND coalesce(is_active,true)
    ) AND public.company_subscription_allows_write(p_company_id)
  );
END;
$fn$;

CREATE OR REPLACE FUNCTION public.check_subscription_active(company_uuid uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF company_uuid IS NULL OR NOT EXISTS (SELECT 1 FROM public.companies WHERE id=company_uuid) THEN
    RETURN true;
  END IF;
  RETURN public.company_subscription_access_allowed(company_uuid);
END;
$fn$;

-- Login/device gate uses the same subscription predicate, then preserves
-- existing device limits, audit fields, and device registration behavior.
CREATE OR REPLACE FUNCTION public.register_device_and_touch_login(
  p_device_id text, p_user_agent text DEFAULT NULL::text, p_device_name text DEFAULT NULL::text
)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_company public.companies%ROWTYPE;
  v_company_id uuid;
  v_device_count integer;
  v_existing_active boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE user_id=auth.uid() AND role='super_admin') THEN
    RETURN 'ok';
  END IF;

  SELECT cm.company_id INTO v_company_id
  FROM public.company_members cm
  JOIN public.companies c ON c.id=cm.company_id
  WHERE cm.user_id=auth.uid() AND coalesce(cm.is_active, true)
  ORDER BY public.company_subscription_access_allowed(c.id) DESC, cm.created_at DESC
  LIMIT 1;
  IF v_company_id IS NULL THEN RETURN 'no_company'; END IF;

  SELECT * INTO v_company FROM public.companies WHERE id=v_company_id;
  IF NOT coalesce(v_company.is_active, true) OR lower(coalesce(v_company.plan_status, ''))='suspended' THEN
    RETURN 'suspended';
  END IF;
  IF NOT public.company_subscription_access_allowed(v_company_id) THEN RETURN 'expired'; END IF;

  SELECT is_active INTO v_existing_active FROM public.company_devices
  WHERE company_id=v_company_id AND device_id=p_device_id;
  IF v_existing_active IS NOT NULL THEN
    IF v_existing_active=false THEN
      SELECT count(*) INTO v_device_count FROM public.company_devices
      WHERE company_id=v_company_id AND coalesce(is_active, true);
      IF v_device_count >= coalesce(v_company.max_devices,
        public.default_device_limit_for_package(coalesce(v_company.package_code, v_company.subscription_plan))) THEN
        RETURN 'device_limit';
      END IF;
    END IF;
    UPDATE public.company_devices SET last_seen_at=now(), user_id=auth.uid(),
      user_agent=coalesce(p_user_agent,user_agent), device_name=coalesce(p_device_name,device_name),
      browser_name=coalesce(public.parse_browser_name(p_user_agent),browser_name),
      os_name=coalesce(public.parse_os_name(p_user_agent),os_name),
      ip_address=coalesce(inet_client_addr(),ip_address), is_active=true,
      deactivated_at=NULL, deactivated_by=NULL
    WHERE company_id=v_company_id AND device_id=p_device_id;
  ELSE
    SELECT count(*) INTO v_device_count FROM public.company_devices
    WHERE company_id=v_company_id AND coalesce(is_active, true);
    IF v_device_count >= coalesce(v_company.max_devices,
      public.default_device_limit_for_package(coalesce(v_company.package_code, v_company.subscription_plan))) THEN
      RETURN 'device_limit';
    END IF;
    INSERT INTO public.company_devices(company_id,user_id,device_id,user_agent,device_name,browser_name,os_name,ip_address,is_active)
    VALUES (v_company_id,auth.uid(),p_device_id,p_user_agent,p_device_name,
      public.parse_browser_name(p_user_agent),public.parse_os_name(p_user_agent),inet_client_addr(),true)
    ON CONFLICT (company_id,device_id) DO NOTHING;
  END IF;
  UPDATE public.companies SET last_login_at=now() WHERE id=v_company_id;
  RETURN 'ok';
END;
$fn$;

DO $policies$
DECLARE
  v_table text;
  v_tables text[] := ARRAY[
    'customers','customer_rooms','appointments','measurements','orders','order_items',
    'order_payment_plans','order_installments','quotes','quote_items','products','catalogs',
    'catalog_series','catalog_variants','catalog_code_photos','suppliers','supplier_transactions',
    'supplier_payments','supplier_product_prices','installation_jobs','installer_transactions',
    'installer_earnings','employees','employee_transactions','staff','payments',
    'customer_collections','income','expenses','transactions','invoices','invoice_items',
    'visual_previews','field_info','branches','vehicles','warehouse_items','accounts',
    'appointment_assignees','catalog_collections','catalog_items','expense_categories',
    'income_categories','installer_payments','supplier_work_orders'
  ];
BEGIN
  FOREACH v_table IN ARRAY v_tables LOOP
    IF to_regclass('public.' || v_table) IS NULL THEN CONTINUE; END IF;
    EXECUTE format('DROP POLICY IF EXISTS perdepro_subscription_access_029 ON public.%I', v_table);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table);
    EXECUTE format(
      'CREATE POLICY perdepro_subscription_access_029 ON public.%I AS RESTRICTIVE FOR ALL TO PUBLIC USING (company_id IS NULL OR public.is_super_admin() OR public.company_subscription_access_allowed(company_id)) WITH CHECK (company_id IS NULL OR public.is_super_admin() OR public.company_subscription_access_allowed(company_id))',
      v_table
    );
  END LOOP;
END
$policies$;

NOTIFY pgrst, 'reload schema';
COMMIT;