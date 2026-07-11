-- =============================================================================
-- RESTORATION: Missing RLS Policies for suppliers table
-- Date: 2026-07-11
-- Production status: Applied and verified on 2026-07-11
-- Verification: Supplier creation succeeded for active admin user (test765@gmail.com)
--
-- ISSUE:
-- Production database: RLS enabled = TRUE, but 0 policies found on suppliers table
-- Result: PostgreSQL default-deny policy applies (all CRUD operations blocked with 403)
--
-- ROOT CAUSE:
-- Production'da RLS açık olduğu halde suppliers policy'lerinin bulunmadığı doğrulandı.
-- Migration sırası veya eksik deployment olası sebeptir.
-- install_tenant_policy('suppliers', true) fonksiyonu supabase_customer_ready_hardening.sql
-- dosyasında tanımlanmıştır, ancak production'da yeterli policy oluşmaması nedeniyle bu
-- migration suppliers tablosu için policy'leri geri yüklemektedir.
--
-- DEPENDENCY GRAPH:
-- suppliers INSERT policy:
--  ├─ is_super_admin()
--  └─ is_company_accounting() AND is_company_writable()
--      ├─ is_company_accounting()
--      │  └─ company_members (is_active=true, role IN owner/admin/accountant)
--      └─ is_company_writable()
--         └─ companies (is_active=true, read_only=false)
--
-- SAFETY:
-- - All DROP POLICY IF EXISTS (idempotent, safe to rerun)
-- - Policy names follow existing convention (table_operation_scope)
-- - No changes to helper functions (is_super_admin, is_company_member, etc.)
-- - No changes to RLS enabled flag
-- - No changes to other tables
-- - Transaction wrapped
-- - Verification queries included
-- - Idempotent and rerun-safe
--
-- AFFECTED TABLES:
-- - public.suppliers (accounting-restricted, p_accounting_only=true)
--
-- AUTHORIZATION MODEL:
-- SELECT: is_super_admin() OR is_company_member(company_id)
-- INSERT: is_super_admin() OR (is_company_accounting(company_id) AND is_company_writable(company_id))
-- UPDATE: is_super_admin() OR (is_company_accounting(company_id) AND is_company_writable(company_id))
-- DELETE: is_super_admin() OR (is_company_admin(company_id) AND is_company_writable(company_id))
--
-- NOTE: Only 'owner', 'admin', 'accountant' roles can INSERT/UPDATE/DELETE suppliers
--       Normal users (installer, measurement, personnel) blocked intentionally
-- =============================================================================

BEGIN TRANSACTION;

-- =============================================================================
-- SUPPLIERS TABLE - Restore accounting-restricted policies
-- These MUST require is_company_accounting() role check:
-- Only 'owner', 'admin', 'accountant' roles can CRUD suppliers
-- =============================================================================

-- Suppliers SELECT policy
-- Allow: super admin OR company members
DROP POLICY IF EXISTS suppliers_tenant_select ON public.suppliers;
CREATE POLICY suppliers_tenant_select ON public.suppliers
FOR SELECT TO authenticated
USING (public.is_super_admin() OR public.is_company_member(company_id));

-- Suppliers INSERT policy - ACCOUNTING ONLY
-- Allow: super admin OR (accountant AND company writable)
DROP POLICY IF EXISTS suppliers_tenant_insert ON public.suppliers;
CREATE POLICY suppliers_tenant_insert ON public.suppliers
FOR INSERT TO authenticated
WITH CHECK (
  public.is_super_admin() OR
  (public.is_company_accounting(company_id) AND public.is_company_writable(company_id))
);

-- Suppliers UPDATE policy - ACCOUNTING ONLY
-- Allow: super admin OR (accountant AND company writable)
DROP POLICY IF EXISTS suppliers_tenant_update ON public.suppliers;
CREATE POLICY suppliers_tenant_update ON public.suppliers
FOR UPDATE TO authenticated
USING (
  public.is_super_admin() OR
  (public.is_company_accounting(company_id) AND public.is_company_writable(company_id))
)
WITH CHECK (
  public.is_super_admin() OR
  (public.is_company_accounting(company_id) AND public.is_company_writable(company_id))
);

