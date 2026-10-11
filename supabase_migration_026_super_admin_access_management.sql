-- ============================================================================
-- Migration 026: Super admin deneme / ozel kullanim hakki yonetimi
--                + iki kritik yetki acigi kapatma
--
-- Canli yapi salt okunur sorgularla incelendi (2026-10-03). 024 ve 025'e
-- ait dosyalar DEGISTIRILMEZ ve yeniden calistirilmaz.
--
-- 1) GUVENLIK (canlida dogrulanan aciklar):
--    a) profiles_self_update politikasi + kolon yetkisi: her oturum acik
--       kullanici kendi profiles.role degerini 'super_admin' yapabiliyor.
--       -> profiles uzerinde BEFORE UPDATE korumasi: istemciden (PostgREST
--          rolu authenticated/anon) gelen guncellemede super_admin rolu
--          verilemez/alinamaz, kullanici kendi rolunu ve is_active alanini
--          degistiremez. SECURITY DEFINER RPC'ler (postgres) etkilenmez.
--          Firma yoneticisinin personel rolunu degistirmesi (StaffManagement)
--          aynen calisir.
--    b) company_members INSERT politikalari ("cm_insert_own" ve
--       "Kullanıcılar kendilerini şirkete kaydedebilir"): her kullanici
--       kendini HERHANGI bir firmaya istedigi rolle ekleyebiliyor.
--       -> Bu iki politika kaldirilir. Uygulama company_members'a dogrudan
--          yazmiyor; davet/kayit RPC'leri postgres (BYPASSRLS) ile calisiyor.
--
-- 2) companies.pilot_until / pilot_note: mevcut is_pilot (ozel kullanim)
--    altyapisina sure eklenir. pilot_until NULL = suresiz (eski davranis).
--    Mevcut pilot firmalar suresiz kalir (veri degismez).
--    Yazma/erisim kararlari ozel hakki yalnizca suresi dolmamissa sayar:
--    is_company_writable, company_subscription_allows_write,
--    register_device_and_touch_login, check_subscription_active.
--    (Govdeler canlidaki tanimlarin birebir kopyasidir; yalnizca is_pilot
--    kosuluna "pilot_until IS NULL OR pilot_until >= now()" eklendi.)
--
-- 3) protect_license_fields: firma yoneticisinin kendi firmasinda
--    degistirememesi gereken alanlara license_expires_at, subscription_status,
--    payment_reference, billing_note, trial_start, trial_started_at,
--    signup_source, pilot_until, pilot_note eklenir.
--
-- 4) Super admin RPC'leri (yetki SUNUCUDA is_super_admin() ile kontrol edilir,
--    satir kilitlenir, islem gecmisi ayni transaction'da audit_logs'a yazilir):
--      super_admin_list_company_identities()
--      super_admin_get_company_access(uuid)
--      super_admin_set_trial_end(uuid, timestamptz, text)
--      super_admin_add_trial_days(uuid, integer, text)
--      super_admin_end_trial_now(uuid, text, text)
--      super_admin_set_special_access(uuid, boolean, timestamptz, text)
--    Mevcut extend_company_trial(uuid,int) ayni imzayla korunur, ayni
--    kurallarla calisir (artik subscription_plan'i 'trial'a ezmez, suresi
--    dolmus firmada erisimi geri getirir, gecmise yazilir).
--
--    Hicbir islem trial_grants'a dokunmaz: ucretsiz deneme hakki sifirlanmaz.
--    Hicbir islem plan_status'u 'active'/'lifetime' yapmaz, odeme alanlarina
--    yazmaz: sahte abonelik olusmaz.
--
-- Tekrar calistirilabilir. Geri alma: supabase_migration_026_rollback.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) On kosullar
-- ---------------------------------------------------------------------------
DO $pre$
BEGIN
  IF to_regprocedure('public.company_subscription_allows_write(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: migration 024 bulunamadi.';
  END IF;
  IF to_regprocedure('public.is_super_admin()') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: is_super_admin() bulunamadi.';
  END IF;
  IF to_regprocedure('public.register_device_and_touch_login(text,text,text)') IS NULL
     OR to_regprocedure('public.is_company_writable(uuid)') IS NULL
     OR to_regprocedure('public.check_subscription_active(uuid)') IS NULL
     OR to_regprocedure('public.protect_license_fields()') IS NULL
     OR to_regprocedure('public.extend_company_trial(uuid,integer)') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: beklenen mevcut fonksiyonlardan biri yok (register_device/is_company_writable/check_subscription_active/protect_license_fields/extend_company_trial).';
  END IF;
  IF (SELECT count(*) FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'audit_logs'
        AND column_name IN ('company_id', 'actor_user_id', 'action', 'entity_table', 'entity_id', 'metadata', 'created_at')) <> 7 THEN
    RAISE EXCEPTION 'PREFLIGHT: audit_logs beklenen kolonlara sahip degil.';
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------
-- 1a) profiles: istemciden yetki yukseltmeyi engelle
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
RETURNS trigger
LANGUAGE plpgsql
-- SECURITY INVOKER bilerek: current_user, istegin PostgREST rolunu gosterir.
SET search_path = public
AS $fn$
BEGIN
  -- Yalnizca dogrudan istemci istekleri (PostgREST: authenticated / anon).
  -- SECURITY DEFINER RPC'ler (postgres), service role ve SQL Editor etkilenmez.
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN new;
  END IF;

  IF public.is_super_admin() THEN
    RETURN new;
  END IF;

  IF tg_op = 'INSERT' THEN
    IF lower(coalesce(new.role, '')) = 'super_admin' THEN
      RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: Bu rol atanamaz.' USING ERRCODE = '42501';
    END IF;
    RETURN new;
  END IF;

  IF new.role IS DISTINCT FROM old.role THEN
    IF lower(coalesce(new.role, '')) = 'super_admin' OR lower(coalesce(old.role, '')) = 'super_admin' THEN
      RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: Süper yönetici rolü bu yolla değiştirilemez.' USING ERRCODE = '42501';
    END IF;
    IF old.user_id = auth.uid() THEN
      RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: Kendi rolünüzü değiştiremezsiniz.' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF new.is_active IS DISTINCT FROM old.is_active AND old.user_id = auth.uid() THEN
    RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: Kendi hesap durumunuzu değiştiremezsiniz.' USING ERRCODE = '42501';
  END IF;

  IF new.user_id IS DISTINCT FROM old.user_id THEN
    RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: Profil sahibi değiştirilemez.' USING ERRCODE = '42501';
  END IF;

  RETURN new;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_protect_profile_privileged_fields ON public.profiles;
