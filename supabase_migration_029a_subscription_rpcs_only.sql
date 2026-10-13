-- =============================================================================
-- Migration 029a: yalnizca istemcinin cagirdigi iki abonelik karar RPC'si
--   company_subscription_access_allowed(uuid)
--   company_subscription_access_snapshot(uuid)
--
-- NEDEN 029'UN TAMAMI DEGIL: supabase_migration_029_subscription_access_lockdown.sql basligi
-- "UYGULAMAYIN (2026-10-11 karari)" der: 029 sure bitince is verisi OKUMAYI da kapatir ve
-- 45 tabloya FORCE ROW LEVEL SECURITY + RESTRICTIVE FOR ALL politika ekler. Guncel urun karari:
-- sure bitince goruntuleme/disa aktarma ACIK, yazma sunucuda kapali (yazma korumasi 024/025'teki
-- BEFORE INSERT/UPDATE/DELETE tetikleyicileriyle zaten vardir). Bu dosya 029'dan YALNIZCA iki
-- fonksiyonu 029'dan alir: access_allowed BIREBIR (md5 92770fff...), snapshot iki guvenlik
-- duzeltmesiyle turetilmistir (NULL-guvenligi, uyelik-once kontrol; gerekce fonksiyonun ustunde).
--
-- ETKI: Yeni nesne ekler; mevcut tablo/veri/politika/fonksiyon DEGISTIRMEZ. Surum 1.0.14
--   istemcisi bu RPC'leri cagirir; yoksa yedek mantikla (isTrialExpired) calisir.
-- ONKOSUL: companies(is_active, plan_status, is_pilot, pilot_until, trial_ends_at, license_expires_at),
--   profiles(user_id,is_active), company_members(user_id,company_id,is_active), is_super_admin().
-- GERI ALMA: supabase_migration_029a_rollback.sql
-- =============================================================================
BEGIN;

DO $pre$
DECLARE v_missing text;
BEGIN
  IF to_regprocedure('public.is_super_admin()') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: public.is_super_admin() yok.';
  END IF;
  SELECT string_agg(col, ', ') INTO v_missing
  FROM unnest(ARRAY['is_active','plan_status','is_pilot','pilot_until','trial_ends_at','license_expires_at','read_only']) AS col
  WHERE NOT EXISTS (SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='companies' AND column_name=col);
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: companies kolonlari eksik: %', v_missing;
  END IF;
  IF to_regclass('public.profiles') IS NULL OR to_regclass('public.company_members') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: profiles/company_members yok.';
  END IF;
  IF to_regprocedure('public.company_subscription_access_allowed(uuid)') IS NOT NULL
     OR to_regprocedure('public.company_subscription_access_snapshot(uuid)') IS NOT NULL THEN
    RAISE NOTICE 'BILGI: fonksiyonlardan biri zaten var; CREATE OR REPLACE ile ayni govdeyle yenilenecek.';
  END IF;
END
$pre$;

-- ---- 029'dan birebir (satir 66-91): company_subscription_access_allowed ----
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

-- ---- company_subscription_access_snapshot: 029'dan TUREMIS (iki guvenlik duzeltmesiyle) ----
-- 029 sürümündeki iki sorun düzeltildi:
--  (1) NULL güvenliği: is_super_admin() profili olmayan kullanıcıda NULL döner; 029'daki
--      "NOT is_super_admin() AND NOT EXISTS(...)" ifadesi NULL olup IF'e girmez ve kontrol atlanırdı.
--      Burada coalesce(..., false) kullanılır.
--  (2) Varlık sızıntısı: 029 önce "firma var mı" sorar (PERDEPRO_NOT_FOUND), sonra üyeliği; üye
--      olmayan biri firma id'sinin var olup olmadığını ayırt edebilirdi. Burada ÜYELİK önce kontrol
--      edilir; üye olmayan için var olan ve olmayan firma AYNI hatayı (42501) verir.
-- Dönen JSON (company_id, access_allowed, access_kind, access_expires_at, server_time) 029 ile aynıdır.
-- false sonucu yalnızca "yazma kapalı" demektir; görüntüleme/dışa aktarma bu fonksiyona bağlı değildir.
CREATE OR REPLACE FUNCTION public.company_subscription_access_snapshot(p_company_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public
AS $fn$
DECLARE
  v_company public.companies%ROWTYPE;
  v_is_super boolean;
  v_special_active boolean;
  v_access_kind text;
  v_access_end timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: Erişim durumu okunamadı.' USING ERRCODE='42501';
  END IF;
  v_is_super := coalesce(public.is_super_admin(), false);

  IF NOT v_is_super AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.user_id=auth.uid() AND coalesce(p.is_active,true)
  ) THEN
    RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: Erişim durumu okunamadı.' USING ERRCODE='42501';
  END IF;
  IF NOT v_is_super AND NOT EXISTS (
    SELECT 1 FROM public.company_members m
    WHERE m.user_id=auth.uid() AND m.company_id=p_company_id AND coalesce(m.is_active,true)
  ) THEN
    RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: Bu firmanın erişim durumu okunamaz.' USING ERRCODE='42501';
  END IF;

  SELECT * INTO v_company FROM public.companies WHERE id=p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERDEPRO_NOT_FOUND: Firma bulunamadı.'; END IF;

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

DO $post$
BEGIN
  IF to_regprocedure('public.company_subscription_access_allowed(uuid)') IS NULL
     OR to_regprocedure('public.company_subscription_access_snapshot(uuid)') IS NULL THEN
    RAISE EXCEPTION 'POSTCHECK: fonksiyonlar kurulamadi. Islem GERI ALINDI.';
  END IF;
  IF has_function_privilege('anon', 'public.company_subscription_access_allowed(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.company_subscription_access_snapshot(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'POSTCHECK: anon EXECUTE yetkisi var. Islem GERI ALINDI.';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.company_subscription_access_snapshot(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'POSTCHECK: authenticated EXECUTE yetkisi yok. Islem GERI ALINDI.';
  END IF;
END
$post$;

NOTIFY pgrst, 'reload schema';
COMMIT;
