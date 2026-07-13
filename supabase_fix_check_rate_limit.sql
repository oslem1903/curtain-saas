-- ============================================================================
-- HOTFIX: Fix check_rate_limit() with Deterministic Fixed Window
-- FILE: supabase_fix_check_rate_limit.sql
-- DATE: 2026-07-13
-- PURPOSE: Replace dynamic reset_at with deterministic fixed window
--          Add UNIQUE constraint for atomicity guarantee
-- STATUS: HOTFIX (urgent, minimal change only)
-- ============================================================================

-- ROOT CAUSE:
-- 1. Original ON CONFLICT (user_id, endpoint, reset_at) pattern expects
--    UNIQUE constraint on (user_id, endpoint, reset_at)
--
-- 2. Production has only normal INDEX, not UNIQUE constraint:
--    CREATE INDEX IF NOT EXISTS rate_limits_user_endpoint_active
--      ON public.rate_limits(user_id, endpoint, reset_at);
--
-- 3. ON CONFLICT requires matching UNIQUE constraint, not normal index
--    → "ON CONFLICT" error: no unique or exclusion constraint matching
--
-- 4. Original function calculates reset_at = NOW() + interval every call
--    → Even with constraint, different calls in same window get different reset_at
--    → UPSERT can never match existing row
--
-- SOLUTION:
-- 1. Calculate reset_at deterministically from current epoch time using floor:
--    - Extract epoch seconds
--    - Divide by window (using floor for precision)
--    - Multiply back (get window boundary)
--    - Add window duration = window end time (reset_at)
--    - Result: Same window → same reset_at (deterministic)
--
-- 2. Check for duplicates before adding UNIQUE constraint
--    - Prevent constraint creation failure
--    - If duplicates exist, migration fails with clear error
--
-- 3. Add UNIQUE (user_id, endpoint, reset_at) constraint
--    - Idempotent: if constraint already exists, skip
--    - Enables atomic UPSERT
--
-- 4. Use atomic UPSERT pattern:
--    INSERT ... ON CONFLICT ... DO UPDATE
--
-- ============================================================================

BEGIN TRANSACTION;

-- ============================================================================
-- STEP 1: PRE-CONSTRAINT CHECK - Detect duplicates before adding constraint
-- ============================================================================
-- If duplicate (user_id, endpoint, reset_at) rows exist in active window,
-- adding UNIQUE constraint will fail.
-- Fail migration explicitly with detailed error message.

DO $$
DECLARE
    v_duplicate_count INTEGER;
    v_duplicate_info TEXT;
BEGIN
    -- Count duplicates in active windows (reset_at > NOW())
    SELECT COUNT(*)
    INTO v_duplicate_count
    FROM (
        SELECT user_id, endpoint, reset_at, COUNT(*) AS cnt
        FROM public.rate_limits
        WHERE reset_at > NOW()
        GROUP BY user_id, endpoint, reset_at
        HAVING COUNT(*) > 1
    ) subq;

    IF v_duplicate_count > 0 THEN
        -- Build detailed error message
        SELECT string_agg(
            'User: ' || user_id || ', Endpoint: ' || endpoint ||
            ', reset_at: ' || reset_at || ', Count: ' || cnt,
            E'\n'
        )
        INTO v_duplicate_info
        FROM (
            SELECT user_id, endpoint, reset_at, COUNT(*) AS cnt
            FROM public.rate_limits
            WHERE reset_at > NOW()
            GROUP BY user_id, endpoint, reset_at
            HAVING COUNT(*) > 1
        ) subq;

        RAISE EXCEPTION
            'CONSTRAINT CREATION FAILED: % duplicate (user_id, endpoint, reset_at) rows found in active windows. '
            'Manual deconfliction required before proceeding. Details: %',
            v_duplicate_count, v_duplicate_info;
    END IF;
END $$;

-- ============================================================================
-- STEP 2: Add UNIQUE constraint (idempotent)
-- ============================================================================
-- Only add if constraint does not already exist
-- This allows migration to be safely re-run

DO $$
BEGIN
    -- Check if constraint already exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public'
        AND table_name = 'rate_limits'
        AND constraint_type = 'UNIQUE'
        AND constraint_name = 'rate_limits_user_endpoint_window_unique'
    ) THEN
        ALTER TABLE public.rate_limits
        ADD CONSTRAINT rate_limits_user_endpoint_window_unique
        UNIQUE (user_id, endpoint, reset_at);
    END IF;
