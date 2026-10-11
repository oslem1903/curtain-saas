-- Migration 028: yeni kendi kendine kayit denemelerini 14 gun yap.
-- Var olan companies / trial_grants satirlari ve deneme bitis tarihleri degismez.
-- Canliya uygulamadan once supabase_migration_028_precheck_readonly.sql calistirin.

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.self_signup_settings') IS NULL
     OR to_regclass('public.trial_grants') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: migration 024 eksik; 028 uygulanmadi.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'self_signup_settings'
      AND column_name = 'trial_days' AND data_type = 'integer'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT: self_signup_settings.trial_days semasi beklenenden farkli.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.self_signup_settings WHERE id=1) THEN
    RAISE EXCEPTION 'PREFLIGHT: self_signup_settings id=1 satiri yok.';
  END IF;
END
$pre$;

ALTER TABLE public.self_signup_settings
  ADD COLUMN IF NOT EXISTS trial_days_before_14 integer,
  ADD COLUMN IF NOT EXISTS trial_days_default_before_14 text;

UPDATE public.self_signup_settings s
SET trial_days_before_14=s.trial_days,
    trial_days_default_before_14=(
      SELECT pg_get_expr(d.adbin,d.adrelid)
      FROM pg_attrdef d
      JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
      WHERE d.adrelid='public.self_signup_settings'::regclass AND a.attname='trial_days'
    )
WHERE s.id=1 AND s.trial_days_before_14 IS NULL;

ALTER TABLE public.self_signup_settings
  ALTER COLUMN trial_days SET DEFAULT 14;

UPDATE public.self_signup_settings
SET trial_days = 14,
    updated_at = now()
WHERE id = 1;

COMMENT ON COLUMN public.self_signup_settings.trial_days IS
  'Yeni kendi kendine kayit denemelerinin suresi (gun). Mevcut trial_grants ve firmalarin tarihleri geriye donuk degistirilmez.';

COMMIT;