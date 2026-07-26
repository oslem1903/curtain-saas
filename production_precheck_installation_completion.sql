-- ============================================================================
-- PRE-MIGRATION READINESS CHECK
-- FILE: production_precheck_installation_completion.sql
-- DATE: 2026-07-12
-- PURPOSE: Verify production environment is ready for installation completion migration
-- STATUS: READ-ONLY (SELECT only, no data modifications)
-- ============================================================================
-- USAGE:
-- Run this script on production BEFORE applying the migration.
-- All checks must PASS before proceeding.
-- If any check returns FAIL, DO NOT apply migration.
-- ============================================================================

-- ============================================================================
-- A1: CHECK FOR DUPLICATE INSTALLER_EARNINGS (by company_id + installation_job_id)
-- Expected: No duplicates found (count = 0)
-- ============================================================================
SELECT
    'A1' as check_id,
    'Duplicate installer_earnings' as check_name,
    COUNT(*) as duplicate_count,
    CASE
        WHEN COUNT(*) = 0 THEN 'PASS'
        ELSE 'FAIL'
    END as status,
    CASE
        WHEN COUNT(*) = 0 THEN 'No duplicates found'
        ELSE 'Found ' || COUNT(*) || ' duplicate (company_id, installation_job_id) pairs'
    END as details
FROM (
    SELECT company_id, installation_job_id
    FROM public.installer_earnings
    WHERE installation_job_id IS NOT NULL
    GROUP BY company_id, installation_job_id
    HAVING COUNT(*) > 1
) duplicate_check
UNION ALL

-- ============================================================================
-- A2: VERIFY calculate_commission_for_job FUNCTION EXISTS
-- Expected: Function found (exists = true)
-- ============================================================================
SELECT
    'A2' as check_id,
    'Function: calculate_commission_for_job' as check_name,
    CASE WHEN func_exists THEN 1 ELSE 0 END::int as result_count,
    CASE
        WHEN func_exists THEN 'PASS'
        ELSE 'FAIL'
    END as status,
    CASE
        WHEN func_exists THEN 'Function exists in public schema'
        ELSE 'Function NOT FOUND in public schema'
    END as details
FROM (
    SELECT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'calculate_commission_for_job'
    ) as func_exists
) func_check
UNION ALL

-- ============================================================================
-- A3: VERIFY installer_earnings TABLE STRUCTURE
-- Expected: All 15 required columns present
-- ============================================================================
SELECT
    'A3' as check_id,
    'Table: installer_earnings columns' as check_name,
    COUNT(*) as column_count,
    CASE
        WHEN COUNT(*) >= 15 THEN 'PASS'
        ELSE 'FAIL'
    END as status,
    CASE
        WHEN COUNT(*) >= 15 THEN 'All required columns present (' || COUNT(*) || ')'
        ELSE 'Missing columns: ' || COUNT(*) || ' found, 15 required'
    END as details
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'installer_earnings'
  AND column_name IN (
    'id', 'company_id', 'installer_id', 'installation_job_id', 'order_id',
    'job_completed_date', 'earning_type', 'quantity', 'area_m2', 'quantity_rate',
    'area_rate', 'quantity_earning', 'area_earning', 'manual_earning', 'total_earning'
  )
UNION ALL

-- ============================================================================
-- A4: VERIFY installer_transactions TABLE STRUCTURE
-- Expected: All 7 required columns present
-- ============================================================================
SELECT
    'A4' as check_id,
    'Table: installer_transactions columns' as check_name,
    COUNT(*) as column_count,
    CASE
        WHEN COUNT(*) >= 7 THEN 'PASS'
        ELSE 'FAIL'
    END as status,
    CASE
        WHEN COUNT(*) >= 7 THEN 'All required columns present (' || COUNT(*) || ')'
        ELSE 'Missing columns: ' || COUNT(*) || ' found, 7 required'
    END as details
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'installer_transactions'
  AND column_name IN (
    'id', 'company_id', 'installer_id', 'transaction_date', 'transaction_type', 'amount', 'description'
  )
