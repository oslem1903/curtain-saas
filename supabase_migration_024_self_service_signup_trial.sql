-- ============================================================================
-- Migration 024: Kodsuz kayit + sunucu tarafli 7 gunluk deneme
--
-- NE YAPAR
--   1) handle_new_user(): kayit sirasinda istemcinin gonderdigi
--      raw_user_meta_data->>'role' degerine ARTIK GUVENMEZ. Eski surumler
--      'super_admin' dahil her rolu kabul ediyordu; herkese acik kayit
--      (supabase.auth.signUp) ile super_admin profili olusturulabiliyordu.
--      Yeni profiller her zaman 'installer' ile baslar; gercek rolu sunucu
--      RPC'leri (davet kabulu / kendi isletmesini olusturma) atar. Mevcut
--      profillerin rolu DEGISTIRILMEZ.
--   2) companies: trial_started_at ve signup_source kolonlari (nullable,
--      mevcut satirlara dokunulmaz).
--   3) self_signup_settings: kendi kendine kayit ac/kapa + varsayilan deneme
--      suresi/paket (tek satir, yalnizca super admin okur/yazar).
--   4) trial_grants: bir kullanici/e-posta icin deneme yalnizca BIR KEZ.
--      Kolon adi bilerek company_id DEGIL (super_admin_delete_company tum
--      company_id kolonlu tablolari temizler; deneme kaydi silinmemeli).
--      Mevcut firma yoneticileri 'legacy_backfill' olarak isaretlenir.
--   5) start_self_service_trial(): dogrulanmis e-postali oturum sahibine
--      bagimsiz isletme + admin uyeligi + deneme olusturur. Idempotent:
--      kullanici zaten bir firmaya uyeyse yeni firma/deneme OLUSTURMAZ,
--      mevcut firmayi dondurur.
--   6) company_subscription_allows_write() + is verisi tablolarinda yazma
--      korumasi (BEFORE INSERT/UPDATE/DELETE). Istemcideki isTrialExpired()
--      (src/utils/trialLicense.ts) ile ayni karar. Super admin ve oturumsuz
--      (service role / SQL Editor / cron) islemler muaftir. Okuma etkilenmez.
--
-- NE YAPMAZ
--   - Mevcut firmalarin plan/deneme/lisans alanlarini degistirmez.
--   - Mevcut RLS politikalarini, is_company_writable() ve
--     register_device_and_touch_login() fonksiyonlarini degistirmez.
--   - Davet (user_invites) akisini degistirmez.
--
-- CALISTIRMADAN ONCE: supabase_migration_024_precheck_readonly.sql
-- GERI ALMA:          supabase_migration_024_rollback.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) On kosullar
-- ---------------------------------------------------------------------------
DO $pre$
BEGIN
  IF to_regclass('public.companies') IS NULL
     OR to_regclass('public.company_members') IS NULL
     OR to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: companies/company_members/profiles tablolari bulunamadi. Migration durduruldu.';
  END IF;

  IF to_regprocedure('public.is_super_admin()') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: public.is_super_admin() bulunamadi. Migration durduruldu.';
  END IF;
END
$pre$;

-- ---------------------------------------------------------------------------
-- 1) handle_new_user: metadata rolune guvenme
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_email text;
  v_full_name text;
BEGIN
  BEGIN
    v_email := lower(coalesce(new.email, new.raw_user_meta_data->>'email', ''));
    v_full_name := nullif(trim(coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(v_email, '@', 1)
    )), '');

    -- Rol bilerek metadata'dan OKUNMAZ. Gercek rolu sunucu RPC'leri atar:
    --   accept_invite_*_for_current_user  -> davetteki rol
    --   start_self_service_trial          -> 'admin' (kendi isletmesi)
    INSERT INTO public.profiles (user_id, email, full_name, role, is_active, created_at, updated_at)
    VALUES (new.id, nullif(v_email, ''), left(v_full_name, 120), 'installer', true, now(), now())
    ON CONFLICT (user_id) DO UPDATE SET
      email      = coalesce(excluded.email, public.profiles.email),
      full_name  = coalesce(public.profiles.full_name, excluded.full_name),
      updated_at = now();
      -- role bilincli olarak guncellenmiyor
  EXCEPTION WHEN OTHERS THEN
    -- Kayit HICBIR kosulda engellenmez; hata yalnizca loglanir.
    BEGIN
      IF to_regclass('public.auth_repair_log') IS NOT NULL THEN
        EXECUTE 'insert into public.auth_repair_log(source, user_id, email, message, sqlstate) values ($1,$2,$3,$4,$5)'
          USING 'handle_new_user', new.id, coalesce(v_email, new.email), sqlerrm, sqlstate;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END;

  RETURN new;