CREATE TRIGGER trg_protect_profile_privileged_fields
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_privileged_fields();

-- ---------------------------------------------------------------------------
-- 1b) company_members: herkesin kendini herhangi bir firmaya eklemesini kapat
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS cm_insert_own ON public.company_members;
DROP POLICY IF EXISTS "Kullanıcılar kendilerini şirkete kaydedebilir" ON public.company_members;

-- ---------------------------------------------------------------------------
-- 2) Ozel kullanim hakki suresi
-- ---------------------------------------------------------------------------
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS pilot_until timestamptz;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS pilot_note text;
COMMENT ON COLUMN public.companies.pilot_until IS
  'Ozel kullanim (is_pilot) hakkinin bitisi. NULL = suresiz. Ucretli abonelik DEGILDIR.';

-- 2a) is_company_writable (canli govde + pilot suresi)
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
            (COALESCE(c.is_pilot, false) = true AND (c.pilot_until IS NULL OR c.pilot_until >= now()))
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

-- 2b) company_subscription_allows_write (canli govde + pilot suresi)
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
        (coalesce(c.is_pilot, false) AND (c.pilot_until IS NULL OR c.pilot_until >= now()))
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

-- 2c) check_subscription_active (canli govde + pilot suresi)
CREATE OR REPLACE FUNCTION public.check_subscription_active(company_uuid uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_plan_status text;
  v_is_pilot boolean;
  v_pilot_until timestamptz;
  v_trial_ends_at timestamptz;
BEGIN
  IF company_uuid IS NULL THEN
    RETURN TRUE;
  END IF;

  SELECT plan_status, is_pilot, pilot_until, trial_ends_at
    INTO v_plan_status, v_is_pilot, v_pilot_until, v_trial_ends_at
  FROM public.companies
  WHERE id = company_uuid;

  IF NOT FOUND THEN
    RETURN TRUE;
  END IF;

  IF COALESCE(v_is_pilot, false) = true AND (v_pilot_until IS NULL OR v_pilot_until >= now()) THEN
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

-- 2d) register_device_and_touch_login (canli govde + pilot suresi)
CREATE OR REPLACE FUNCTION public.register_device_and_touch_login(p_device_id text, p_user_agent text DEFAULT NULL::text, p_device_name text DEFAULT NULL::text)
 RETURNS text
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

    SELECT cm.company_id INTO v_company_id
    FROM company_members cm
    JOIN companies c ON c.id = cm.company_id
    WHERE cm.user_id = auth.uid() AND COALESCE(cm.is_active, true)
    ORDER BY
        CASE
            WHEN COALESCE(c.is_pilot, false) AND (c.pilot_until IS NULL OR c.pilot_until >= now()) THEN 0
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
       AND NOT (COALESCE(v_company.is_pilot, false) AND (v_company.pilot_until IS NULL OR v_company.pilot_until >= now()))
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

