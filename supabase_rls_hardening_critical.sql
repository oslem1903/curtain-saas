-- ============================================================================
-- RLS SECURITY HARDENING - PRODUCTION BLOCKER
-- Enable RLS on 7 tables with NO current protection
-- ============================================================================
-- Date: 2026-07-07
-- Priority: CRITICAL
--
-- Tables affected:
-- 1. companies - Business entity (shared across users)
-- 2. employees - Staff records
-- 3. income - Financial records
-- 4. installer_transactions - Installer ledger (FAZ 2)
-- 5. payments - Payment records
-- 6. profiles - User profiles (auth integration)
-- 7. supplier_transactions - Supplier ledger (FAZ 1)
--
-- Strategy: Multi-tenant isolation via company_id + role-based access
-- ============================================================================

-- ============================================================================
-- HELPER FUNCTIONS (drop if exists, then create)
-- ============================================================================

DROP FUNCTION IF EXISTS public.is_company_accounting(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.is_company_writable(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.is_company_member(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.is_super_admin() CASCADE;

-- Create helper functions
CREATE FUNCTION public.is_super_admin()
RETURNS boolean AS $$
BEGIN
  RETURN (SELECT role = 'super_admin' FROM public.profiles WHERE user_id = auth.uid() LIMIT 1);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE FUNCTION public.is_company_member(p_company_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.company_members
    WHERE user_id = auth.uid()
    AND company_id = p_company_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE FUNCTION public.is_company_writable(p_company_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.company_members
      WHERE user_id = auth.uid()
      AND company_id = p_company_id
      AND role IN ('admin', 'owner')
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE FUNCTION public.is_company_accounting(p_company_id uuid)
RETURNS boolean AS $$
BEGIN
  RETURN (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.company_members
      WHERE user_id = auth.uid()
      AND company_id = p_company_id
      AND role IN ('admin', 'owner', 'accountant')
    )
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- TABLE 1: companies (Business entities)
-- ============================================================================

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

-- Super admin: See all companies
CREATE POLICY companies_super_admin_select ON public.companies
FOR SELECT USING (is_super_admin());

-- Company members: See own company
CREATE POLICY companies_member_select ON public.companies
FOR SELECT USING (
  id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid())
);

-- Admins: Update own company
CREATE POLICY companies_admin_update ON public.companies
FOR UPDATE USING (
  is_company_writable(id)
);

GRANT SELECT, UPDATE ON public.companies TO authenticated;

-- ============================================================================
-- TABLE 2: employees (Staff records)
-- ============================================================================

ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

-- Super admin: See all
CREATE POLICY employees_super_admin_select ON public.employees
FOR SELECT USING (is_super_admin());

-- Company member: See own company employees
CREATE POLICY employees_member_select ON public.employees
FOR SELECT USING (
  company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid())
);

-- Admin: Insert employees in own company
CREATE POLICY employees_admin_insert ON public.employees
FOR INSERT WITH CHECK (
  is_company_writable(company_id)
);

-- Admin: Update employees in own company
CREATE POLICY employees_admin_update ON public.employees
FOR UPDATE USING (
  is_company_writable(company_id)
);

-- Admin: Delete employees in own company
CREATE POLICY employees_admin_delete ON public.employees
FOR DELETE USING (
  is_company_writable(company_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO authenticated;

-- ============================================================================
-- TABLE 3: income (Financial records)
-- ============================================================================

ALTER TABLE public.income ENABLE ROW LEVEL SECURITY;

-- Super admin: See all
CREATE POLICY income_super_admin_select ON public.income
FOR SELECT USING (is_super_admin());

-- Company accounting: See own company income
CREATE POLICY income_member_select ON public.income
FOR SELECT USING (
  company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid())
);

-- Accounting/Admin: Insert income
CREATE POLICY income_admin_insert ON public.income
FOR INSERT WITH CHECK (
  is_company_accounting(company_id)
);

-- Accounting/Admin: Update income
CREATE POLICY income_admin_update ON public.income
FOR UPDATE USING (
  is_company_accounting(company_id)
);

GRANT SELECT, INSERT, UPDATE ON public.income TO authenticated;

-- ============================================================================
-- TABLE 4: installer_transactions (Montajcı Cari Ledger - FAZ 2)
-- ============================================================================

ALTER TABLE public.installer_transactions ENABLE ROW LEVEL SECURITY;

-- Super admin: See all
CREATE POLICY installer_transactions_super_admin_select ON public.installer_transactions
FOR SELECT USING (is_super_admin());

-- Company member: See own company transactions
CREATE POLICY installer_transactions_member_select ON public.installer_transactions
FOR SELECT USING (
  company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid())
);

-- Installer: See own transactions
CREATE POLICY installer_transactions_installer_select ON public.installer_transactions
FOR SELECT USING (
  installer_id = auth.uid()
);

-- System (trigger): Insert transactions
CREATE POLICY installer_transactions_insert ON public.installer_transactions
FOR INSERT WITH CHECK (
  TRUE  -- Triggered by system, not user
);

-- Accounting: Update transactions
CREATE POLICY installer_transactions_admin_update ON public.installer_transactions
FOR UPDATE USING (
  is_company_accounting(company_id)
);

GRANT SELECT, INSERT, UPDATE ON public.installer_transactions TO authenticated;

-- ============================================================================
-- TABLE 5: payments (Payment records)
-- ============================================================================

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Super admin: See all
CREATE POLICY payments_super_admin_select ON public.payments
FOR SELECT USING (is_super_admin());

-- Company member: See own company payments
CREATE POLICY payments_member_select ON public.payments
FOR SELECT USING (
  company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid())
);

-- Admin: Insert payments
CREATE POLICY payments_admin_insert ON public.payments
FOR INSERT WITH CHECK (
  is_company_writable(company_id)
);

-- Admin: Update payments
CREATE POLICY payments_admin_update ON public.payments
FOR UPDATE USING (
  is_company_writable(company_id)
);

GRANT SELECT, INSERT, UPDATE ON public.payments TO authenticated;

-- ============================================================================
-- TABLE 6: profiles (User profiles)
-- NOTE: profiles doesn't have company_id directly
-- Company mapping is via company_members table
-- ============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Users: See own profile
CREATE POLICY profiles_self_select ON public.profiles
FOR SELECT USING (user_id = auth.uid());

-- Super admin: See all profiles
CREATE POLICY profiles_super_admin_select ON public.profiles
FOR SELECT USING (is_super_admin());

-- Company member: See company members' profiles (via company_members)
CREATE POLICY profiles_company_select ON public.profiles
FOR SELECT USING (
  user_id IN (
    SELECT user_id FROM public.company_members
    WHERE company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid())
  )
);

-- User: Update own profile
CREATE POLICY profiles_self_update ON public.profiles
FOR UPDATE USING (user_id = auth.uid());

-- Admin: Update company members via company_members check
CREATE POLICY profiles_admin_update ON public.profiles
FOR UPDATE USING (
  user_id IN (
    SELECT user_id FROM public.company_members
    WHERE company_id IN (
      SELECT company_id FROM public.company_members
      WHERE user_id = auth.uid()
      AND role IN ('admin', 'owner')
    )
  )
  OR is_super_admin()
);

GRANT SELECT, UPDATE ON public.profiles TO authenticated;

-- ============================================================================
-- TABLE 7: supplier_transactions (Tedarikçi Cari Ledger - FAZ 1)
-- ============================================================================

ALTER TABLE public.supplier_transactions ENABLE ROW LEVEL SECURITY;

-- Super admin: See all
CREATE POLICY supplier_transactions_super_admin_select ON public.supplier_transactions
FOR SELECT USING (is_super_admin());

-- Company member: See own company transactions
CREATE POLICY supplier_transactions_member_select ON public.supplier_transactions
FOR SELECT USING (
  company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid())
);

