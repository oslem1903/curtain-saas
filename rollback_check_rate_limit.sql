-- ============================================================================
-- ROLLBACK: Revert check_rate_limit hotfix
-- FILE: rollback_check_rate_limit.sql
-- DATE: 2026-07-13
-- PURPOSE: Undo the deterministic fixed-window hotfix if critical issues arise
-- STATUS: Emergency rollback only
-- ============================================================================

BEGIN TRANSACTION;

-- ============================================================================
-- STEP 1: Drop UNIQUE constraint if it exists
-- ============================================================================
-- This removes the constraint that was added in the hotfix
-- Safe: IF EXISTS prevents error if already removed

DO $$
BEGIN
    ALTER TABLE public.rate_limits
    DROP CONSTRAINT IF EXISTS rate_limits_user_endpoint_window_unique;
END $$;

-- ============================================================================
-- STEP 2: Restore original function definition from production
-- ============================================================================
-- This is the EXACT original function from supabase_rate_limiting_tier1.sql
-- Signature: public.check_rate_limit(text, integer, integer) → boolean

CREATE OR REPLACE FUNCTION public.check_rate_limit(
    p_endpoint TEXT,
    p_limit INTEGER DEFAULT 1,
    p_window_seconds INTEGER DEFAULT 5
)
RETURNS boolean AS $$
DECLARE
    v_count INTEGER;
    v_reset_at TIMESTAMPTZ;
BEGIN
    -- Original logic: dynamic reset_at (changes every call)
    v_reset_at := NOW() + (p_window_seconds || ' seconds')::INTERVAL;

    -- Original pattern: ON CONFLICT (without UNIQUE constraint)
    INSERT INTO public.rate_limits (user_id, endpoint, request_count, reset_at)
    VALUES (auth.uid(), p_endpoint, 1, v_reset_at)
    ON CONFLICT (user_id, endpoint, reset_at)
    DO UPDATE SET request_count = rate_limits.request_count + 1
    RETURNING request_count INTO v_count;

    RETURN v_count <= p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- STEP 3: Update function documentation to reflect rollback
-- ============================================================================

COMMENT ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) IS
'Rate limit checker (ORIGINAL PRODUCTION VERSION - REVERTED). '
'WARNING: This version has known issues with ON CONFLICT pattern. '
'Details: '
'  - Uses dynamic reset_at calculation (changes every call) '
'  - Expects UNIQUE constraint on (user_id, endpoint, reset_at) '
'  - Production may lack required UNIQUE constraint '
'  - May fail with "no unique or exclusion constraint matching" error '
'This is a temporary rollback. Investigate root cause before re-applying hotfix.';

-- ============================================================================
-- STEP 4: Verify rollback completed
-- ============================================================================

SELECT 'Rollback step: Function restoration' AS phase,
       COUNT(*) AS function_count,
       CASE
           WHEN COUNT(*) = 1 THEN '✓ Original function restored'
           ELSE 'Warning: Multiple versions found'
       END AS status
FROM pg_proc
WHERE proname = 'check_rate_limit'
AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

-- ============================================================================
-- STEP 5: Verify UNIQUE constraint was removed
-- ============================================================================

SELECT 'Rollback step: Constraint removal' AS phase,
       CASE
           WHEN EXISTS (
               SELECT 1 FROM information_schema.table_constraints
               WHERE table_schema = 'public'
               AND table_name = 'rate_limits'
               AND constraint_name = 'rate_limits_user_endpoint_window_unique'
           ) THEN '✗ Constraint still exists (removal failed)'
           ELSE '✓ Constraint successfully removed'
       END AS status;

-- ============================================================================
-- END TRANSACTION
-- ============================================================================

COMMIT;

-- ============================================================================
-- POST-ROLLBACK INVESTIGATION STEPS
-- ============================================================================
--
-- If this rollback was necessary, investigate:
--
-- 1. Check for errors in application logs after hotfix was applied:
--    grep -i "floor\|epoch\|constraint\|conflict" logs/
--
-- 2. Verify window calculation behavior:
--    SELECT EXTRACT(EPOCH FROM NOW()) AS now_epoch,
--           floor(EXTRACT(EPOCH FROM NOW()) / 5)::bigint AS window_boundary,
--           (floor(EXTRACT(EPOCH FROM NOW()) / 5)::bigint) * 5 AS reset_calc;
--
-- 3. Check rate_limits table state:
--    SELECT COUNT(*), COUNT(DISTINCT (user_id, endpoint, reset_at))
--    FROM public.rate_limits;
--
-- 4. Look for data integrity issues from hotfix period:
--    SELECT user_id, endpoint, reset_at, COUNT(*) AS cnt
--    FROM public.rate_limits
--    WHERE created_at > (NOW() - INTERVAL '1 hour')
--    GROUP BY user_id, endpoint, reset_at
--    HAVING COUNT(*) > 1;
--
-- 5. Review function execution statistics:
--    SELECT * FROM pg_stat_user_functions
--    WHERE funcname = 'check_rate_limit';
--
-- 6. Test original function manually:
--    TRUNCATE public.rate_limits;
--    SELECT check_rate_limit('test', 1, 5);  -- Call 1
--    SELECT check_rate_limit('test', 1, 5);  -- Call 2
--    SELECT COUNT(*) FROM public.rate_limits;  -- Should be > 1 (bug reproduced)
--
-- ============================================================================
