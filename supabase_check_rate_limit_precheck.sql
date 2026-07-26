-- ============================================================================
-- PRE-DEPLOYMENT VERIFICATION FOR check_rate_limit HOTFIX
-- FILE: supabase_check_rate_limit_precheck.sql
-- DATE: 2026-07-12
-- PURPOSE: Verify production environment is ready for rate_limit fix
-- STATUS: READ-ONLY (SELECT only, no data modifications)
-- ============================================================================
-- USAGE:
-- Run this script on production BEFORE applying the hotfix.
-- All checks must PASS before proceeding.
-- If any check returns FAIL, DO NOT apply hotfix.
-- ============================================================================

-- ============================================================================
-- CHECK 1: rate_limits table exists and has correct structure
-- Expected: Table exists with required columns
-- ============================================================================
SELECT
    'CHECK-1' as check_id,
    'rate_limits table structure' as check_name,
    CASE
        WHEN table_exists AND has_id AND has_user_id AND has_endpoint
             AND has_request_count AND has_reset_at AND has_created_at THEN 'PASS'
        ELSE 'FAIL'
    END as status,
    CASE
        WHEN NOT table_exists THEN 'Table rate_limits does not exist'
        WHEN NOT has_id THEN 'Missing column: id'
        WHEN NOT has_user_id THEN 'Missing column: user_id'
        WHEN NOT has_endpoint THEN 'Missing column: endpoint'
        WHEN NOT has_request_count THEN 'Missing column: request_count'
        WHEN NOT has_reset_at THEN 'Missing column: reset_at'
        WHEN NOT has_created_at THEN 'Missing column: created_at'
        ELSE 'All columns present'
    END as details
FROM (
    SELECT
        EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'rate_limits'
        ) as table_exists,
        EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'rate_limits' AND column_name = 'id'
        ) as has_id,
        EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'rate_limits' AND column_name = 'user_id'
        ) as has_user_id,
        EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'rate_limits' AND column_name = 'endpoint'
        ) as has_endpoint,
        EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'rate_limits' AND column_name = 'request_count'
        ) as has_request_count,
        EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'rate_limits' AND column_name = 'reset_at'
        ) as has_reset_at,
        EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'rate_limits' AND column_name = 'created_at'
        ) as has_created_at
) struct_check
UNION ALL

-- ============================================================================
-- CHECK 2: check_rate_limit function exists with correct signature
-- Expected: Function exists and accepts (text, int, int) returns boolean
-- ============================================================================
SELECT
    'CHECK-2' as check_id,
    'check_rate_limit function' as check_name,
    CASE
        WHEN func_exists THEN 'PASS'
        ELSE 'FAIL'
    END as status,
    CASE
        WHEN func_exists THEN 'Function exists with correct signature'
        ELSE 'Function public.check_rate_limit(text, integer, integer) NOT FOUND'
    END as details
FROM (
    SELECT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public'
          AND p.proname = 'check_rate_limit'
          AND p.pronargs = 3
    ) as func_exists
) func_check
UNION ALL

-- ============================================================================
-- CHECK 3: RLS policy on rate_limits exists
-- Expected: rate_limits_user_isolation policy exists
-- ============================================================================
SELECT
    'CHECK-3' as check_id,
    'RLS policy: rate_limits_user_isolation' as check_name,
    CASE
        WHEN policy_exists THEN 'PASS'
        ELSE 'FAIL'
    END as status,
    CASE
        WHEN policy_exists THEN 'RLS policy exists for user isolation'
        ELSE 'Missing RLS policy rate_limits_user_isolation'
    END as details
FROM (
    SELECT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'rate_limits'
          AND policyname = 'rate_limits_user_isolation'
    ) as policy_exists
) policy_check
UNION ALL

-- ============================================================================
-- CHECK 4: Index on rate_limits for efficient lookups
-- Expected: Index on (user_id, endpoint) exists
-- ============================================================================
SELECT
    'CHECK-4' as check_id,
    'Index for efficient lookup' as check_name,
    CASE
        WHEN index_exists THEN 'PASS'
        ELSE 'WARNING'
    END as status,
    CASE
        WHEN index_exists THEN 'Index rate_limits_user_endpoint_active exists'
        ELSE 'No index on (user_id, endpoint) - queries will be slower'
    END as details
FROM (
    SELECT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'rate_limits'
          AND indexname = 'rate_limits_user_endpoint_active'
    ) as index_exists
) index_check
UNION ALL

-- ============================================================================
-- CHECK 5: Data integrity - no corrupted rate_limits rows
-- Expected: All rows have valid user_id, endpoint, request_count, reset_at
-- ============================================================================
SELECT
    'CHECK-5' as check_id,
    'Data integrity' as check_name,
    CASE
        WHEN total_rows = 0 THEN 'PASS'
        WHEN invalid_rows = 0 THEN 'PASS'
        ELSE 'FAIL'
    END as status,
    CASE
        WHEN total_rows = 0 THEN 'No rate_limits entries (clean state)'
        WHEN invalid_rows = 0 THEN 'All ' || total_rows || ' entries valid'
        ELSE 'Found ' || invalid_rows || ' corrupted entries (NULL user_id or endpoint)'
    END as details
FROM (
    SELECT
        COUNT(*) as total_rows,
        SUM(CASE WHEN user_id IS NULL OR endpoint IS NULL THEN 1 ELSE 0 END) as invalid_rows
    FROM public.rate_limits
) data_check
UNION ALL

-- ============================================================================
-- CHECK 6: No stale expired entries blocking query
-- Expected: Most entries are either recent or expired (cleanup ok)
-- ============================================================================
SELECT
    'CHECK-6' as check_id,
    'Stale entries check' as check_name,
    CASE
        WHEN expired_ratio < 0.5 THEN 'PASS'
        WHEN expired_ratio < 0.8 THEN 'WARNING'
        ELSE 'FAIL'
    END as status,
    CASE
        WHEN total_rows = 0 THEN 'No entries (new table)'
        WHEN expired_ratio < 0.5 THEN 'Cleanup not needed (' || expired_count || ' expired, ' || active_count || ' active)'
        ELSE 'Consider cleanup: ' || expired_count || ' expired entries out of ' || total_rows
    END as details
FROM (
    SELECT
        COUNT(*) as total_rows,
        SUM(CASE WHEN reset_at < NOW() THEN 1 ELSE 0 END) as expired_count,
        SUM(CASE WHEN reset_at >= NOW() THEN 1 ELSE 0 END) as active_count,
        CASE
            WHEN COUNT(*) = 0 THEN 0
            ELSE CAST(SUM(CASE WHEN reset_at < NOW() THEN 1 ELSE 0 END) AS DECIMAL) / COUNT(*)
        END as expired_ratio
    FROM public.rate_limits
) cleanup_check
ORDER BY check_id;

-- ============================================================================
-- SUMMARY
-- ============================================================================
-- All CHECK-* queries must return status = 'PASS' before hotfix deployment.
-- CHECK-3 (RLS policy) is critical for security.
-- CHECK-6 (stale entries) is informational - cleanup can happen anytime.
-- ============================================================================