END;
$fn$;

DO $trg$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'auth' AND c.relname = 'users'
      AND t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal
  ) THEN
    EXECUTE 'create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user()';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN
    EXECUTE 'grant usage on schema public to supabase_auth_admin';
    EXECUTE 'grant execute on function public.handle_new_user() to supabase_auth_admin';
  END IF;
END
$trg$;

-- ---------------------------------------------------------------------------
-- 2) companies: yeni bilgi kolonlari (mevcut satirlar NULL kalir)
-- ---------------------------------------------------------------------------
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS owner_id uuid;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS trial_start timestamptz;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS trial_started_at timestamptz;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS signup_source text;

COMMENT ON COLUMN public.companies.trial_started_at IS
  'Sunucuda yazilan deneme baslangici (kendi kaydi). Bitis: trial_ends_at.';
COMMENT ON COLUMN public.companies.signup_source IS
  'self_service = kodsuz kayit; NULL = eski/super admin tarafindan olusturulan firma.';

-- ---------------------------------------------------------------------------
-- 3) Kendi kendine kayit ayarlari (tek satir)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.self_signup_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT true,
  trial_days integer NOT NULL DEFAULT 7 CHECK (trial_days BETWEEN 1 AND 90),
  package_code text NOT NULL DEFAULT 'solo',
  enabled_modules text[] NOT NULL DEFAULT ARRAY['admin','measurements','orders','customers','appointments','suppliers','installation','collections'],
  max_users integer NOT NULL DEFAULT 3 CHECK (max_users BETWEEN 1 AND 999),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

INSERT INTO public.self_signup_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.self_signup_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS self_signup_settings_super_admin_select ON public.self_signup_settings;
CREATE POLICY self_signup_settings_super_admin_select ON public.self_signup_settings
  FOR SELECT TO authenticated USING (public.is_super_admin());
DROP POLICY IF EXISTS self_signup_settings_super_admin_update ON public.self_signup_settings;
CREATE POLICY self_signup_settings_super_admin_update ON public.self_signup_settings
  FOR UPDATE TO authenticated USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());
REVOKE ALL ON public.self_signup_settings FROM anon;

-- ---------------------------------------------------------------------------
-- 4) Deneme hakki kaydi: kullanici + e-posta basina tek deneme
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trial_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE,
  email_normalized text NOT NULL UNIQUE,
  first_company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
  trial_days integer,
  trial_started_at timestamptz NOT NULL,
  trial_ends_at timestamptz,
  source text NOT NULL DEFAULT 'self_service',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.trial_grants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS trial_grants_super_admin_select ON public.trial_grants;
CREATE POLICY trial_grants_super_admin_select ON public.trial_grants
  FOR SELECT TO authenticated USING (public.is_super_admin());
REVOKE ALL ON public.trial_grants FROM anon;
-- INSERT/UPDATE/DELETE politikasi yok: yalnizca SECURITY DEFINER RPC yazar.

-- Mevcut firma yoneticileri: deneme haklarini zaten kullanmis sayilir.
-- (Uyeligi kaldirilmis eski bir yonetici kendi kaydiyla yeni deneme ACAMAZ.)
INSERT INTO public.trial_grants (user_id, email_normalized, first_company_id, trial_started_at, trial_ends_at, source)
SELECT DISTINCT ON (u.id)
  u.id,
  lower(u.email),
  cm.company_id,
  coalesce(c.trial_start, c.created_at, now()),
  c.trial_ends_at,
  'legacy_backfill'
