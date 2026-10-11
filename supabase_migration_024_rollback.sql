-- ============================================================================
-- Migration 024 GERI ALMA
-- - Kodsuz kayit RPC'sini ve abonelik yazma korumasini kaldirir.
-- - Kendi kaydiyla olusan firmalar, uyelikler ve veriler SILINMEZ.
-- - trial_grants / self_signup_settings tablolari ve yeni kolonlar
--   veri kaybi olmasin diye BIRAKILIR (istenirse elle silinebilir).
-- - handle_new_user() BILEREK eski haline dondurulmez: eski surum
--   kayit metadata'sindaki 'super_admin' rolunu kabul ediyordu.
-- ============================================================================

BEGIN;

DO $rb$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    WHERE c.relnamespace = 'public'::regnamespace
      AND t.tgname = 'trg_subscription_write_guard'
      AND NOT t.tgisinternal
  LOOP
    EXECUTE format('drop trigger if exists trg_subscription_write_guard on public.%I', r.relname);
  END LOOP;

  -- company_members tetikleyicisi 024 tarafindan degistirildiyse eski fonksiyona don
  IF EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'public.company_members'::regclass
      AND t.tgname = 'trg_company_members_tenant_write'
      AND p.proname = 'enforce_company_members_tenant_write'
  ) THEN
    EXECUTE 'drop trigger trg_company_members_tenant_write on public.company_members';
    IF to_regprocedure('public.enforce_tenant_write()') IS NOT NULL THEN
      EXECUTE 'create trigger trg_company_members_tenant_write before insert or update on public.company_members for each row execute function public.enforce_tenant_write()';
    END IF;
  END IF;
END
$rb$;

DROP FUNCTION IF EXISTS public.start_self_service_trial(text, text);
DROP FUNCTION IF EXISTS public.enforce_company_subscription_write();
DROP FUNCTION IF EXISTS public.company_subscription_allows_write(uuid);
DROP FUNCTION IF EXISTS public.enforce_company_members_tenant_write();

NOTIFY pgrst, 'reload schema';

COMMIT;
