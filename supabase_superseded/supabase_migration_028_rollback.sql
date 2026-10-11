-- Rollback 028: onceki yeni-kayit ayarini ve kolon default'unu geri yukle.
-- companies ve trial_grants tarihleri degismez.
BEGIN;

DO $rollback$
DECLARE
  v_days integer;
  v_default text;
BEGIN
  SELECT trial_days_before_14,trial_days_default_before_14
  INTO v_days,v_default
  FROM public.self_signup_settings WHERE id=1 FOR UPDATE;
  IF NOT FOUND OR v_days IS NULL THEN
    RAISE EXCEPTION '028 rollback state bulunamadi; migration uygulanmamis olabilir. Elle deger tahmin etmeyin.';
  END IF;

  UPDATE public.self_signup_settings
  SET trial_days=v_days,trial_days_before_14=NULL,trial_days_default_before_14=NULL,updated_at=now()
  WHERE id=1;

  IF v_default IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.self_signup_settings ALTER COLUMN trial_days SET DEFAULT ' || v_default;
  ELSE
    ALTER TABLE public.self_signup_settings ALTER COLUMN trial_days DROP DEFAULT;
  END IF;
END
$rollback$;

ALTER TABLE public.self_signup_settings
  DROP COLUMN IF EXISTS trial_days_before_14,
  DROP COLUMN IF EXISTS trial_days_default_before_14;

COMMIT;