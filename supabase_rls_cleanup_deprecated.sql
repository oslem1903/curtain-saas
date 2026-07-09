-- ============================================================================
-- RLS CLEANUP - REMOVE DEPRECATED/UNSAFE POLICIES
-- Date: 2026-07-07
-- Priority: HIGH (removes public access policies)
--
-- What's being removed:
-- 1. payments_insert_public - PUBLIC write access (CRITICAL)
-- 2. payments_update_public - PUBLIC write access (CRITICAL)
-- 3. profiles_update_self - DUPLICATE (profiles_self_update supersedes it)
--
-- What's NOT being removed:
-- - ANY policy using company_members
-- - ANY policy using is_company_* helper functions
-- - ANY policy using is_super_admin()
-- - Eski pattern policies (still in use: customers_delete_own, expenses_insert_own_company, etc.)
--
-- Safety:
-- - All DROP IF EXISTS (idempotent)
-- - Wrapped in transaction
-- - Can be safely rerun
-- ============================================================================

BEGIN TRANSACTION;

-- ============================================================================
-- CRITICAL: Remove PUBLIC access on payments table
-- These allow any unauthenticated user to INSERT/UPDATE payments
-- ============================================================================

DROP POLICY IF EXISTS payments_insert_public ON public.payments;
DROP POLICY IF EXISTS payments_update_public ON public.payments;

-- ============================================================================
-- Remove duplicate profiles policy
-- profiles_self_update handles self-update, _update_self is redundant
-- ============================================================================

DROP POLICY IF EXISTS profiles_update_self ON public.profiles;

-- ============================================================================
-- VERIFICATION: Check removed policies are gone
-- ============================================================================

-- After running this transaction, these should NOT appear:
-- SELECT * FROM pg_policies
-- WHERE schemaname = 'public'
-- AND policyname IN (
--   'payments_insert_public',
--   'payments_update_public',
--   'profiles_update_self'
-- );

-- ============================================================================
-- ROLLBACK INSTRUCTIONS (if needed)
-- ============================================================================
-- If this causes issues, all removed policies were:
-- 1. payments_insert_public - Allow all users to insert payments
-- 2. payments_update_public - Allow all users to update payments
-- 3. profiles_update_self - Allow self profile updates (duplicate of profiles_self_update)
--
-- To restore: re-run supabase_rls_hardening_critical.sql
-- ============================================================================

COMMIT;

-- Signal PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
