-- ============================================================================
-- Migration 026 GERI ALMA
-- - Yeni super admin RPC'lerini kaldirir.
-- - Erisim fonksiyonlarini 026 ONCESI canli tanimlarina dondurur
--   (is_company_writable, company_subscription_allows_write,
--   check_subscription_active, register_device_and_touch_login,
--   protect_license_fields, extend_company_trial).
-- - companies.pilot_until / pilot_note kolonlari ve audit_logs kayitlari
--   VERI KAYBI OLMASIN diye birakilir. Not: geri almadan sonra pilot_until
--   dikkate ALINMAZ; is_pilot=true olan firma yeniden suresiz sayilir.
-- - GUVENLIK DUZELTMELERI BILEREK GERI ALINMAZ (profiles korumasi ve
--   company_members kendi-kendine ekleme politikalarinin kaldirilmasi).
-- ============================================================================
BEGIN;

DROP FUNCTION IF EXISTS public.super_admin_list_company_identities();
DROP FUNCTION IF EXISTS public.super_admin_get_company_access(uuid);
DROP FUNCTION IF EXISTS public.super_admin_set_trial_end(uuid, timestamptz, text);
DROP FUNCTION IF EXISTS public.super_admin_add_trial_days(uuid, integer, text);
DROP FUNCTION IF EXISTS public.super_admin_end_trial_now(uuid, text, text);
DROP FUNCTION IF EXISTS public.super_admin_set_special_access(uuid, boolean, timestamptz, text);