-- ---------------------------------------------------------------------------
-- 3) protect_license_fields: korunan alanlar genisletildi
-- ---------------------------------------------------------------------------
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
    OR NEW.is_pilot            IS DISTINCT FROM OLD.is_pilot
    -- 026 ile eklenenler
    OR NEW.pilot_until         IS DISTINCT FROM OLD.pilot_until
    OR NEW.pilot_note          IS DISTINCT FROM OLD.pilot_note
    OR NEW.license_expires_at  IS DISTINCT FROM OLD.license_expires_at
    OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
    OR NEW.payment_reference   IS DISTINCT FROM OLD.payment_reference
    OR NEW.billing_note        IS DISTINCT FROM OLD.billing_note
    OR NEW.trial_start         IS DISTINCT FROM OLD.trial_start
    OR NEW.trial_started_at    IS DISTINCT FROM OLD.trial_started_at
    OR NEW.signup_source       IS DISTINCT FROM OLD.signup_source THEN
        RAISE EXCEPTION 'Lisans alanlarını yalnızca super admin değiştirebilir.';
    END IF;
    RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4) Ortak yardimcilar (disaridan cagrilamaz)
-- ---------------------------------------------------------------------------
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
    'special_access_active', coalesce(c.is_pilot, false) AND (c.pilot_until IS NULL OR c.pilot_until > now()),
    'writable', public.company_subscription_allows_write(c.id),
    'signup_source', c.signup_source,
    'server_time', now()
  )
  FROM public.companies c
  WHERE c.id = p_company_id
$fn$;

CREATE OR REPLACE FUNCTION public.super_admin_require()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.is_super_admin(), false) THEN
    RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: Bu işlem yalnızca süper yönetici tarafından yapılabilir.' USING ERRCODE = '42501';
  END IF;
  RETURN auth.uid();
END;
$fn$;

