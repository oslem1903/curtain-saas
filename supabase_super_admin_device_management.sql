-- ============================================================
-- PERDEPRO - Super Admin Cihaz Limiti Yonetimi
-- Additive/idempotent: mevcut lisans sistemini bozmaz.
-- Supabase SQL Editor'da calistirin.
-- ============================================================

ALTER TABLE companies ADD COLUMN IF NOT EXISTS max_devices INT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS company_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID NOT NULL,
    device_id TEXT NOT NULL,
    user_agent TEXT,
    first_seen_at TIMESTAMPTZ DEFAULT now(),
    last_seen_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (company_id, device_id)
);

CREATE TABLE IF NOT EXISTS support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID,
    title TEXT,
    description TEXT,
    category TEXT DEFAULT 'other',
    priority TEXT DEFAULT 'medium',
    page_url TEXT,
    status TEXT DEFAULT 'open',
    admin_response TEXT,
    support_metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ,
    resolved_at TIMESTAMPTZ
);

ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS support_metadata JSONB;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

ALTER TABLE company_devices ADD COLUMN IF NOT EXISTS device_name TEXT;
ALTER TABLE company_devices ADD COLUMN IF NOT EXISTS browser_name TEXT;
ALTER TABLE company_devices ADD COLUMN IF NOT EXISTS os_name TEXT;
ALTER TABLE company_devices ADD COLUMN IF NOT EXISTS ip_address INET;
ALTER TABLE company_devices ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE company_devices ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMPTZ;
ALTER TABLE company_devices ADD COLUMN IF NOT EXISTS deactivated_by UUID;

