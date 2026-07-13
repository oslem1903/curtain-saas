-- ============================================================================
-- PRECHECK: Production State Analysis for check_rate_limit Hotfix
-- FILE: production_precheck_check_rate_limit.sql
-- DATE: 2026-07-13
-- PURPOSE: Verify production state before applying hotfix
-- SAFE: Read-only, no modifications
-- ============================================================================

-- ============================================================================
-- 1. DUPLICATE CHECK: Look for duplicate (user_id, endpoint, reset_at) rows
-- ============================================================================
-- If duplicates exist with same window, we have data inconsistency
-- EXPECTED: None or minimal (old/expired entries only)

SELECT
    'DUPLICATES' AS check_name,
    user_id,
    endpoint,
    reset_at,
    COUNT(*) AS row_count,
    ARRAY_AGG(id) AS row_ids,
    CASE
        WHEN COUNT(*) > 1 THEN 'FAIL: Duplicate (user_id, endpoint, reset_at) found'
        ELSE 'PASS: No duplicates'
    END AS status
FROM public.rate_limits
WHERE reset_at > NOW()  -- Only check active windows
GROUP BY user_id, endpoint, reset_at
HAVING COUNT(*) > 1;

-- ============================================================================
-- 2. CONSTRAINT/INDEX ANALYSIS: What constraints and indexes exist?
-- ============================================================================

SELECT
    'CONSTRAINTS_INDEXES' AS check_name,
    constraint_name,
    constraint_type,
    is_deferrable,
    initially_deferred
FROM information_schema.table_constraints
WHERE table_schema = 'public' AND table_name = 'rate_limits'
ORDER BY constraint_type, constraint_name;

SELECT
    'INDEX_DETAILS' AS check_name,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'rate_limits'
ORDER BY indexname;

-- ============================================================================
-- 3. CHECK: Does (user_id, endpoint, reset_at) UNIQUE constraint exist?
-- ============================================================================

SELECT
    CASE
        WHEN EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE table_schema = 'public'
            AND table_name = 'rate_limits'
            AND constraint_type = 'UNIQUE'
            AND constraint_name ~ '(user_id|endpoint|reset_at)'  -- rough check
        ) THEN 'PASS: UNIQUE constraint exists'
        ELSE 'FAIL: No (user_id, endpoint, reset_at) UNIQUE constraint found'
    END AS constraint_status;

-- ============================================================================
-- 4. FUNCTION SIGNATURE CHECK: Verify current implementation
-- ============================================================================

SELECT
    'FUNCTION_SIGNATURE' AS check_name,
    proname,
    pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p
WHERE p.proname = 'check_rate_limit'
AND p.pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

-- ============================================================================
-- 5. ON CONFLICT PATTERN CHECK: Is current function using ON CONFLICT?
-- ============================================================================

SELECT
    'ON_CONFLICT_USAGE' AS check_name,
    CASE
        WHEN pg_get_functiondef('public.check_rate_limit(text, integer, integer)'::regprocedure)
             LIKE '%ON CONFLICT%'
        THEN 'YES: Function uses ON CONFLICT pattern'
        ELSE 'NO: Function does not use ON CONFLICT'
    END AS pattern_check;

-- ============================================================================
-- 6. TABLE STRUCTURE: Column definitions
-- ============================================================================

SELECT
    'TABLE_STRUCTURE' AS check_name,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'rate_limits'
ORDER BY ordinal_position;

-- ============================================================================
-- 7. DATA SNAPSHOT: Current rate_limits entries
-- ============================================================================

SELECT
    'DATA_SNAPSHOT' AS check_name,
    COUNT(*) AS total_entries,
    COUNT(CASE WHEN reset_at > NOW() THEN 1 END) AS active_entries,
    COUNT(CASE WHEN reset_at <= NOW() THEN 1 END) AS expired_entries,
    MIN(created_at) AS oldest_entry,
    MAX(created_at) AS newest_entry
FROM public.rate_limits;

-- ============================================================================
-- 8. SUMMARY REPORT
-- ============================================================================

WITH checks AS (
    SELECT
        'UNIQUE Constraint' AS check_item,
        CASE
            WHEN EXISTS (
                SELECT 1 FROM information_schema.table_constraints
                WHERE table_schema = 'public'
                AND table_name = 'rate_limits'
                AND constraint_type = 'UNIQUE'
            ) THEN 'EXISTS ✓'
            ELSE 'MISSING ✗'
        END AS status
    UNION ALL
    SELECT
        'ON CONFLICT Pattern',
        CASE
            WHEN pg_get_functiondef('public.check_rate_limit(text, integer, integer)'::regprocedure)
                 LIKE '%ON CONFLICT%'
            THEN 'USED ✓'
            ELSE 'NOT USED'
        END
    UNION ALL
    SELECT
        'Function SECURITY DEFINER',
        CASE
            WHEN (SELECT prosecdef FROM pg_proc
                  WHERE proname = 'check_rate_limit'
                  AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
                  LIMIT 1) = true
            THEN 'YES ✓'
            ELSE 'NO ✗'
        END
)
SELECT 'PRECHECK SUMMARY' AS phase, check_item, status FROM checks;

-- ============================================================================
-- END OF PRECHECK
-- ============================================================================
