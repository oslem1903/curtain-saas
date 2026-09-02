-- =========================================================================
-- ORDERS TABLE RLS HARDENING - COMPLETE TENANT ISOLATION
-- =========================================================================
-- Date: 2026-08-01
-- Purpose:
--   1. Create missing UPDATE and DELETE role-scoped policies
--   2. Remove dangerous all-access policies (USING=true)
--   3. Maintain legitimate workflows (admin/accounting/personal)
--
-- Safety:
--   - Uses DROP POLICY IF EXISTS (idempotent)
--   - Creates safe replacements BEFORE dropping dangerous ones
--   - Preserves subscription check policies
--   - No data modification
--   - Rollback possible (see comments at end)
-- =========================================================================

-- Ensure RLS is enabled
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

-- =========================================================================
-- PHASE 1: CREATE SAFE REPLACEMENT POLICIES
-- =========================================================================

-- Admin/accounting can UPDATE company orders
DROP POLICY IF EXISTS orders_update_role_scope ON public.orders;
CREATE POLICY orders_update_role_scope
ON public.orders
FOR UPDATE
TO authenticated
USING (
    company_id = public.current_company_id()
    AND (
        public.is_admin_or_accounting()
        OR assigned_to = auth.uid()
        OR assigned_user_id = auth.uid()
        OR created_by = auth.uid()
    )
)
WITH CHECK (
    company_id = public.current_company_id()
);

-- Admin/accounting can DELETE company orders
DROP POLICY IF EXISTS orders_delete_role_scope ON public.orders;
CREATE POLICY orders_delete_role_scope
ON public.orders
FOR DELETE
TO authenticated
USING (
    company_id = public.current_company_id()
    AND (
        public.is_admin_or_accounting()
        OR assigned_to = auth.uid()
        OR assigned_user_id = auth.uid()
        OR created_by = auth.uid()
    )
);

-- =========================================================================
-- PHASE 2: DROP DANGEROUS POLICIES (now that safe replacements exist)
-- =========================================================================

-- CRITICAL: Public read access - REMOVE
DROP POLICY IF EXISTS "Enable read access for all users" ON public.orders;

-- CRITICAL: All authenticated users can SELECT all orders - REMOVE
DROP POLICY IF EXISTS orders_select_auth ON public.orders;

-- CRITICAL: All authenticated users can INSERT all orders - REMOVE
DROP POLICY IF EXISTS orders_insert_auth ON public.orders;

-- CRITICAL: Public INSERT access - REMOVE
DROP POLICY IF EXISTS orders_insert_all ON public.orders;

-- CRITICAL: All authenticated users can UPDATE all orders - REMOVE
DROP POLICY IF EXISTS orders_update_auth ON public.orders;

-- CRITICAL: All authenticated users can DELETE all orders - REMOVE
DROP POLICY IF EXISTS orders_delete_auth ON public.orders;

-- =========================================================================
-- PHASE 3: VERIFY SAFE POLICIES REMAIN
-- =========================================================================

-- Safe SELECT policies should still exist:
--   - orders_select_role_scope (admin/accounting/assigned)
--   - orders_select_own (user_id = auth.uid())

-- Safe INSERT policies should still exist:
--   - orders_insert_role_scope (admin/accounting/assigned)
--   - orders_insert_own (user_id = auth.uid())

-- Safe UPDATE policies should now exist:
--   - orders_update_role_scope (admin/accounting/assigned) [NEW]
--   - orders_update_own (user_id = auth.uid())

-- Safe DELETE policies should now exist:
--   - orders_delete_role_scope (admin/accounting/assigned) [NEW]
--   - orders_delete_own (user_id = auth.uid())

-- Subscription check policies remain unchanged:
--   - "Block insert if trial expired" (subscription gate)
--   - "Block update if trial expired" (subscription gate)
--   - "Block delete if trial expired" (subscription gate)

-- =========================================================================
-- VERIFICATION QUERIES (RUN MANUALLY AFTER MIGRATION)
-- =========================================================================

/*

-- Verify all safe policies exist:
SELECT policyname, cmd, roles, permissive
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'orders'
AND policyname IN (
    'orders_select_role_scope',
    'orders_select_own',
    'orders_insert_role_scope',
    'orders_insert_own',
    'orders_update_role_scope',
    'orders_update_own',
    'orders_delete_role_scope',
    'orders_delete_own'
)
ORDER BY policyname;

-- Verify dangerous policies are removed:
SELECT policyname, cmd
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'orders'
AND policyname IN (
    'orders_select_auth',
    'orders_insert_auth',
    'orders_insert_all',
    'orders_update_auth',
    'orders_delete_auth',
    'Enable read access for all users'
);

-- Result should be: 0 rows (all dangerous policies gone)

-- Verify no policies remain with USING=true or WITH_CHECK=true
-- (except subscription check policies which are allowed):
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
AND tablename = 'orders'
AND policyname NOT LIKE '%trial expired%'
AND (
    qual = 'true'::text
    OR with_check = 'true'::text
);

-- Result should be: 0 rows (no allow-all policies)

*/

-- =========================================================================
-- ROLLBACK INSTRUCTIONS (IF NEEDED)
-- =========================================================================

/*

If this migration must be rolled back:

1. Restore dangerous policies (original behavior):

   CREATE POLICY "Enable read access for all users" ON public.orders
   FOR SELECT TO public
   USING (true);

   CREATE POLICY orders_select_auth ON public.orders
   FOR SELECT TO authenticated
   USING (true);

   CREATE POLICY orders_insert_auth ON public.orders
   FOR INSERT TO authenticated
   WITH CHECK (true);

   CREATE POLICY orders_insert_all ON public.orders
   FOR INSERT TO public
   WITH CHECK (true);

   CREATE POLICY orders_update_auth ON public.orders
   FOR UPDATE TO authenticated
   USING (true)
   WITH CHECK (true);

   CREATE POLICY orders_delete_auth ON public.orders
   FOR DELETE TO authenticated
   USING (true);

2. Remove new safe policies:

   DROP POLICY IF EXISTS orders_update_role_scope ON public.orders;
   DROP POLICY IF EXISTS orders_delete_role_scope ON public.orders;

3. Verify:
   SELECT policyname FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'orders'
   ORDER BY policyname;

*/

-- =========================================================================
-- NOTIFY POSTGREST SCHEMA CACHE
-- =========================================================================
NOTIFY pgrst, 'reload schema';
