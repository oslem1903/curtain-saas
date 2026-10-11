-- Rollback 029: business-row SELECT korumasini kaldirir ve erisim fonksiyonlarini
-- 026'daki onceki davranisa dondurur. Is verisi, uyelik, lisans/tarih silinmez.
-- Uygulamadan once sonucu inceleyin; bu rollback, suresi dolan kullanicilarin
-- mevcut RLS permissive politikalarindaki SELECT erisimini yeniden acabilir.

BEGIN;

DO $drop$
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
    IF to_regclass('public.' || v_table) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS perdepro_subscription_access_029 ON public.%I', v_table);
      EXECUTE format('ALTER TABLE public.%I NO FORCE ROW LEVEL SECURITY', v_table);
    END IF;
  END LOOP;
END
$drop$;

CREATE OR REPLACE FUNCTION public.super_admin_access_snapshot(p_company_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT jsonb_build_object(
    'company_id', c.id,
    'name', c.name,
    'plan_status', c.plan_status,
    'subscription_status', c.subscription_status,
    'subscription_plan', c.subscription_plan,
    'package_code', c.package_code,
    'is_active', c.is_active,
    'read_only', c.read_only,
    'trial_started_at', coalesce(c.trial_started_at, c.trial_start),
    'trial_ends_at', c.trial_ends_at,
    'license_expires_at', c.license_expires_at,
    'is_pilot', coalesce(c.is_pilot, false),
    'pilot_until', c.pilot_until,
    'pilot_note', c.pilot_note,
    'special_access_active', coalesce(c.is_pilot, false) AND (c.pilot_until IS NULL OR c.pilot_until >= now()),
    'writable', public.company_subscription_allows_write(c.id),
    'signup_source', c.signup_source,
    'server_time', now()
  )
  FROM public.companies c
  WHERE c.id = p_company_id
$fn$;

CREATE OR REPLACE FUNCTION public.is_company_writable(p_company_id uuid)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (is_super_admin() OR (
    EXISTS (SELECT 1 FROM public.company_members WHERE user_id=auth.uid() AND company_id=p_company_id AND role IN ('admin','owner'))
    AND EXISTS (SELECT 1 FROM public.companies c WHERE c.id=p_company_id
      AND COALESCE(c.is_active,true)=true AND COALESCE(c.read_only,false)=false
      AND COALESCE(c.plan_status,'trial') NOT IN ('suspended','expired')
      AND ((COALESCE(c.is_pilot,false)=true AND (c.pilot_until IS NULL OR c.pilot_until>=now()))
        OR COALESCE(c.plan_status,'trial')='lifetime'
        OR (COALESCE(c.plan_status,'trial')='active' AND (c.license_expires_at IS NULL OR c.license_expires_at>=now()))
        OR (COALESCE(c.plan_status,'trial')='trial' AND c.trial_ends_at IS NOT NULL AND c.trial_ends_at>=now()))
    )
  ));
END;
$function$;

CREATE OR REPLACE FUNCTION public.company_subscription_allows_write(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  SELECT coalesce((SELECT coalesce(c.is_active,true) AND NOT coalesce(c.read_only,false)
    AND lower(coalesce(c.plan_status,''))<>'suspended'
    AND ((coalesce(c.is_pilot,false) AND (c.pilot_until IS NULL OR c.pilot_until>=now()))
      OR CASE lower(coalesce(c.plan_status,'')) WHEN 'expired' THEN false WHEN 'lifetime' THEN true
        WHEN 'active' THEN c.license_expires_at IS NULL OR c.license_expires_at>=now()
        ELSE c.trial_ends_at IS NOT NULL AND c.trial_ends_at>=now() END)
    FROM public.companies c WHERE c.id=p_company_id),false)
$function$;

CREATE OR REPLACE FUNCTION public.check_subscription_active(company_uuid uuid)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_plan_status text; v_is_pilot boolean; v_pilot_until timestamptz; v_trial_ends_at timestamptz;
BEGIN
  IF company_uuid IS NULL THEN RETURN TRUE; END IF;
  SELECT plan_status,is_pilot,pilot_until,trial_ends_at INTO v_plan_status,v_is_pilot,v_pilot_until,v_trial_ends_at
  FROM public.companies WHERE id=company_uuid;
  IF NOT FOUND THEN RETURN TRUE; END IF;
  IF coalesce(v_is_pilot,false)=true AND (v_pilot_until IS NULL OR v_pilot_until>=now()) THEN RETURN true; END IF;
  IF coalesce(v_plan_status,'trial') IN ('active','lifetime') THEN RETURN true; END IF;
  IF coalesce(v_plan_status,'trial') IN ('expired','suspended') THEN RETURN false; END IF;
  RETURN v_trial_ends_at IS NOT NULL AND v_trial_ends_at>=now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.register_device_and_touch_login(p_device_id text, p_user_agent text DEFAULT NULL::text, p_device_name text DEFAULT NULL::text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_company companies%ROWTYPE; v_company_id uuid; v_device_count int; v_existing_active boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM profiles WHERE user_id=auth.uid() AND role='super_admin') THEN RETURN 'ok'; END IF;
  SELECT cm.company_id INTO v_company_id FROM company_members cm JOIN companies c ON c.id=cm.company_id
  WHERE cm.user_id=auth.uid() AND coalesce(cm.is_active,true)
  ORDER BY CASE WHEN coalesce(c.is_pilot,false) AND (c.pilot_until IS NULL OR c.pilot_until>=now()) THEN 0
    WHEN lower(coalesce(c.plan_status,''))='lifetime' THEN 0
    WHEN lower(coalesce(c.plan_status,''))='expired' THEN 1
    WHEN lower(coalesce(c.plan_status,''))='active' THEN CASE WHEN c.license_expires_at IS NULL OR c.license_expires_at>=now() THEN 0 ELSE 1 END
    WHEN c.trial_ends_at IS NOT NULL AND c.trial_ends_at>=now() THEN 0 ELSE 1 END, cm.created_at DESC LIMIT 1;
  IF v_company_id IS NULL THEN RETURN 'no_company'; END IF;
  SELECT * INTO v_company FROM companies WHERE id=v_company_id;
  IF v_company.is_active=false OR lower(coalesce(v_company.plan_status,''))='suspended' THEN RETURN 'suspended'; END IF;
  IF lower(coalesce(v_company.plan_status,''))='expired' THEN RETURN 'expired'; END IF;
  IF lower(coalesce(v_company.plan_status,''))='active' AND v_company.license_expires_at IS NOT NULL AND v_company.license_expires_at<now() THEN RETURN 'expired'; END IF;
  IF lower(coalesce(v_company.plan_status,'')) NOT IN ('active','lifetime')
    AND NOT (coalesce(v_company.is_pilot,false) AND (v_company.pilot_until IS NULL OR v_company.pilot_until>=now()))
    AND (v_company.trial_ends_at IS NULL OR v_company.trial_ends_at<now()) THEN RETURN 'expired'; END IF;
  SELECT is_active INTO v_existing_active FROM company_devices WHERE company_id=v_company_id AND device_id=p_device_id;
  IF v_existing_active IS NOT NULL THEN
    IF v_existing_active=false THEN
      SELECT count(*) INTO v_device_count FROM company_devices WHERE company_id=v_company_id AND coalesce(is_active,true);
      IF v_device_count>=coalesce(v_company.max_devices,default_device_limit_for_package(coalesce(v_company.package_code,v_company.subscription_plan))) THEN RETURN 'device_limit'; END IF;
    END IF;
    UPDATE company_devices SET last_seen_at=now(),user_id=auth.uid(),user_agent=coalesce(p_user_agent,user_agent),device_name=coalesce(p_device_name,device_name),
      browser_name=coalesce(parse_browser_name(p_user_agent),browser_name),os_name=coalesce(parse_os_name(p_user_agent),os_name),ip_address=coalesce(inet_client_addr(),ip_address),
      is_active=true,deactivated_at=NULL,deactivated_by=NULL WHERE company_id=v_company_id AND device_id=p_device_id;
  ELSE
    SELECT count(*) INTO v_device_count FROM company_devices WHERE company_id=v_company_id AND coalesce(is_active,true);
    IF v_device_count>=coalesce(v_company.max_devices,default_device_limit_for_package(coalesce(v_company.package_code,v_company.subscription_plan))) THEN RETURN 'device_limit'; END IF;
    INSERT INTO company_devices(company_id,user_id,device_id,user_agent,device_name,browser_name,os_name,ip_address,is_active)
    VALUES(v_company_id,auth.uid(),p_device_id,p_user_agent,p_device_name,parse_browser_name(p_user_agent),parse_os_name(p_user_agent),inet_client_addr(),true)
    ON CONFLICT(company_id,device_id) DO NOTHING;
  END IF;
  UPDATE companies SET last_login_at=now() WHERE id=v_company_id;
  RETURN 'ok';
END;
$function$;

DROP FUNCTION IF EXISTS public.company_subscription_access_snapshot(uuid);
DROP FUNCTION IF EXISTS public.company_subscription_access_allowed(uuid);
NOTIFY pgrst, 'reload schema';
COMMIT;