CREATE OR REPLACE FUNCTION public.super_admin_log_access_change(
  p_company_id uuid, p_action text, p_before jsonb, p_after jsonb, p_reason text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  INSERT INTO public.audit_logs (company_id, actor_user_id, user_id, action, entity_table, entity_type, entity_id, metadata, details)
  VALUES (
    p_company_id, auth.uid(), auth.uid(), p_action, 'companies', 'companies', p_company_id,
    jsonb_build_object(
      'before', p_before,
      'after', p_after,
      'reason', nullif(trim(coalesce(p_reason, '')), ''),
      'actor_email', (SELECT lower(u.email) FROM auth.users u WHERE u.id = auth.uid()),
      'server_time', now()
    ),
    NULL
  );
END;
$fn$;

-- Bir firmanin deneme alanlarini degistirebilir mi? (ucretli/kalici lisans veya askida firmada deneme uygulanmaz)
CREATE OR REPLACE FUNCTION public.super_admin_assert_trial_editable(p_company public.companies)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $fn$
BEGIN
  IF lower(coalesce(p_company.plan_status, '')) IN ('active', 'lifetime') THEN
    RAISE EXCEPTION 'PERDEPRO_TRIAL_NOT_APPLICABLE: Bu firmanın % lisansı var; deneme süresi uygulanmaz. Lisansı Lisans Yönetimi ekranından yönetin.',
      CASE lower(p_company.plan_status) WHEN 'lifetime' THEN 'kalıcı' ELSE 'aktif' END;
  END IF;
  IF lower(coalesce(p_company.plan_status, '')) = 'suspended' OR coalesce(p_company.is_active, true) = false THEN
    RAISE EXCEPTION 'PERDEPRO_TRIAL_NOT_APPLICABLE: Firma askıda veya pasif. Önce firmayı aktif hale getirin.';
  END IF;
END;
$fn$;

-- Ortak: deneme bitisini yaz (erisim kurallari mevcut fonksiyonlara gore isler)
CREATE OR REPLACE FUNCTION public.super_admin_apply_trial_end(p_company_id uuid, p_new_end timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  UPDATE public.companies c
     SET trial_ends_at = p_new_end,
         trial_end = p_new_end,
         -- Suresi dolmus olarak isaretlenmis deneme firmasi, ileri tarihli
         -- bitisle tekrar 'trial' olur. Ucretli/kalici duruma ASLA cevrilmez.
         plan_status = CASE WHEN lower(coalesce(c.plan_status, '')) = 'expired' AND p_new_end > now() THEN 'trial' ELSE c.plan_status END,
         subscription_status = CASE WHEN lower(coalesce(c.subscription_status, '')) = 'expired' AND p_new_end > now() THEN 'trial' ELSE c.subscription_status END,
         updated_by = auth.uid()
   WHERE c.id = p_company_id;
END;
$fn$;

REVOKE ALL ON FUNCTION public.super_admin_access_snapshot(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.super_admin_require() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.super_admin_log_access_change(uuid, text, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.super_admin_assert_trial_editable(public.companies) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.super_admin_apply_trial_end(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5) Firma kimlikleri: ayni isimli firmalari ayirmak icin
--    Yoneticiler company_members'tan (admin/owner) okunur; owner_id ayrica
--    gosterilir ve uye olup olmadigi belirtilir (rastgele uye "sahip" sayilmaz).
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.super_admin_list_company_identities();
CREATE OR REPLACE FUNCTION public.super_admin_list_company_identities()
RETURNS TABLE (
  company_id uuid,
  name text,
  created_at timestamptz,
  admins jsonb,
  owner_user_id uuid,
  owner_email text,
  owner_is_admin_member boolean,
  active_member_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  PERFORM public.super_admin_require();
  RETURN QUERY
  SELECT
    c.id,
    c.name,
    c.created_at,
    coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'user_id', m.user_id,
               'email', lower(u.email),
               'full_name', p.full_name,
               'role', m.role,
               'is_active', coalesce(m.is_active, true),
               'is_owner_id', m.user_id = c.owner_id
             ) ORDER BY coalesce(m.is_active, true) DESC, m.created_at)
      FROM public.company_members m
      LEFT JOIN auth.users u ON u.id = m.user_id
      LEFT JOIN public.profiles p ON p.user_id = m.user_id
      WHERE m.company_id = c.id AND m.role IN ('admin', 'owner')
    ), '[]'::jsonb),
    c.owner_id,
    (SELECT lower(u.email) FROM auth.users u WHERE u.id = c.owner_id),
    EXISTS (SELECT 1 FROM public.company_members m WHERE m.company_id = c.id AND m.user_id = c.owner_id AND m.role IN ('admin', 'owner')),
    (SELECT count(*)::int FROM public.company_members m WHERE m.company_id = c.id AND coalesce(m.is_active, true))
  FROM public.companies c
  ORDER BY c.created_at DESC;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 6) Firma erisim durumu + islem gecmisi
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.super_admin_get_company_access(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_snapshot jsonb;
BEGIN
  PERFORM public.super_admin_require();

  v_snapshot := public.super_admin_access_snapshot(p_company_id);
  IF v_snapshot IS NULL THEN
    RAISE EXCEPTION 'PERDEPRO_NOT_FOUND: Firma bulunamadı.';
  END IF;

  RETURN v_snapshot || jsonb_build_object(
    'admins', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'user_id', m.user_id, 'email', lower(u.email), 'full_name', p.full_name,
               'role', m.role, 'is_active', coalesce(m.is_active, true),
               'is_owner_id', m.user_id = c.owner_id
             ) ORDER BY coalesce(m.is_active, true) DESC, m.created_at)
      FROM public.companies c
      JOIN public.company_members m ON m.company_id = c.id AND m.role IN ('admin', 'owner')
      LEFT JOIN auth.users u ON u.id = m.user_id
      LEFT JOIN public.profiles p ON p.user_id = m.user_id
      WHERE c.id = p_company_id
    ), '[]'::jsonb),
    'owner_email', (SELECT lower(u.email) FROM public.companies c JOIN auth.users u ON u.id = c.owner_id WHERE c.id = p_company_id),
    'owner_is_admin_member', (SELECT EXISTS (SELECT 1 FROM public.company_members m WHERE m.company_id = c.id AND m.user_id = c.owner_id AND m.role IN ('admin', 'owner')) FROM public.companies c WHERE c.id = p_company_id),
    'free_trial_used', (
      SELECT jsonb_build_object('source', g.source, 'trial_started_at', g.trial_started_at, 'trial_ends_at', g.trial_ends_at)
      FROM public.trial_grants g WHERE g.first_company_id = p_company_id ORDER BY g.created_at LIMIT 1
    ),
    'history', coalesce((
      SELECT jsonb_agg(h ORDER BY (h->>'created_at') DESC)
      FROM (
        SELECT jsonb_build_object(
                 'created_at', a.created_at,
                 'action', a.action,
                 'actor_email', coalesce(a.metadata->>'actor_email', (SELECT lower(u.email) FROM auth.users u WHERE u.id = a.actor_user_id)),
                 'before', a.metadata->'before',
                 'after', a.metadata->'after',
                 'reason', a.metadata->>'reason'
               ) AS h
        FROM public.audit_logs a
        JOIN public.profiles pr ON pr.user_id = a.actor_user_id AND pr.role = 'super_admin'
        WHERE a.company_id = p_company_id
          AND a.entity_table = 'companies'
          AND a.action IN ('SUPER_ADMIN_TRIAL_END_SET', 'SUPER_ADMIN_TRIAL_DAYS_ADDED', 'SUPER_ADMIN_TRIAL_ENDED_NOW',
                           'SUPER_ADMIN_SPECIAL_ACCESS_GRANTED', 'SUPER_ADMIN_SPECIAL_ACCESS_REVOKED')
        ORDER BY a.created_at DESC
        LIMIT 25
      ) x
    ), '[]'::jsonb)
  );
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 7) Deneme bitisini tarih/saat olarak ayarla
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.super_admin_set_trial_end(
  p_company_id uuid,
  p_trial_ends_at timestamptz,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_company public.companies%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
BEGIN
  PERFORM public.super_admin_require();

  IF p_trial_ends_at IS NULL THEN
    RAISE EXCEPTION 'PERDEPRO_INVALID: Bitiş tarihi ve saati zorunludur.';
  END IF;
  IF p_trial_ends_at > now() + interval '3 years' THEN
    RAISE EXCEPTION 'PERDEPRO_INVALID: Deneme bitişi en fazla 3 yıl sonrası olabilir. Uzun süreli kullanım için özel kullanım hakkı verin.';
  END IF;

  SELECT * INTO v_company FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PERDEPRO_NOT_FOUND: Firma bulunamadı.';
  END IF;
  PERFORM public.super_admin_assert_trial_editable(v_company);

  v_before := public.super_admin_access_snapshot(p_company_id);
  PERFORM public.super_admin_apply_trial_end(p_company_id, p_trial_ends_at);
  v_after := public.super_admin_access_snapshot(p_company_id);
  PERFORM public.super_admin_log_access_change(p_company_id, 'SUPER_ADMIN_TRIAL_END_SET', v_before, v_after, p_reason);

  RETURN jsonb_build_object('before', v_before, 'after', v_after);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 8) Denemeye gun ekle