FROM public.company_members cm
JOIN auth.users u ON u.id = cm.user_id
JOIN public.companies c ON c.id = cm.company_id
WHERE cm.role IN ('admin', 'owner')
  AND nullif(u.email, '') IS NOT NULL
ORDER BY u.id, cm.created_at ASC
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5) company_members uzerinde tenant_write tetikleyicisi VARSA:
--    ilk yonetici uyeligini olusturan RPC'nin gecebilmesi icin ayni kontrolleri
--    yapan, yalnizca bu RPC'nin islem-ici bayragina izin veren surumle degistir.
--    (Tetikleyici yoksa hicbir sey yapilmaz.)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_company_members_tenant_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
  IF current_setting('perdepro.self_signup', true) = 'on' THEN
    RETURN new;
  END IF;

  IF new.company_id IS NULL THEN
    RAISE EXCEPTION 'company_id zorunludur.';
  END IF;

  IF public.is_super_admin() THEN
    RETURN new;
  END IF;

  -- Davet kabul RPC'si: kullanici yalnizca KENDISINI, e-postasina ait,
  -- kullanilmamis ve suresi dolmamis bir davetteki firma/rol ile ekleyebilir.
  -- (Istemciden dogrudan yazim RLS politikasi tarafindan zaten engellenir.)
  IF new.user_id = auth.uid() AND to_regclass('public.user_invites') IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.user_invites ui
    JOIN auth.users u ON lower(u.email) = lower(ui.email)
    WHERE u.id = auth.uid()
      AND ui.company_id = new.company_id
      AND ui.role = new.role
      AND ui.used_at IS NULL
      AND ui.expires_at >= now()
  ) THEN
    RETURN new;
  END IF;

  IF NOT public.is_company_member(new.company_id) THEN
    RAISE EXCEPTION 'Bu firmaya işlem yapma yetkiniz yok.';
  END IF;

  IF NOT public.is_company_writable(new.company_id) THEN
    RAISE EXCEPTION 'Firma lisansı aktif değil veya sadece okuma modunda.';
  END IF;

  RETURN new;
END;
$fn$;

DO $cmtrg$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = 'public.company_members'::regclass
      AND t.tgname = 'trg_company_members_tenant_write'
      AND NOT t.tgisinternal
  ) THEN
    EXECUTE 'drop trigger trg_company_members_tenant_write on public.company_members';
    EXECUTE 'create trigger trg_company_members_tenant_write before insert or update on public.company_members for each row execute function public.enforce_company_members_tenant_write()';
    RAISE NOTICE 'company_members tenant_write tetikleyicisi provisioning-uyumlu surumle degistirildi.';
  END IF;
END
$cmtrg$;

-- ---------------------------------------------------------------------------
-- 6) Kendi isletmesini olustur + denemeyi baslat (idempotent)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.start_self_service_trial(text, text);