END $$;

-- ============================================================================
-- STEP 3: Replace check_rate_limit() function with deterministic window logic
-- ============================================================================
-- Signature: check_rate_limit(text, integer, integer) → boolean
-- Same behavior: Returns true if within limit, false if exceeded
--
-- Key improvements:
--
-- 1. Deterministic fixed-window calculation using floor():
--    v_window_boundary := floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
--    - All calls within same window → same reset_at value
--    - Enables ON CONFLICT to match existing row atomically
--
-- 2. Single clock_timestamp() capture:
--    - v_now := clock_timestamp() at function start
--    - All window calculations use v_now (no time drift)
--    - Prevents inconsistent behavior within single call
--
-- 3. Input validation for safety:
--    - auth.uid() null check → return false (not authenticated)
--    - p_limit > 0 check → return false (invalid limit)
--    - p_window_seconds > 0 check → return false (invalid window)
--    - No data inserted if validation fails
--
-- 4. Security:
--    - SECURITY DEFINER (executes as creator, not caller)
--    - SET search_path prevents schema injection
--
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_rate_limit(
    p_endpoint TEXT,
    p_limit INTEGER DEFAULT 1,
    p_window_seconds INTEGER DEFAULT 5
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_now TIMESTAMPTZ;
    v_now_epoch NUMERIC;
    v_window_boundary BIGINT;
    v_reset_at TIMESTAMPTZ;
    v_count INTEGER;
BEGIN
    -- ========================================================================
    -- SECURITY: Capture time once, use consistently
    -- ========================================================================
    v_now := clock_timestamp();

    -- ========================================================================
    -- VALIDATION: User authentication
    -- ========================================================================
    v_user_id := auth.uid();

    IF v_user_id IS NULL THEN
        -- Unauthenticated: fail safely, do not insert data
        RETURN false;
    END IF;

    -- ========================================================================
    -- VALIDATION: Input parameter checks
    -- ========================================================================
    IF p_limit <= 0 THEN
        -- Invalid limit: fail safely, do not insert data
        RETURN false;
    END IF;

    IF p_window_seconds <= 0 THEN
        -- Invalid window: fail safely, do not insert data
        RETURN false;
    END IF;

    -- ========================================================================
    -- WINDOW CALCULATION: Deterministic fixed-window logic
    -- ========================================================================
    -- Key: All calls within same p_window_seconds interval get same reset_at
    --
    -- Formula: floor(epoch / window) * window (window boundary)
    -- Then add window duration = end of window (reset_at)
    --
    -- Example: p_window_seconds = 5
    --   Epoch | Window Boundary | Calls in Window  | reset_at (boundary + 5s)
    --   1000 |      1000        | 1000-1004        | 1005
    --   1001 |      1000        | 1000-1004        | 1005 (same!)
    --   1004 |      1000        | 1000-1004        | 1005 (same!)
    --   1005 |      1005        | 1005-1009        | 1010 (new window)
    --
    -- This ensures ON CONFLICT matches when same window, creates new row when different window

    v_now_epoch := EXTRACT(EPOCH FROM v_now);
    v_window_boundary := (floor(v_now_epoch / p_window_seconds)::bigint) * p_window_seconds;
    v_reset_at := to_timestamp(v_window_boundary) + (p_window_seconds || ' seconds')::INTERVAL;

    -- ========================================================================
    -- ATOMIC UPSERT: Increment counter or create new entry
    -- ========================================================================
    -- ON CONFLICT now matches correctly because:
    -- 1. We have UNIQUE (user_id, endpoint, reset_at) constraint
    -- 2. Same window → same reset_at → successful match → UPDATE
    -- 3. Different window → new reset_at → INSERT new row
    --
    -- The RETURNING clause captures the final request_count,
    -- whether from INSERT or UPDATE

    INSERT INTO public.rate_limits (
        user_id,
        endpoint,
        request_count,
        reset_at,
        created_at
    )
    VALUES (
        v_user_id,
        p_endpoint,
        1,
        v_reset_at,
        v_now
    )
    ON CONFLICT (user_id, endpoint, reset_at)
    DO UPDATE SET
        request_count = rate_limits.request_count + 1
    RETURNING request_count INTO v_count;

    -- ========================================================================
    -- RESULT: Return true if within limit, false if exceeded
    -- ========================================================================
    -- The UPSERT always succeeds (either INSERT or UPDATE),
    -- so v_count is always populated at this point.
    -- If request_count <= p_limit, allow the request (return true)
    -- If request_count > p_limit, deny the request (return false)

    RETURN v_count <= p_limit;

END;
$$;

-- ============================================================================
-- STEP 4: Update function documentation
-- ============================================================================

COMMENT ON FUNCTION public.check_rate_limit(TEXT, INTEGER, INTEGER) IS
'Rate limit checker using deterministic fixed-window algorithm with atomic UPSERT. '
'Prevents duplicate rapid submissions of financial operations. '
'Parameters: '
'  p_endpoint: Identifier for operation being rate-limited (e.g., "record_order_payment") '
'  p_limit: Maximum requests per window (default: 1, must be > 0) '
'  p_window_seconds: Time window in seconds (default: 5, must be > 0) '
'Returns: TRUE if request is within limit, FALSE if limit exceeded or validation failed '
'Behavior: '
'  - Deterministic window: All calls within same fixed boundary get identical reset_at '
'  - Floor-based calculation: window_boundary = floor(epoch / window) * window '
'  - Atomic UPSERT: Increments counter atomically, no race conditions '
'  - Automatic reset: Counter resets when new window begins '
'  - Per-user isolation: Each user has independent rate limits '
'  - Single clock_timestamp(): All calculations within call use consistent time '
'Validation: '
'  - auth.uid() must be non-NULL (user must be authenticated) '
'  - p_limit must be > 0 '
'  - p_window_seconds must be > 0 '
'  - If any validation fails, returns FALSE without inserting data '
'Example: '
'  SELECT check_rate_limit(''record_order_payment'', 1, 5) '
'  → First call within 0-5s: TRUE (request_count = 1 <= limit 1) '
'  → Second call within 0-5s: FALSE (request_count = 2 > limit 1) '
'  → First call within 5-10s: TRUE (new window, counter reset to 1)';

-- ============================================================================
-- STEP 5: Verify constraint creation (informational)
-- ============================================================================

SELECT 'Migration verification: UNIQUE constraint' AS check_name,
       CASE
           WHEN EXISTS (
               SELECT 1 FROM information_schema.table_constraints
               WHERE table_schema = 'public'
               AND table_name = 'rate_limits'
               AND constraint_type = 'UNIQUE'
               AND constraint_name = 'rate_limits_user_endpoint_window_unique'
           ) THEN '✓ EXISTS and ACTIVE'
           ELSE '✗ CONSTRAINT NOT FOUND (unexpected)'
       END AS status;

-- ============================================================================
-- STEP 6: Verify function was replaced
-- ============================================================================

SELECT 'Migration verification: Function replacement' AS check_name,
       COUNT(*) AS function_count,
       CASE
           WHEN COUNT(*) = 1 THEN '✓ Single function found'
           ELSE '✗ UNEXPECTED: Multiple versions'
       END AS status
FROM pg_proc
WHERE proname = 'check_rate_limit'
AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');

-- ============================================================================
-- END TRANSACTION
-- ============================================================================

COMMIT;

-- ============================================================================
-- NOTIFICATION: Schema cache invalidation (for Supabase PostgREST)
-- ============================================================================

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- DEPLOYMENT VERIFICATION (Run after applying this hotfix)
-- ============================================================================
-- See test_scenarios file for comprehensive test suite
-- Quick manual verification:
--
-- 1. Create clean test environment:
--    TRUNCATE public.rate_limits;
--
-- 2. Test first call (should return true):
--    SELECT public.check_rate_limit('test_endpoint', 1, 5);
--    Expected: true
--    Verify: SELECT COUNT(*) FROM public.rate_limits; → 1 row
--
-- 3. Test second call in same window (should return false):
--    SELECT public.check_rate_limit('test_endpoint', 1, 5);
--    Expected: false
--    Verify: SELECT COUNT(*) FROM public.rate_limits; → still 1 row (UPSERT updated)
--           SELECT request_count FROM public.rate_limits; → 2
--
-- 4. Verify deterministic reset_at (all calls same window, same reset_at):
--    SELECT reset_at FROM public.rate_limits; → single value
--
-- 5. Wait 6 seconds, test new window (should return true):
--    WAIT 6 seconds
--    SELECT public.check_rate_limit('test_endpoint', 1, 5);
--    Expected: true
--    Verify: SELECT COUNT(*) FROM public.rate_limits; → 2 rows (new window)
--
-- ============================================================================