--    Suresi dolmamissa: mevcut bitise eklenir.
--    Suresi dolmussa: SIMDIDEN itibaren eklenir (gecmis gunler geri verilmez).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.super_admin_add_trial_days(
  p_company_id uuid,
  p_days integer,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_company public.companies%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
  v_new_end timestamptz;
BEGIN
  PERFORM public.super_admin_require();

  IF p_days IS NULL OR p_days < 1 OR p_days > 365 THEN
    RAISE EXCEPTION 'PERDEPRO_INVALID: Eklenecek gün 1 ile 365 arasında olmalı.';
  END IF;

  SELECT * INTO v_company FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PERDEPRO_NOT_FOUND: Firma bulunamadı.';
  END IF;
  PERFORM public.super_admin_assert_trial_editable(v_company);

  v_new_end := greatest(coalesce(v_company.trial_ends_at, now()), now()) + make_interval(days => p_days);

  v_before := public.super_admin_access_snapshot(p_company_id);
  PERFORM public.super_admin_apply_trial_end(p_company_id, v_new_end);
  v_after := public.super_admin_access_snapshot(p_company_id);
  PERFORM public.super_admin_log_access_change(
    p_company_id, 'SUPER_ADMIN_TRIAL_DAYS_ADDED', v_before,
    v_after || jsonb_build_object('added_days', p_days,
                                  'calculated_from', CASE WHEN v_company.trial_ends_at IS NOT NULL AND v_company.trial_ends_at > now() THEN 'mevcut_bitis' ELSE 'simdi' END),
    p_reason);

  RETURN jsonb_build_object('before', v_before, 'after', v_after);
END;
$fn$;

-- Mevcut "Gun Ekle" fonksiyonu: ayni imza, ayni donus tipi; artik yukaridaki kurallarla calisir.
CREATE OR REPLACE FUNCTION public.extend_company_trial(p_company_id uuid, p_extra_days integer DEFAULT 7)
RETURNS TABLE(extended_company_id uuid, new_trial_ends_at timestamp with time zone)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.super_admin_add_trial_days(p_company_id, greatest(1, least(coalesce(p_extra_days, 7), 365)), 'extend_company_trial');
  RETURN QUERY SELECT p_company_id, (v_result->'after'->>'trial_ends_at')::timestamptz;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 9) Denemeyi simdi bitir (firma adi teyidi zorunlu; veriler silinmez)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.super_admin_end_trial_now(
  p_company_id uuid,
  p_confirm_name text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_company public.companies%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
BEGIN
  PERFORM public.super_admin_require();

  SELECT * INTO v_company FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PERDEPRO_NOT_FOUND: Firma bulunamadı.';
  END IF;
  IF p_confirm_name IS DISTINCT FROM v_company.name THEN
    RAISE EXCEPTION 'PERDEPRO_CONFIRM_MISMATCH: Firma adı teyidi eşleşmedi; işlem yapılmadı.';
  END IF;
  PERFORM public.super_admin_assert_trial_editable(v_company);
  IF v_company.trial_ends_at IS NOT NULL AND v_company.trial_ends_at <= now() THEN
    RAISE EXCEPTION 'PERDEPRO_ALREADY_ENDED: Bu firmanın denemesi zaten bitmiş.';
  END IF;

  v_before := public.super_admin_access_snapshot(p_company_id);
  PERFORM public.super_admin_apply_trial_end(p_company_id, now());
  v_after := public.super_admin_access_snapshot(p_company_id);
  PERFORM public.super_admin_log_access_change(p_company_id, 'SUPER_ADMIN_TRIAL_ENDED_NOW', v_before, v_after, p_reason);

  RETURN jsonb_build_object('before', v_before, 'after', v_after);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 10) Ozel kullanim hakki ver / kaldir (mevcut is_pilot altyapisi)