-- Suppliers DELETE policy
-- Allow: super admin OR (admin AND company writable)
DROP POLICY IF EXISTS suppliers_tenant_delete ON public.suppliers;
CREATE POLICY suppliers_tenant_delete ON public.suppliers
FOR DELETE TO authenticated
USING (
  public.is_super_admin() OR
  (public.is_company_admin(company_id) AND public.is_company_writable(company_id))
);

-- Ensure suppliers RLS is enabled
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- VERIFICATION QUERIES - Run these after migration to confirm
-- =============================================================================

-- 1. Verify RLS is enabled on suppliers table
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'suppliers'
ORDER BY tablename;

-- 2. Verify all 4 suppliers policies exist and are correctly configured
SELECT
  schemaname,
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'suppliers'
ORDER BY policyname;

-- 3. Count suppliers policies (expected: 4)
SELECT
  tablename,
  COUNT(*) as policy_count
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'suppliers'
GROUP BY tablename;

-- 4. List all suppliers policies by operation type
SELECT
  policyname,
  cmd as operation,
  CASE
    WHEN policyname = 'suppliers_tenant_select' THEN 'SELECT: is_super_admin() OR is_company_member(company_id)'
    WHEN policyname = 'suppliers_tenant_insert' THEN 'INSERT: is_super_admin() OR (is_company_accounting() AND is_company_writable())'
    WHEN policyname = 'suppliers_tenant_update' THEN 'UPDATE: is_super_admin() OR (is_company_accounting() AND is_company_writable())'
    WHEN policyname = 'suppliers_tenant_delete' THEN 'DELETE: is_super_admin() OR (is_company_admin() AND is_company_writable())'
    ELSE 'UNKNOWN'
  END as authorization_rule
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'suppliers'
ORDER BY policyname;

-- =============================================================================
-- TRANSACTION END
-- =============================================================================

COMMIT;

-- Signal PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- ROLLBACK INSTRUCTIONS (if needed)
-- =============================================================================
-- If this migration causes issues, run:
--
-- DROP POLICY IF EXISTS suppliers_tenant_select ON public.suppliers;
-- DROP POLICY IF EXISTS suppliers_tenant_insert ON public.suppliers;
-- DROP POLICY IF EXISTS suppliers_tenant_update ON public.suppliers;
-- DROP POLICY IF EXISTS suppliers_tenant_delete ON public.suppliers;
--
-- Then re-run supabase_customer_ready_hardening.sql from scratch
-- =============================================================================

-- =============================================================================
-- POST-MIGRATION TESTING
-- =============================================================================
-- Test as installer user (normal user, NOT accounting):
--   POST /suppliers → 403 FORBIDDEN (expected: is_company_accounting()=FALSE)
--   GET /suppliers → 200 OK (expected: is_company_member()=TRUE)
--   PUT /suppliers/:id → 403 FORBIDDEN (expected: accounting required)
--   DELETE /suppliers/:id → 403 FORBIDDEN (expected: admin required)
--
-- Test as accountant user (accounting role):
--   POST /suppliers → 201 CREATED (expected: is_company_accounting()=TRUE)
--   GET /suppliers → 200 OK
--   PUT /suppliers/:id → 200 OK
--   DELETE /suppliers/:id → 403 FORBIDDEN (expected: admin-only, not accountant)
--
-- Test as admin user (admin role):
--   POST /suppliers → 201 CREATED
--   GET /suppliers → 200 OK
--   PUT /suppliers/:id → 200 OK
--   DELETE /suppliers/:id → 200 OK
--
-- Test as super_admin:
--   All operations → 200 OK
--
-- Browser verification (F12 → Network tab):
--   suppliers INSERT: Old error had "code":"42501" (RLS violation)
--   suppliers INSERT: New success has "201 Created" or "error":"...other..."
-- =============================================================================
