-- ============================================================================
-- Migration 025 GERI ALMA — yalnizca 025'in 8 tabloya ekledigi korumayi kaldirir.
-- Veriye ve 024'un 29 tablodaki korumasina dokunmaz.
-- (025'in bos company_id'ye yazdigi isletme degerleri geri alinmaz; dogru degerlerdir.)
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
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE c.relnamespace = 'public'::regnamespace
      AND t.tgname = 'trg_subscription_write_guard'
      AND p.proname IN ('enforce_company_subscription_write_linked', 'enforce_company_subscription_write_resolved')
      AND NOT t.tgisinternal
  LOOP
    EXECUTE format('drop trigger if exists trg_subscription_write_guard on public.%I', r.relname);
  END LOOP;
END
$rb$;

DROP FUNCTION IF EXISTS public.enforce_company_subscription_write_linked();
DROP FUNCTION IF EXISTS public.guard_resolve_row_company(text, jsonb, text[], boolean);
DROP FUNCTION IF EXISTS public.enforce_company_subscription_write_resolved();
DROP FUNCTION IF EXISTS public.resolve_row_company_for_guard(jsonb, text, text, text, text);

COMMIT;