CREATE OR REPLACE FUNCTION public.start_self_service_trial(
  p_company_name text,
  p_full_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmed_at timestamptz;
  v_meta jsonb;
  v_company_name text;
  v_full_name text;
  v_settings public.self_signup_settings%ROWTYPE;
  v_grant public.trial_grants%ROWTYPE;
  v_existing_company uuid;
  v_company_id uuid;
  v_trial_start timestamptz;
  v_trial_end timestamptz;
  v_reused_grant boolean := false;
  v_company public.companies%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Oturum bulunamadı. Lütfen tekrar giriş yapın.' USING ERRCODE = '28000';
  END IF;

  SELECT lower(u.email), u.email_confirmed_at, coalesce(u.raw_user_meta_data, '{}'::jsonb)
    INTO v_email, v_confirmed_at, v_meta
  FROM auth.users u
  WHERE u.id = v_uid;

  IF nullif(v_email, '') IS NULL THEN
    RAISE EXCEPTION 'Hesabınıza bağlı e-posta bulunamadı.';
  END IF;

  IF v_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'PERDEPRO_EMAIL_NOT_CONFIRMED: E-posta adresiniz henüz doğrulanmadı.' USING ERRCODE = 'P0001';
  END IF;

  IF public.is_super_admin() THEN
    RAISE EXCEPTION 'Süper yönetici hesabıyla deneme işletmesi oluşturulamaz.';
  END IF;

  -- Ayni kullanicinin paralel cagrilarini sirala (cift tiklama, iki cihaz).
  PERFORM pg_advisory_xact_lock(hashtextextended('perdepro.self_trial.user:' || v_uid::text, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('perdepro.self_trial.email:' || v_email, 0));

  -- Zaten bir firmaya bagliysa: yeni firma / yeni deneme YOK.
  SELECT cm.company_id INTO v_existing_company
  FROM public.company_members cm
  WHERE cm.user_id = v_uid
  ORDER BY coalesce(cm.is_active, true) DESC, cm.created_at ASC
  LIMIT 1;

  IF v_existing_company IS NOT NULL THEN
    SELECT * INTO v_company FROM public.companies WHERE id = v_existing_company;
    RETURN jsonb_build_object(
      'company_id', v_existing_company,
      'created', false,
      'plan_status', v_company.plan_status,
      'trial_started_at', v_company.trial_started_at,
      'trial_ends_at', v_company.trial_ends_at
    );
  END IF;

  SELECT * INTO v_settings FROM public.self_signup_settings WHERE id = 1;
  IF NOT FOUND OR v_settings.enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'PERDEPRO_SELF_SIGNUP_DISABLED: Yeni işletme kaydı şu anda kapalı. Lütfen destek ile iletişime geçin.';
  END IF;

  v_company_name := left(regexp_replace(trim(coalesce(nullif(trim(p_company_name), ''), v_meta->>'company_name', '')), '\s+', ' ', 'g'), 120);
  IF length(v_company_name) < 2 THEN
    RAISE EXCEPTION 'İşletme adı en az 2 karakter olmalı.';
  END IF;

  v_full_name := left(nullif(trim(coalesce(nullif(trim(p_full_name), ''), v_meta->>'full_name', '')), ''), 120);

  -- Deneme hakki daha once kullanildiysa ayni bitis tarihi korunur (yenilenmez).
  SELECT * INTO v_grant
  FROM public.trial_grants g
  WHERE g.user_id = v_uid OR g.email_normalized = v_email
  ORDER BY g.created_at ASC
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_reused_grant := true;
    v_trial_start := v_grant.trial_started_at;
    v_trial_end := coalesce(v_grant.trial_ends_at, v_grant.trial_started_at + make_interval(days => v_settings.trial_days));
  ELSE
    v_trial_start := now();
    v_trial_end := now() + make_interval(days => v_settings.trial_days);
  END IF;

  INSERT INTO public.companies (
    name, owner_id, created_by,
    subscription_plan, package_code, enabled_modules, max_users, branch_limit,
    plan_status, subscription_status,
    trial_start, trial_end, trial_ends_at, trial_started_at,
    is_pilot, is_active, read_only, onboarding_completed,
    signup_source
  )
  VALUES (
    v_company_name, v_uid, v_uid,
    'trial', v_settings.package_code, v_settings.enabled_modules, v_settings.max_users, 1,
    'trial', 'trial',
    v_trial_start, v_trial_end, v_trial_end, v_trial_start,
    false, true, false, false,
    'self_service'
  )
  RETURNING id INTO v_company_id;

  PERFORM set_config('perdepro.self_signup', 'on', true);

  INSERT INTO public.company_members (company_id, user_id, role, is_active, created_by)
  VALUES (v_company_id, v_uid, 'admin', true, v_uid);

  PERFORM set_config('perdepro.self_signup', 'off', true);

  INSERT INTO public.profiles (user_id, email, full_name, role, is_active, updated_at)
  VALUES (v_uid, v_email, coalesce(v_full_name, split_part(v_email, '@', 1)), 'admin', true, now())
  ON CONFLICT (user_id) DO UPDATE SET
    email = excluded.email,
    full_name = coalesce(v_full_name, public.profiles.full_name, excluded.full_name),
    role = 'admin',
    is_active = true,
    updated_at = now();

  IF v_reused_grant THEN
    UPDATE public.trial_grants
       SET user_id = coalesce(user_id, v_uid),
           first_company_id = coalesce(first_company_id, v_company_id)
     WHERE id = v_grant.id;
  ELSE
    INSERT INTO public.trial_grants (user_id, email_normalized, first_company_id, trial_days, trial_started_at, trial_ends_at, source)
    VALUES (v_uid, v_email, v_company_id, v_settings.trial_days, v_trial_start, v_trial_end, 'self_service');
  END IF;

  RETURN jsonb_build_object(
    'company_id', v_company_id,
    'created', true,
    'plan_status', 'trial',
    'trial_started_at', v_trial_start,
    'trial_ends_at', v_trial_end,
    'trial_reused', v_reused_grant
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.start_self_service_trial(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_self_service_trial(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 7) Abonelik durumuna gore yazma izni (rol bagimsiz)
--    src/utils/trialLicense.ts isTrialExpired() ile birebir ayni karar.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.company_subscription_allows_write(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
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
$fn$;

REVOKE ALL ON FUNCTION public.company_subscription_allows_write(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.company_subscription_allows_write(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_company_subscription_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_new_company uuid;
  v_old_company uuid;
BEGIN
  -- Oturumsuz (service role, SQL Editor, cron) ve super admin muaf.
  IF auth.uid() IS NULL OR public.is_super_admin() THEN
    IF tg_op = 'DELETE' THEN RETURN old; END IF;
    RETURN new;
  END IF;

  IF tg_op IN ('INSERT', 'UPDATE') THEN
    v_new_company := new.company_id;
  END IF;
  IF tg_op IN ('UPDATE', 'DELETE') THEN
    v_old_company := old.company_id;
  END IF;

  IF (v_new_company IS NOT NULL AND NOT public.company_subscription_allows_write(v_new_company))
     OR (v_old_company IS NOT NULL AND v_old_company IS DISTINCT FROM v_new_company
         AND NOT public.company_subscription_allows_write(v_old_company)) THEN
    RAISE EXCEPTION 'PERDEPRO_SUBSCRIPTION_READ_ONLY: Deneme veya abonelik süreniz dolduğu için yeni kayıt ve değişiklik yapılamaz. Verileriniz korunuyor ve görüntülenebilir.'
      USING ERRCODE = '42501';
  END IF;

  IF tg_op = 'DELETE' THEN RETURN old; END IF;
  RETURN new;
END;
$fn$;

-- Yalnizca is verisi tablolari. Destek talebi, bildirim, hata/etkinlik logu,
-- cihaz kaydi, uyelik ve davet tablolari BILEREK kapsam disi: suresi dolan
-- kullanici giris yapabilmeli, destek talebi acabilmeli.
DO $guard$
DECLARE
  v_table text;
  v_installed text[] := ARRAY[]::text[];
  v_skipped text[] := ARRAY[]::text[];
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'customers', 'customer_rooms', 'appointments', 'measurements',
    'orders', 'order_items', 'order_payment_plans', 'order_installments',
    'quotes', 'quote_items',
    'products', 'catalogs', 'catalog_series', 'catalog_variants', 'catalog_code_photos',
    'suppliers', 'supplier_transactions', 'supplier_payments', 'supplier_product_prices',
    'installation_jobs', 'installer_transactions', 'installer_earnings',
    'employees', 'employee_transactions', 'staff',
    'payments', 'customer_collections', 'income', 'expenses', 'transactions',
    'invoices', 'invoice_items',
    'visual_previews', 'field_info', 'branches', 'vehicles', 'warehouse_items'
  ]
  LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = v_table AND column_name = 'company_id'
       ) THEN
      EXECUTE format('drop trigger if exists trg_subscription_write_guard on public.%I', v_table);
      EXECUTE format(
        'create trigger trg_subscription_write_guard before insert or update or delete on public.%I for each row execute function public.enforce_company_subscription_write()',
        v_table
      );
      v_installed := v_installed || v_table;
    ELSE
      v_skipped := v_skipped || v_table;
    END IF;
  END LOOP;

  RAISE NOTICE 'Abonelik yazma korumasi kuruldu: %', array_to_string(v_installed, ', ');
  RAISE NOTICE 'Atlanan (tablo yok veya company_id kolonu yok): %', array_to_string(v_skipped, ', ');
END
$guard$;

NOTIFY pgrst, 'reload schema';

COMMIT;
