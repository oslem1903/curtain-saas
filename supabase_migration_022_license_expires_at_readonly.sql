-- ============================================================================
-- 022: Ucretli lisans (plan_status = 'active') suresi dolunca SALT OKUNUR.
--
-- Sorun: is_company_writable() ve register_device_and_touch_login()
-- plan_status 'active' firmalari license_expires_at'e bakmadan muaf
-- tutuyordu; lisansi biten firma yazmaya devam edebiliyordu.
--
-- Karar: Suresi dolan hesap KILITLENMEZ, salt okunur girer. Istemci
-- 'expired' donusunu salt okunur mod olarak yorumlar (AuthContext.tsx).
-- license_expires_at NULL ise lisans suresiz sayilir (degisiklik yok).
-- ============================================================================

BEGIN;

-- 1) Yazma yetkisi: aktif lisans yalnizca suresi dolmadiysa yazilabilir.
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

GRANT EXECUTE ON FUNCTION public.is_company_writable(uuid) TO PUBLIC;

-- 2) Giris yoklamasi: suresi dolmus aktif lisans 'expired' doner.
--    (Istemci bunu kilit degil salt okunur olarak isler.)
--    Govde migration 011 ile ayni; yalnizca 'active' icin tarih kontrolu eklendi.
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

    SELECT company_id INTO v_company_id
    FROM company_members
    WHERE user_id = auth.uid() AND COALESCE(is_active, true)
    ORDER BY created_at LIMIT 1;

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

GRANT EXECUTE ON FUNCTION public.register_device_and_touch_login(TEXT, TEXT, TEXT) TO PUBLIC;

COMMIT;