--     Odeme/abonelik alanlarina DOKUNMAZ.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.super_admin_set_special_access(
  p_company_id uuid,
  p_enabled boolean,
  p_until timestamptz DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_company public.companies%ROWTYPE;
  v_before jsonb;
  v_after jsonb;
BEGIN
  PERFORM public.super_admin_require();

  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'PERDEPRO_INVALID: Ver/kaldır seçimi zorunludur.';
  END IF;

  SELECT * INTO v_company FROM public.companies WHERE id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PERDEPRO_NOT_FOUND: Firma bulunamadı.';
  END IF;

  IF p_enabled THEN
    IF p_until IS NOT NULL AND p_until <= now() THEN
      RAISE EXCEPTION 'PERDEPRO_INVALID: Özel kullanım bitişi gelecekte olmalı. Süresiz için tarih boş bırakılır.';
    END IF;
    IF length(trim(coalesce(p_note, ''))) < 3 THEN
      RAISE EXCEPTION 'PERDEPRO_INVALID: Özel kullanım hakkı için kısa bir açıklama yazın.';
    END IF;
  ELSIF NOT coalesce(v_company.is_pilot, false) THEN
    RAISE EXCEPTION 'PERDEPRO_INVALID: Bu firmada özel kullanım hakkı yok.';
  END IF;

  v_before := public.super_admin_access_snapshot(p_company_id);

  UPDATE public.companies c
     SET is_pilot = p_enabled,
         pilot_until = CASE WHEN p_enabled THEN p_until ELSE NULL END,
         pilot_note = CASE WHEN p_enabled THEN trim(p_note) ELSE c.pilot_note END,
         updated_by = auth.uid()
   WHERE c.id = p_company_id;

  v_after := public.super_admin_access_snapshot(p_company_id);
  PERFORM public.super_admin_log_access_change(
    p_company_id,
    CASE WHEN p_enabled THEN 'SUPER_ADMIN_SPECIAL_ACCESS_GRANTED' ELSE 'SUPER_ADMIN_SPECIAL_ACCESS_REVOKED' END,
    v_before, v_after, p_note);

  RETURN jsonb_build_object('before', v_before, 'after', v_after);
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 11) Yetkiler: yalnizca oturum acmis kullanici cagirabilir; super admin
--     kontrolu her fonksiyonun icinde SUNUCUDA yapilir.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.super_admin_list_company_identities() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.super_admin_get_company_access(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.super_admin_set_trial_end(uuid, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.super_admin_add_trial_days(uuid, integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.super_admin_end_trial_now(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.super_admin_set_special_access(uuid, boolean, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.extend_company_trial(uuid, integer) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.super_admin_list_company_identities() TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_get_company_access(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_set_trial_end(uuid, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_add_trial_days(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_end_trial_now(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_set_special_access(uuid, boolean, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.extend_company_trial(uuid, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