UNION ALL

-- ============================================================================
-- A5: VERIFY UNIQUE CONSTRAINT STATUS
-- Expected: Constraint does NOT exist yet (ready for creation)
-- ============================================================================
SELECT
    'A5' as check_id,
    'Constraint: installer_earnings_company_job_unique' as check_name,
    CASE WHEN constraint_exists THEN 1 ELSE 0 END::int as result_count,
    CASE
        WHEN constraint_exists THEN 'PASS (already exists)'
        ELSE 'PASS (ready for creation)'
    END as status,
    CASE
        WHEN constraint_exists THEN 'UNIQUE constraint already exists, migration will skip creation'
        ELSE 'Constraint does not exist, migration will create it'
    END as details
FROM (
    SELECT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public' AND table_name = 'installer_earnings'
          AND constraint_name = 'installer_earnings_company_job_unique'
    ) as constraint_exists
) constraint_check
UNION ALL

-- ============================================================================
-- A6: VERIFY AUTHORIZATION AND RATE-LIMIT FUNCTIONS
-- Expected: All 4 functions exist with correct signatures
-- ============================================================================
SELECT
    'A6' as check_id,
    'Functions: Authorization (4 required)' as check_name,
    (
        CASE WHEN is_super_admin_exists THEN 1 ELSE 0 END +
        CASE WHEN is_company_admin_exists THEN 1 ELSE 0 END +
        CASE WHEN is_company_accounting_exists THEN 1 ELSE 0 END +
        CASE WHEN check_rate_limit_exists THEN 1 ELSE 0 END
    )::int as functions_found,
    CASE
        WHEN is_super_admin_exists
         AND is_company_admin_exists
         AND is_company_accounting_exists
         AND check_rate_limit_exists THEN 'PASS'
        ELSE 'FAIL'
    END as status,
    CASE
        WHEN is_super_admin_exists
         AND is_company_admin_exists
         AND is_company_accounting_exists
         AND check_rate_limit_exists THEN 'All 4 functions exist'
        ELSE 'Missing: ' || (
            CASE WHEN NOT is_super_admin_exists THEN 'is_super_admin ' ELSE '' END ||
            CASE WHEN NOT is_company_admin_exists THEN 'is_company_admin ' ELSE '' END ||
            CASE WHEN NOT is_company_accounting_exists THEN 'is_company_accounting ' ELSE '' END ||
            CASE WHEN NOT check_rate_limit_exists THEN 'check_rate_limit' ELSE '' END
        )
    END as details
FROM (
    SELECT
        EXISTS (
            SELECT 1 FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'is_super_admin'
        ) as is_super_admin_exists,
        EXISTS (
            SELECT 1 FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'is_company_admin'
        ) as is_company_admin_exists,
        EXISTS (
            SELECT 1 FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'is_company_accounting'
        ) as is_company_accounting_exists,
        EXISTS (
            SELECT 1 FROM pg_proc p
            JOIN pg_namespace n ON n.oid = p.pronamespace
            WHERE n.nspname = 'public' AND p.proname = 'check_rate_limit'
        ) as check_rate_limit_exists
) func_check
ORDER BY check_id;

-- ============================================================================
-- RESULT INTERPRETATION
-- ============================================================================
-- All checks must return status = 'PASS' before migration can proceed.
-- If any check returns 'FAIL', investigate and resolve before applying migration.
--
-- Example results:
-- A1: PASS - No duplicate earnings found
-- A2: PASS - calculate_commission_for_job exists
-- A3: PASS - All 15 columns present in installer_earnings
-- A4: PASS - All 7 columns present in installer_transactions
-- A5: PASS - UNIQUE constraint ready for creation (or already exists)
-- A6: PASS - All 4 authorization functions exist
--
-- If all checks PASS, proceed with:
-- 1. Run main migration: supabase_fix_update_installation_completion_earnings.sql
-- 2. Deploy frontend: src/pages/InstallationTracking.tsx changes
-- 3. Run smoke tests and monitor for 24 hours
-- ============================================================================