-- extend_company_trial: 026 oncesi canli govde
CREATE OR REPLACE FUNCTION public.extend_company_trial(p_company_id uuid, p_extra_days integer DEFAULT 7)
 RETURNS TABLE(extended_company_id uuid, new_trial_ends_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_actor_role text;
  v_extra_days integer;
  v_current_ends_at timestamptz;
  v_new_ends_at timestamptz;
BEGIN
  SELECT p.role INTO v_actor_role
  FROM public.profiles p
  WHERE p.user_id = auth.uid();

  IF COALESCE(v_actor_role, '') <> 'super_admin' THEN
    RAISE EXCEPTION 'Bu islemi sadece super yonetici yapabilir.';
  END IF;

  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Sirket secilemedi.';
  END IF;

  v_extra_days := greatest(1, least(coalesce(p_extra_days, 7), 365));

  SELECT c.trial_ends_at INTO v_current_ends_at
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sirket bulunamadi.';
  END IF;

  v_new_ends_at := greatest(coalesce(v_current_ends_at, now()), now()) + make_interval(days => v_extra_days);

  UPDATE public.companies c
  SET subscription_plan = 'trial',
      trial_ends_at = v_new_ends_at
  WHERE c.id = p_company_id;

  RETURN QUERY
  SELECT p_company_id, v_new_ends_at;
END;
$function$;
GRANT EXECUTE ON FUNCTION public.extend_company_trial(uuid, integer) TO authenticated;

DROP FUNCTION IF EXISTS public.super_admin_apply_trial_end(uuid, timestamptz);
DROP FUNCTION IF EXISTS public.super_admin_assert_trial_editable(public.companies);
DROP FUNCTION IF EXISTS public.super_admin_log_access_change(uuid, text, jsonb, jsonb, text);
DROP FUNCTION IF EXISTS public.super_admin_require();
DROP FUNCTION IF EXISTS public.super_admin_access_snapshot(uuid);

CREATE OR REPLACE FUNCTION public.is_company_writable(p_company_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (
    is_super_admin()
    OR (
      EXISTS (
        SELECT 1
        FROM public.company_members
        WHERE user_id = auth.uid()
          AND company_id = p_company_id
          AND role IN ('admin', 'owner')
      )
      AND EXISTS (
        SELECT 1
        FROM public.companies c
        WHERE c.id = p_company_id
          AND COALESCE(c.is_active, true) = true
          AND COALESCE(c.read_only, false) = false
          AND COALESCE(c.plan_status, 'trial') NOT IN ('suspended', 'expired')
          AND (
            COALESCE(c.is_pilot, false) = true
            OR COALESCE(c.plan_status, 'trial') = 'lifetime'
            OR (
              COALESCE(c.plan_status, 'trial') = 'active'
              AND (c.license_expires_at IS NULL OR c.license_expires_at >= now())
            )
            OR (
              COALESCE(c.plan_status, 'trial') = 'trial'
              AND c.trial_ends_at IS NOT NULL
              AND c.trial_ends_at >= now()
            )
          )
      )
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.company_subscription_allows_write(p_company_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT coalesce((
    SELECT
      coalesce(c.is_active, true)
      AND NOT coalesce(c.read_only, false)
      AND lower(coalesce(c.plan_status, '')) <> 'suspended'
      AND (
        coalesce(c.is_pilot, false)
        OR CASE lower(coalesce(c.plan_status, ''))
             WHEN 'expired'  THEN false
             WHEN 'lifetime' THEN true
             WHEN 'active'   THEN (c.license_expires_at IS NULL OR c.license_expires_at >= now())
             ELSE (c.trial_ends_at IS NOT NULL AND c.trial_ends_at >= now())
           END
      )
    FROM public.companies c
    WHERE c.id = p_company_id
  ), false)
$function$;

CREATE OR REPLACE FUNCTION public.check_subscription_active(company_uuid uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_plan_status text;
  v_is_pilot boolean;
  v_trial_ends_at timestamptz;
BEGIN
  IF company_uuid IS NULL THEN
    RETURN TRUE;
  END IF;

  SELECT plan_status, is_pilot, trial_ends_at
    INTO v_plan_status, v_is_pilot, v_trial_ends_at
  FROM public.companies
  WHERE id = company_uuid;

  IF NOT FOUND THEN
    RETURN TRUE;
  END IF;

  IF COALESCE(v_is_pilot, false) = true THEN
    RETURN true;
  END IF;

  IF COALESCE(v_plan_status, 'trial') IN ('active', 'lifetime') THEN
    RETURN true;
  END IF;

  IF COALESCE(v_plan_status, 'trial') IN ('expired', 'suspended') THEN
    RETURN false;
  END IF;

  RETURN v_trial_ends_at IS NOT NULL AND v_trial_ends_at >= now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.protect_license_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
    IF EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'super_admin') THEN
        RETURN NEW;
    END IF;
    -- service_role / sistem cagrilari (auth.uid() null) serbest
    IF auth.uid() IS NULL THEN RETURN NEW; END IF;

    IF NEW.plan_status         IS DISTINCT FROM OLD.plan_status
    OR NEW.subscription_plan   IS DISTINCT FROM OLD.subscription_plan
    OR NEW.package_code        IS DISTINCT FROM OLD.package_code
    OR NEW.enabled_modules     IS DISTINCT FROM OLD.enabled_modules
    OR NEW.trial_end           IS DISTINCT FROM OLD.trial_end
    OR NEW.trial_ends_at       IS DISTINCT FROM OLD.trial_ends_at
    OR NEW.is_active           IS DISTINCT FROM OLD.is_active
    OR NEW.read_only           IS DISTINCT FROM OLD.read_only
    OR NEW.max_users           IS DISTINCT FROM OLD.max_users
    OR NEW.max_devices         IS DISTINCT FROM OLD.max_devices
    OR NEW.is_pilot            IS DISTINCT FROM OLD.is_pilot THEN
        RAISE EXCEPTION 'Lisans alanlarını yalnızca super admin değiştirebilir.';
    END IF;
    RETURN NEW;
END;
$function$;

-- register_device_and_touch_login: migration 023 (canli) govdesi
CREATE OR REPLACE FUNCTION public.register_device_and_touch_login(
    p_device_id TEXT,
    p_user_agent TEXT DEFAULT NULL::text,
    p_device_name TEXT DEFAULT NULL::text
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_company companies%ROWTYPE;
    v_company_id UUID;
    v_device_count INT;
    v_existing_active BOOLEAN;
BEGIN
    IF EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'super_admin') THEN
        RETURN 'ok';
    END IF;

    -- Istemci (pickPrimaryMembership) ile AYNI secim: once suresi dolmamis firma,
    -- sonra en yeni uyelik. Eskiden "en eski uyelik" secilip eski/dolu firmanin
    -- cihaz limiti kontrol ediliyordu.
    SELECT cm.company_id INTO v_company_id
    FROM company_members cm
    JOIN companies c ON c.id = cm.company_id
    WHERE cm.user_id = auth.uid() AND COALESCE(cm.is_active, true)
    ORDER BY
        CASE
            WHEN COALESCE(c.is_pilot, false) THEN 0
            WHEN lower(COALESCE(c.plan_status, '')) = 'lifetime' THEN 0
            WHEN lower(COALESCE(c.plan_status, '')) = 'expired' THEN 1
            WHEN lower(COALESCE(c.plan_status, '')) = 'active'
                 THEN CASE WHEN c.license_expires_at IS NULL OR c.license_expires_at >= now() THEN 0 ELSE 1 END
            WHEN c.trial_ends_at IS NOT NULL AND c.trial_ends_at >= now() THEN 0
            ELSE 1
        END,
        cm.created_at DESC
    LIMIT 1;

    IF v_company_id IS NULL THEN RETURN 'no_company'; END IF;

    SELECT * INTO v_company FROM companies WHERE id = v_company_id;

    IF v_company.is_active = false OR lower(COALESCE(v_company.plan_status, '')) = 'suspended' THEN
        RETURN 'suspended';
    END IF;

    IF lower(COALESCE(v_company.plan_status, '')) = 'expired' THEN
        RETURN 'expired';
    END IF;

    IF lower(COALESCE(v_company.plan_status, '')) = 'active'
       AND v_company.license_expires_at IS NOT NULL
       AND v_company.license_expires_at < now() THEN
        RETURN 'expired';
    END IF;

    IF lower(COALESCE(v_company.plan_status, '')) NOT IN ('active', 'lifetime')
       AND COALESCE(v_company.is_pilot, false) = false
       AND (v_company.trial_ends_at IS NULL OR v_company.trial_ends_at < now()) THEN
        RETURN 'expired';
    END IF;

    SELECT is_active INTO v_existing_active
    FROM company_devices
    WHERE company_id = v_company_id AND device_id = p_device_id;

    IF v_existing_active IS NOT NULL THEN
        IF v_existing_active = false THEN
            SELECT count(*) INTO v_device_count
            FROM company_devices
            WHERE company_id = v_company_id AND COALESCE(is_active, true);

            IF v_device_count >= COALESCE(v_company.max_devices, default_device_limit_for_package(COALESCE(v_company.package_code, v_company.subscription_plan))) THEN
                RETURN 'device_limit';
            END IF;
        END IF;

        UPDATE company_devices
        SET last_seen_at = now(),
            user_id = auth.uid(),
            user_agent = COALESCE(p_user_agent, user_agent),
            device_name = COALESCE(p_device_name, device_name),
            browser_name = COALESCE(parse_browser_name(p_user_agent), browser_name),
            os_name = COALESCE(parse_os_name(p_user_agent), os_name),
            ip_address = COALESCE(inet_client_addr(), ip_address),
            is_active = true,
            deactivated_at = NULL,
            deactivated_by = NULL
        WHERE company_id = v_company_id AND device_id = p_device_id;
    ELSE
        SELECT count(*) INTO v_device_count
        FROM company_devices
        WHERE company_id = v_company_id AND COALESCE(is_active, true);

        IF v_device_count >= COALESCE(v_company.max_devices, default_device_limit_for_package(COALESCE(v_company.package_code, v_company.subscription_plan))) THEN
            RETURN 'device_limit';
        END IF;

        INSERT INTO company_devices (
            company_id, user_id, device_id, user_agent, device_name,
            browser_name, os_name, ip_address, is_active
        )
        VALUES (
            v_company_id, auth.uid(), p_device_id, p_user_agent, p_device_name,
            parse_browser_name(p_user_agent), parse_os_name(p_user_agent), inet_client_addr(), true
        )
        ON CONFLICT (company_id, device_id) DO NOTHING;
    END IF;

    UPDATE companies SET last_login_at = now() WHERE id = v_company_id;

    RETURN 'ok';
END;
$function$;


NOTIFY pgrst, 'reload schema';

COMMIT;