CREATE INDEX IF NOT EXISTS idx_company_devices_company_active
ON company_devices (company_id, is_active, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS idx_support_tickets_device_limit
ON support_tickets ((support_metadata->>'kind'))
WHERE support_metadata IS NOT NULL;

CREATE OR REPLACE FUNCTION default_device_limit_for_package(p_package TEXT)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN lower(COALESCE(p_package, '')) IN ('solo', 'solo_perdeci', 'starter') THEN 1
        WHEN lower(COALESCE(p_package, '')) IN ('pro', 'professional', 'yonetici') THEN 3
        ELSE 3
    END;
$$;

UPDATE companies
SET max_devices = default_device_limit_for_package(COALESCE(package_code, subscription_plan))
WHERE max_devices IS NULL;

UPDATE companies
SET max_devices = 1
WHERE lower(COALESCE(package_code, subscription_plan, '')) IN ('solo', 'solo_perdeci', 'starter')
  AND COALESCE(max_devices, 3) = 3;

CREATE OR REPLACE FUNCTION set_default_company_device_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    IF NEW.max_devices IS NULL THEN
        NEW.max_devices := default_device_limit_for_package(COALESCE(NEW.package_code, NEW.subscription_plan));
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_default_company_device_limit ON companies;
CREATE TRIGGER trg_set_default_company_device_limit
    BEFORE INSERT ON companies
    FOR EACH ROW EXECUTE FUNCTION set_default_company_device_limit();

CREATE OR REPLACE FUNCTION parse_browser_name(p_user_agent TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_user_agent ILIKE '%Edg/%' THEN 'Microsoft Edge'
        WHEN p_user_agent ILIKE '%Chrome/%' AND p_user_agent NOT ILIKE '%Chromium/%' THEN 'Google Chrome'
        WHEN p_user_agent ILIKE '%Firefox/%' THEN 'Mozilla Firefox'
        WHEN p_user_agent ILIKE '%Safari/%' AND p_user_agent NOT ILIKE '%Chrome/%' THEN 'Safari'
        WHEN p_user_agent ILIKE '%OPR/%' OR p_user_agent ILIKE '%Opera%' THEN 'Opera'
        ELSE NULL
    END;
$$;

CREATE OR REPLACE FUNCTION parse_os_name(p_user_agent TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_user_agent ILIKE '%Windows%' THEN 'Windows'
        WHEN p_user_agent ILIKE '%Android%' THEN 'Android'
        WHEN p_user_agent ILIKE '%iPhone%' OR p_user_agent ILIKE '%iPad%' THEN 'iOS'
        WHEN p_user_agent ILIKE '%Mac OS%' OR p_user_agent ILIKE '%Macintosh%' THEN 'macOS'
        WHEN p_user_agent ILIKE '%Linux%' THEN 'Linux'
        ELSE NULL
    END;
$$;

DROP FUNCTION IF EXISTS register_device_and_touch_login(TEXT, TEXT);

-- Var olan RPC genisletildi: aktif olmayan cihaz girisi engellenir,
-- limit sadece aktif cihazlara gore sayilir.
CREATE OR REPLACE FUNCTION register_device_and_touch_login(
    p_device_id TEXT,
    p_user_agent TEXT DEFAULT NULL,
    p_device_name TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company companies%ROWTYPE;
    v_company_id UUID;
    v_device_count INT;
    v_trial_end TIMESTAMPTZ;
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

    v_trial_end := COALESCE(v_company.trial_end, v_company.trial_ends_at);
    IF COALESCE(v_company.is_pilot, false) = false
       AND lower(COALESCE(v_company.plan_status, '')) NOT IN ('active', 'lifetime')
       AND (lower(COALESCE(v_company.plan_status, '')) = 'expired'
            OR (v_trial_end IS NOT NULL AND v_trial_end < now())) THEN
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
$$;

GRANT EXECUTE ON FUNCTION register_device_and_touch_login(TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION super_admin_set_company_device_limit(p_company_id UUID, p_max_devices INT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'super_admin') THEN
        RAISE EXCEPTION 'Bu islemi yalnizca super admin yapabilir.';
    END IF;
    IF p_max_devices IS NULL OR p_max_devices < 1 THEN
        RAISE EXCEPTION 'Cihaz limiti en az 1 olmalidir.';
    END IF;

    UPDATE companies SET max_devices = p_max_devices WHERE id = p_company_id;
END;
$$;

CREATE OR REPLACE FUNCTION super_admin_set_device_active(p_device_id UUID, p_is_active BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'super_admin') THEN
        RAISE EXCEPTION 'Bu islemi yalnizca super admin yapabilir.';
    END IF;

    UPDATE company_devices
    SET is_active = p_is_active,
        deactivated_at = CASE WHEN p_is_active THEN NULL ELSE now() END,
        deactivated_by = CASE WHEN p_is_active THEN NULL ELSE auth.uid() END
    WHERE id = p_device_id;
END;
$$;

CREATE OR REPLACE FUNCTION super_admin_delete_device(p_device_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'super_admin') THEN
        RAISE EXCEPTION 'Bu islemi yalnizca super admin yapabilir.';
    END IF;

    DELETE FROM company_devices WHERE id = p_device_id;
END;
$$;

CREATE OR REPLACE FUNCTION super_admin_approve_device_request(
    p_ticket_id UUID,
    p_action TEXT DEFAULT 'increase_limit',
    p_remove_device_id UUID DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id UUID;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'super_admin') THEN
        RAISE EXCEPTION 'Bu islemi yalnizca super admin yapabilir.';
    END IF;

    SELECT company_id INTO v_company_id FROM support_tickets WHERE id = p_ticket_id;
    IF v_company_id IS NULL THEN
        RAISE EXCEPTION 'Talep bulunamadi.';
    END IF;

    IF p_action = 'increase_limit' THEN
        UPDATE companies
        SET max_devices = GREATEST(
            COALESCE(max_devices, default_device_limit_for_package(COALESCE(package_code, subscription_plan))) + 1,
            (
                SELECT count(*)::INT + 1
                FROM company_devices
                WHERE company_id = v_company_id AND COALESCE(is_active, true)
            )
        )
        WHERE id = v_company_id;
    ELSIF p_action = 'remove_device' THEN
        IF p_remove_device_id IS NULL THEN
            DELETE FROM company_devices
            WHERE id = (
                SELECT id FROM company_devices
                WHERE company_id = v_company_id
                ORDER BY last_seen_at ASC NULLS FIRST, first_seen_at ASC
                LIMIT 1
            );
        ELSE
            DELETE FROM company_devices WHERE id = p_remove_device_id AND company_id = v_company_id;
        END IF;
    ELSE
        RAISE EXCEPTION 'Gecersiz onay aksiyonu.';
    END IF;

    UPDATE support_tickets
    SET status = 'resolved',
        admin_response = CASE
            WHEN p_action = 'increase_limit' THEN 'Cihaz talebiniz onaylandi. Cihaz limitiniz artirildi, tekrar giris yapabilirsiniz.'
            ELSE 'Cihaz talebiniz onaylandi. Eski cihaz kaldirildi, tekrar giris yapabilirsiniz.'
        END,
        updated_at = now(),
        resolved_at = now()
    WHERE id = p_ticket_id;
END;
$$;

GRANT EXECUTE ON FUNCTION super_admin_set_company_device_limit(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION super_admin_set_device_active(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION super_admin_delete_device(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION super_admin_approve_device_request(UUID, TEXT, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