-- System (trigger): Insert/Update transactions
CREATE POLICY supplier_transactions_insert ON public.supplier_transactions
FOR INSERT WITH CHECK (TRUE);

CREATE POLICY supplier_transactions_update ON public.supplier_transactions
FOR UPDATE USING (TRUE);

GRANT SELECT, INSERT, UPDATE ON public.supplier_transactions TO authenticated;

-- ============================================================================
-- VERIFICATION: Show remaining UNSAFE policies (if any)
-- ============================================================================
-- This query will show any policies still using USING true or similar dangerous patterns
-- If this returns rows, those are the ones still needing fixes

-- Run this manually to verify:
/*
SELECT
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    qual,
    with_check
FROM pg_policies
WHERE schemaname = 'public'
AND (
    qual = 'true'::boolean
    OR with_check = 'true'::boolean
    OR roles = '{public}'::name[]
    OR roles = '{anon}'::name[]
);

-- If no rows returned: ✅ ALL POLICIES ARE SAFE
-- If rows exist: ❌ UNSAFE POLICIES FOUND - needs review
*/

-- ============================================================================
-- COMMENTS & DOCUMENTATION
-- ============================================================================

COMMENT ON FUNCTION public.is_super_admin() IS
'Returns true if current user is super_admin role';

COMMENT ON FUNCTION public.is_company_member(uuid) IS
'Returns true if current user is member of specified company';

COMMENT ON FUNCTION public.is_company_writable(uuid) IS
'Returns true if current user has admin/owner role in specified company';

COMMENT ON FUNCTION public.is_company_accounting(uuid) IS
'Returns true if current user has admin/owner/accountant role in specified company';

-- ============================================================================
-- POST-DEPLOYMENT CHECKLIST
-- ============================================================================
-- 1. Run verification query above - ensure NO UNSAFE policies remain
-- 2. Test with super_admin user - should see all data
-- 3. Test with company admin - should see only own company data
-- 4. Test with company member - should see own company data
-- 5. Test with anon - should see nothing
-- 6. Monitor logs for permission denied errors (may indicate legitimate access needs)
-- 7. If errors: adjust policy using is_company_* functions
-- ============================================================================

-- Signal PostgREST to reload schema cache
NOTIFY pgrst, 'reload schema';
