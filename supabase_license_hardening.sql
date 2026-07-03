-- ============================================================
-- PERDEPRO - Lisans & Dağıtım Güvenliği Sertleştirme
-- Tamamen eklemeli (additive) — mevcut akışları bozmaz.
-- Supabase SQL Editor'da çalıştırın.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 1. Lisans alanları
ALTER TABLE companies ADD COLUMN IF NOT EXISTS max_devices INT DEFAULT 3;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- 2. Cihaz kayıt tablosu (firma başına cihaz limiti)
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

ALTER TABLE company_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_devices_select_own" ON company_devices;
CREATE POLICY "company_devices_select_own" ON company_devices
    FOR SELECT TO authenticated
    USING (
        company_id IN (SELECT company_id FROM company_members WHERE user_id = auth.uid())
        OR EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'super_admin')
    );
-- INSERT/UPDATE yalnızca aşağıdaki SECURITY DEFINER fonksiyon üzerinden yapılır.

-- 3. Cihaz kaydı + lisans yoklaması (her açılışta istemci çağırır)
--    Dönen değerler: ok | device_limit | expired | suspended | no_company
CREATE OR REPLACE FUNCTION register_device_and_touch_login(p_device_id TEXT, p_user_agent TEXT DEFAULT NULL)
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
BEGIN
    -- Super admin cihaz limitine tabi değil
    IF EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'super_admin') THEN
        RETURN 'ok';
    END IF;

    SELECT company_id INTO v_company_id
    FROM company_members
    WHERE user_id = auth.uid() AND COALESCE(is_active, true)
    ORDER BY created_at LIMIT 1;

    IF v_company_id IS NULL THEN RETURN 'no_company'; END IF;

    SELECT * INTO v_company FROM companies WHERE id = v_company_id;

    -- Lisans durumu (sunucu taraflı — localStorage hilesiyle aşılamaz)
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

    -- Cihaz limiti
    IF NOT EXISTS (SELECT 1 FROM company_devices WHERE company_id = v_company_id AND device_id = p_device_id) THEN
        SELECT count(*) INTO v_device_count FROM company_devices WHERE company_id = v_company_id;
        IF v_device_count >= COALESCE(v_company.max_devices, 3) THEN
            RETURN 'device_limit';
        END IF;
        INSERT INTO company_devices (company_id, user_id, device_id, user_agent)
        VALUES (v_company_id, auth.uid(), p_device_id, p_user_agent)
        ON CONFLICT (company_id, device_id) DO NOTHING;
    ELSE
        UPDATE company_devices SET last_seen_at = now(), user_id = auth.uid()
        WHERE company_id = v_company_id AND device_id = p_device_id;
    END IF;

    -- Son giriş tarihi
    UPDATE companies SET last_login_at = now() WHERE id = v_company_id;

    RETURN 'ok';
END;
$$;

GRANT EXECUTE ON FUNCTION register_device_and_touch_login(TEXT, TEXT) TO authenticated;

-- 4. Giriş kodu hash'leme altyapısı (user_invites)
--    code_hash doldurulur; mevcut akış bozulmaz. Doğrulama için
--    check_invite_code kullanılabilir (düz metin karşılaştırması yerine).
ALTER TABLE user_invites ADD COLUMN IF NOT EXISTS code_hash TEXT;

-- Mevcut düz metin kodları hash'le (bir kere çalışır, idempotent)
UPDATE user_invites
SET code_hash = extensions.crypt(invite_code, extensions.gen_salt('bf'))
WHERE invite_code IS NOT NULL AND code_hash IS NULL;

-- Yeni kayıtlarda otomatik hash
CREATE OR REPLACE FUNCTION hash_invite_code()
RETURNS TRIGGER LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
    IF NEW.invite_code IS NOT NULL AND (NEW.code_hash IS NULL OR NEW.invite_code IS DISTINCT FROM OLD.invite_code) THEN
        NEW.code_hash := extensions.crypt(NEW.invite_code, extensions.gen_salt('bf'));
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hash_invite_code ON user_invites;
CREATE TRIGGER trg_hash_invite_code
    BEFORE INSERT OR UPDATE ON user_invites
    FOR EACH ROW EXECUTE FUNCTION hash_invite_code();

-- Hash üzerinden kod doğrulama yardımcısı
CREATE OR REPLACE FUNCTION check_invite_code(p_invite_id UUID, p_code TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT EXISTS (
        SELECT 1 FROM user_invites
        WHERE id = p_invite_id
          AND used_at IS NULL
          AND (expires_at IS NULL OR expires_at > now())
          AND (
              (code_hash IS NOT NULL AND code_hash = extensions.crypt(p_code, code_hash))
              OR (code_hash IS NULL AND invite_code = p_code)
          )
    );
$$;

GRANT EXECUTE ON FUNCTION check_invite_code(UUID, TEXT) TO anon, authenticated;

-- 5. Yalnızca super admin firma/lisans değiştirebilir (savunma katmanı)
DROP POLICY IF EXISTS "companies_update_super_admin_only" ON companies;
CREATE POLICY "companies_update_super_admin_only" ON companies
    FOR UPDATE TO authenticated
    USING (
        EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'super_admin')
        OR id IN (SELECT company_id FROM company_members WHERE user_id = auth.uid() AND role IN ('admin'))
    )
    WITH CHECK (
        EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'super_admin')
        OR id IN (SELECT company_id FROM company_members WHERE user_id = auth.uid() AND role IN ('admin'))
    );

DROP POLICY IF EXISTS "companies_insert_super_admin_only" ON companies;
CREATE POLICY "companies_insert_super_admin_only" ON companies
    FOR INSERT TO authenticated
    WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'super_admin'));

-- 6. Lisans alanları yalnızca super admin tarafından değiştirilebilir
--    (firma admini logo vb. güncelleyebilir ama plan/süre/limit değiştiremez)
CREATE OR REPLACE FUNCTION protect_license_fields()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'super_admin') THEN
        RETURN NEW;
    END IF;
    -- service_role / sistem çağrıları (auth.uid() null) serbest
    IF auth.uid() IS NULL THEN RETURN NEW; END IF;

    IF NEW.plan_status        IS DISTINCT FROM OLD.plan_status
    OR NEW.subscription_plan  IS DISTINCT FROM OLD.subscription_plan
    OR NEW.package_code       IS DISTINCT FROM OLD.package_code
    OR NEW.enabled_modules    IS DISTINCT FROM OLD.enabled_modules
    OR NEW.trial_end          IS DISTINCT FROM OLD.trial_end
    OR NEW.trial_ends_at      IS DISTINCT FROM OLD.trial_ends_at
    OR NEW.is_active          IS DISTINCT FROM OLD.is_active
    OR NEW.read_only          IS DISTINCT FROM OLD.read_only
    OR NEW.max_users          IS DISTINCT FROM OLD.max_users
    OR NEW.max_devices        IS DISTINCT FROM OLD.max_devices
    OR NEW.is_pilot           IS DISTINCT FROM OLD.is_pilot THEN
        RAISE EXCEPTION 'Lisans alanlarını yalnızca super admin değiştirebilir.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_license_fields ON companies;
CREATE TRIGGER trg_protect_license_fields
    BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION protect_license_fields();

NOTIFY pgrst, 'reload schema';
