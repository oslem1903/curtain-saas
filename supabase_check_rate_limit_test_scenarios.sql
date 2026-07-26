-- ============================================================================
-- TEST SCENARIOS: check_rate_limit() Fixed-Window Behavior
-- FILE: supabase_check_rate_limit_test_scenarios.sql
-- DATE: 2026-07-12
-- PURPOSE: Validate hotfixed rate limit function works correctly
-- STATUS: MANUAL TEST (run after hotfix deployed to verify behavior)
-- ============================================================================
-- PREREQUISITES:
-- 1. Hotfix supabase_fix_check_rate_limit.sql must be applied
-- 2. Connect to production database
-- 3. Use a test user or create a test user for these scenarios
-- 4. Allow ~10 minutes to run all tests (due to WAIT 4s delays)
-- ============================================================================

-- ============================================================================
-- SETUP: Create test user (use existing or mock auth.uid())
-- ============================================================================
-- For testing WITHOUT full auth setup, you can temporarily mock auth.uid()
-- by setting a variable at function call time.
-- If that's not feasible, run these tests using your app's normal auth flow.

-- ============================================================================
-- TEST SCENARIO 1: First Call Should Always Return TRUE
-- ============================================================================
-- Setup: Clear test data
DELETE FROM public.rate_limits WHERE endpoint LIKE 'test_%';

-- Test: First call to new endpoint should return TRUE
-- Expected: true (first request always allowed)
-- Verify: rate_limits table should have 1 new entry with request_count=1
SELECT
    'TEST-1' as test_name,
    'First call should return TRUE' as description,
    -- Call function (you'll need to set auth context)
    public.check_rate_limit('test_scenario_1', 1, 3) as result,
    'PASS if result = true' as expected;

-- Verify state after TEST-1
SELECT
    'TEST-1 VERIFY' as step,
    COUNT(*) as entry_count,
    MIN(request_count) as min_count,
    MAX(request_count) as max_count
FROM public.rate_limits
WHERE endpoint = 'test_scenario_1';

-- ============================================================================
-- TEST SCENARIO 2: Second Call Same Window Should Return FALSE (limit=1)
-- ============================================================================
-- Setup: Use same endpoint and window (call immediately, within 3 seconds)

-- Test: Second call within same window with limit=1 should return FALSE
-- Expected: false (limit exceeded in current window)
-- Verify: request_count should be incremented to 2 but still return FALSE
SELECT
    'TEST-2' as test_name,
    'Second call same window should return FALSE' as description,
    public.check_rate_limit('test_scenario_1', 1, 3) as result,
    'PASS if result = false' as expected;

-- Verify state after TEST-2
SELECT
    'TEST-2 VERIFY' as step,
    COUNT(*) as entry_count,
    request_count,
    reset_at,
    NOW() as current_time,
    CASE
        WHEN NOW() < reset_at THEN 'Same window (active)'
        ELSE 'Window expired'
    END as window_status
FROM public.rate_limits
WHERE endpoint = 'test_scenario_1';

-- ============================================================================
-- TEST SCENARIO 3: After Window Expires, Should Return TRUE Again
-- ============================================================================
-- Setup: Wait for window to expire (reset_at > NOW())
-- NOTE: This step requires WAITING 4+ seconds (p_window_seconds=3 + small buffer)

SELECT
    'TEST-3 SETUP' as step,
    'Waiting 4 seconds for window to expire...' as note,
    NOW() as wait_start_time
FROM (SELECT 1) dummy;

-- PostgreSQL timing (you'll need to run this manually with a delay)
-- Option 1: In psql, use \! sleep 4
-- Option 2: In application, use actual timer
-- Option 3: Skip this and run the next SELECT after 4 seconds manually

-- Wait 4 seconds (must be done in your test harness, not pure SQL)
-- In psql: \! sleep 4

-- Test: After window expires, call should return TRUE (new window)
-- Expected: true (new window started, counter reset)
SELECT
    'TEST-3' as test_name,
    'After window expire should return TRUE' as description,
    public.check_rate_limit('test_scenario_1', 1, 3) as result,
    'PASS if result = true' as expected,
    NOW() as call_time;

-- Verify state after TEST-3
SELECT
    'TEST-3 VERIFY' as step,
    COUNT(*) as entry_count,
    request_count,
    reset_at,
    NOW() as current_time,
    CASE
        WHEN NOW() < reset_at THEN 'Same window (active)'
        ELSE 'Window expired'
    END as window_status
FROM public.rate_limits
WHERE endpoint = 'test_scenario_1';

-- ============================================================================
-- TEST SCENARIO 4: Different Endpoints Are Independent
-- ============================================================================
-- Setup: Use different endpoint names

DELETE FROM public.rate_limits WHERE endpoint IN ('test_endpoint_a', 'test_endpoint_b');

-- Test: Different endpoints should have independent limits
-- Call endpoint_a once → should return TRUE
SELECT
    'TEST-4a' as test_name,
    'Different endpoint A (first call)' as description,
    public.check_rate_limit('test_endpoint_a', 1, 3) as result;

-- Call endpoint_b once → should return TRUE (independent limit)
SELECT
    'TEST-4b' as test_name,
    'Different endpoint B (first call)' as description,
    public.check_rate_limit('test_endpoint_b', 1, 3) as result;

-- Call endpoint_a again → should return FALSE (same endpoint, limit exceeded)
SELECT
    'TEST-4c' as test_name,
    'Endpoint A (second call, should be FALSE)' as description,
    public.check_rate_limit('test_endpoint_a', 1, 3) as result;

-- Verify: endpoint_b should still allow TRUE (independent)
SELECT
    'TEST-4d' as test_name,
    'Endpoint B (second call, should still be TRUE)' as description,
    public.check_rate_limit('test_endpoint_b', 1, 3) as result;

-- Verify state
SELECT
    'TEST-4 VERIFY' as step,
    endpoint,
    COUNT(*) as call_count,
    request_count,
    reset_at
FROM public.rate_limits
WHERE endpoint IN ('test_endpoint_a', 'test_endpoint_b')
GROUP BY endpoint, request_count, reset_at;

-- ============================================================================
-- TEST SCENARIO 5: Higher Limit Allows Multiple Calls
-- ============================================================================
-- Setup: Clear test data

DELETE FROM public.rate_limits WHERE endpoint = 'test_higher_limit';

-- Test: With limit=3, should allow 3 calls in same window
SELECT
    'TEST-5a' as test_name,
    'Limit=3 (call 1)' as description,
    public.check_rate_limit('test_higher_limit', 3, 3) as result;

SELECT
    'TEST-5b' as test_name,
    'Limit=3 (call 2)' as description,
    public.check_rate_limit('test_higher_limit', 3, 3) as result;

SELECT
    'TEST-5c' as test_name,
    'Limit=3 (call 3)' as description,
    public.check_rate_limit('test_higher_limit', 3, 3) as result;

SELECT
    'TEST-5d' as test_name,
    'Limit=3 (call 4 - should be FALSE)' as description,
    public.check_rate_limit('test_higher_limit', 3, 3) as result;

-- Verify state
SELECT
    'TEST-5 VERIFY' as step,
    COUNT(*) as entry_count,
    request_count,
    window_exceeded
FROM (
    SELECT
        request_count,
        CASE WHEN request_count > 3 THEN 'YES' ELSE 'NO' END as window_exceeded
    FROM public.rate_limits
    WHERE endpoint = 'test_higher_limit'
) t
GROUP BY request_count, window_exceeded;

-- ============================================================================
-- TEST SCENARIO 6: update_installation_completion Integration Test
-- ============================================================================
-- Setup: This is a smoke test to ensure montaj tamamlama now works

-- Prerequisites:
--   1. Have a test company_id
--   2. Have a test installation_job with assigned installer
--   3. Have order associated with job

-- Test: Call update_installation_completion RPC
-- This WILL trigger check_rate_limit internally
-- Expected: Should succeed (not fail with rate limit error)
-- Note: Only run if you have valid test data

-- If you have test data, uncomment and modify:
-- SELECT public.update_installation_completion(
--     'YOUR_COMPANY_ID'::uuid,
--     'YOUR_JOB_ID'::uuid,
--     'completed',
--     'YOUR_ORDER_ID'::uuid,
--     'montaj_tamamlandi'
-- ) as result;

SELECT
    'TEST-6' as test_name,
    'Integration: update_installation_completion should succeed' as description,
    '(Requires valid test data - see comments)' as note;

-- ============================================================================
-- CLEANUP: Remove test data
-- ============================================================================
-- Uncomment to clean up test entries after verification

-- DELETE FROM public.rate_limits WHERE endpoint LIKE 'test_%';

-- ============================================================================
-- EXPECTED RESULTS SUMMARY
-- ============================================================================
-- TEST-1: result = true ✓
-- TEST-2: result = false ✓
-- TEST-3: result = true ✓ (after 4-second wait)
-- TEST-4a: result = true ✓
-- TEST-4b: result = true ✓
-- TEST-4c: result = false ✓
-- TEST-4d: result = true ✓ (independent endpoint)
-- TEST-5a: result = true ✓
-- TEST-5b: result = true ✓
-- TEST-5c: result = true ✓
-- TEST-5d: result = false ✓ (4th call, limit=3)
-- TEST-6: should complete without rate limit error ✓

-- ============================================================================
-- TROUBLESHOOTING
-- ============================================================================
-- If any test fails:
--
-- Issue: "User not authenticated for rate limit check"
-- Cause: auth.uid() returns NULL (auth context not set)
-- Fix: Run tests within authenticated app context or use test user
--
-- Issue: All results FALSE
-- Cause: rate_limits entries lingering from previous tests
-- Fix: Run TRUNCATE public.rate_limits before retesting
--
-- Issue: Window-based timing tests fail
-- Cause: Not waiting long enough between calls
-- Fix: Ensure 4+ second delay between TEST-2 and TEST-3
--
-- Issue: "relation "public.rate_limits" does not exist"
-- Cause: Hotfix not applied
-- Fix: Apply supabase_fix_check_rate_limit.sql first
--
-- Issue: update_installation_completion still fails
-- Cause: Hotfix applied but schema cache not invalidated
-- Fix: Disconnect and reconnect, or wait 5 minutes for cache expiry
-- ============================================================================
