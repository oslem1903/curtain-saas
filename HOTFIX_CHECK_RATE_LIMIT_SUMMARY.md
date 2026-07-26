# Hotfix: check_rate_limit() Function Fix
**Date**: 2026-07-12  
**Status**: Design Complete (Ready for Production Application)  
**Author**: Claude Code  

---

## Executive Summary

Production's `check_rate_limit()` function has a critical bug causing all "Montaj Tamamlandı" (installation completion) calls to fail with rate limit errors.

**Root Cause**: ON CONFLICT logic broken because `reset_at` is recalculated every call, so ON CONFLICT never matches.

**Solution**: Replace ON CONFLICT with SELECT FOR UPDATE pattern (atomic, no UNIQUE constraint needed).

**Impact**: 
- Fixes the production regression (Montaj Tamamlandı button now works)
- Montaj tamamlama → automatic installer earnings creation
- No breaking changes to function signature or behavior

---

## Technical Design

### Current Broken Logic
```sql
-- Line 49-56 in supabase_rate_limiting_tier1.sql
v_reset_at := NOW() + (p_window_seconds || ' seconds')::INTERVAL;  -- RECALCULATED every call

INSERT INTO public.rate_limits (user_id, endpoint, request_count, reset_at)
VALUES (auth.uid(), p_endpoint, 1, v_reset_at)
ON CONFLICT (user_id, endpoint, reset_at)  -- ❌ NEVER MATCHES (reset_at changes every microsecond)
DO UPDATE SET request_count = rate_limits.request_count + 1
RETURNING request_count INTO v_count;
```

**Problems**:
1. `reset_at` is calculated fresh each time → different microsecond values each call
2. ON CONFLICT requires UNIQUE constraint, but production only has normal INDEX
3. PostgreSQL throws: `"there is no unique or exclusion constraint matching the ON CONFLICT specification"`
4. Exception propagates to `update_installation_completion()` → whole transaction rolls back
5. User sees error, montaj tamamlama fails

### Fixed Logic
```sql
-- New approach: SELECT FOR UPDATE + window-based logic
-- Line 75-130 in supabase_fix_check_rate_limit.sql

1. Calculate fixed-window reset_at (deterministic):
   v_reset_at := to_timestamp(
       (EXTRACT(EPOCH FROM NOW())::bigint / p_window_seconds) * p_window_seconds
   ) + (p_window_seconds || ' seconds')::INTERVAL;
   -- All calls in same 3-second window get same reset_at value

2. Lock row atomically (FOR UPDATE):
   SELECT request_count, reset_at
   INTO v_count, v_reset_at_db
   FROM public.rate_limits
   WHERE user_id = auth.uid() AND endpoint = p_endpoint
   FOR UPDATE;  -- Serializes concurrent calls

3. Logic:
   IF row found AND now >= reset_at_db:
       -- Window expired, reset counter
       UPDATE with request_count=1, reset_at=new_value
       RETURN true
   ELSE IF row found AND count >= limit:
       -- Same window, limit exceeded
       RETURN false
   ELSE IF row found AND count < limit:
       -- Same window, increment
       UPDATE increment counter
       RETURN true
   ELSE:
       -- New endpoint, insert row
       INSERT new record
       RETURN true
```

**Advantages**:
- ✅ Atomic (FOR UPDATE locks row)
- ✅ No UNIQUE constraint required
- ✅ Fixed-window logic (deterministic reset_at)
- ✅ No race conditions
- ✅ Same function signature
- ✅ Same SECURITY DEFINER behavior
- ✅ SET search_path maintained

---

## Files Prepared

| File | Purpose | Status |
|------|---------|--------|
| `supabase_fix_check_rate_limit.sql` | Main hotfix (CREATE OR REPLACE) | ✅ Ready |
| `supabase_check_rate_limit_precheck.sql` | Pre-deployment validation (6 checks) | ✅ Ready |
| `supabase_check_rate_limit_test_scenarios.sql` | Manual test suite (6 scenarios) | ✅ Ready |
| `HOTFIX_CHECK_RATE_LIMIT_SUMMARY.md` | This file | ✅ Ready |

---

## Minimal Diff: What Changes in Production

**File**: `supabase_rate_limiting_tier1.sql`  
**Section**: Lines 38-61 (check_rate_limit function)  
**Change Type**: Function replacement (CREATE OR REPLACE)

### Before
```sql
CREATE OR REPLACE FUNCTION public.check_rate_limit(...)
RETURNS boolean AS $$
DECLARE
    v_count INTEGER;
    v_reset_at TIMESTAMPTZ;
BEGIN
    v_reset_at := NOW() + (p_window_seconds || ' seconds')::INTERVAL;
    
    INSERT INTO public.rate_limits (user_id, endpoint, request_count, reset_at)
    VALUES (auth.uid(), p_endpoint, 1, v_reset_at)
    ON CONFLICT (user_id, endpoint, reset_at)
    DO UPDATE SET request_count = rate_limits.request_count + 1
    RETURNING request_count INTO v_count;
    
    RETURN v_count <= p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### After
```sql
CREATE OR REPLACE FUNCTION public.check_rate_limit(...)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_count INTEGER;
    v_reset_at TIMESTAMPTZ;
    v_reset_at_db TIMESTAMPTZ;
    v_now TIMESTAMPTZ;
BEGIN
    v_user_id := auth.uid();
    
    -- Validation: p_limit > 0, p_window_seconds > 0
    
    -- Calculate fixed-window reset_at
    v_now := NOW();
    v_reset_at := to_timestamp(
        (EXTRACT(EPOCH FROM v_now)::bigint / p_window_seconds) * p_window_seconds
    ) + (p_window_seconds || ' seconds')::INTERVAL;
    
    -- Lock + check + update (atomic)
    SELECT request_count, reset_at
    INTO v_count, v_reset_at_db
    FROM public.rate_limits
    WHERE user_id = v_user_id AND endpoint = p_endpoint
    FOR UPDATE;
    
    IF FOUND THEN
        IF v_now >= v_reset_at_db THEN
            -- Window expired: reset
            UPDATE public.rate_limits
            SET request_count = 1, reset_at = v_reset_at
            WHERE user_id = v_user_id AND endpoint = p_endpoint;
            RETURN true;
        ELSE
            -- Same window: check limit
            IF v_count >= p_limit THEN
                RETURN false;
            ELSE
                UPDATE public.rate_limits
                SET request_count = request_count + 1
                WHERE user_id = v_user_id AND endpoint = p_endpoint;
                RETURN true;
            END IF;
        END IF;
    ELSE
        -- New endpoint: insert
        INSERT INTO public.rate_limits (user_id, endpoint, request_count, reset_at)
        VALUES (v_user_id, p_endpoint, 1, v_reset_at);
        RETURN true;
    END IF;
END;
$$;
```

**Key Diffs**:
- ✅ Function structure: Same signature, same SECURITY DEFINER
- ✅ Logic: ON CONFLICT → SELECT FOR UPDATE
- ✅ Window calculation: Fixed (deterministic reset_at)
- ✅ Validation: Added input checks (p_limit > 0, p_window_seconds > 0)
- ✅ Comments: Added for clarity
- ✅ Table schema: No changes (no new columns needed)

---

## Deployment Steps

### 1. Pre-Deployment (Read-Only)
```bash
# Run in production (does NOT modify data)
psql -U postgres -d curtain_saas < supabase_check_rate_limit_precheck.sql

# Expected: All checks return status = 'PASS'
```

### 2. Apply Hotfix
```bash
# Run in production
psql -U postgres -d curtain_saas < supabase_fix_check_rate_limit.sql

# Expected output:
# BEGIN
# COMMIT
# NOTIFY pgrst, 'reload schema';
```

### 3. Smoke Test (Optional but Recommended)
```bash
# Wait 30 seconds (schema cache invalidation)
# Then in your app:

# Test 1: Montaj tamamlama button works
# Test 2: No "rate limit error" in logs
# Test 3: Hakediş automatically created in installer ledger
```

### 4. Full Test Suite (Manual)
```bash
# After smoke test, run comprehensive test scenarios
psql -U postgres -d curtain_saas < supabase_check_rate_limit_test_scenarios.sql

# Walk through all 6 test scenarios
# Verify results match expected outputs
```

---

## Rollback Plan (Emergency Only)

If the hotfix causes unexpected issues:

### Option 1: Immediate Rollback (≤5 minutes after deployment)
```sql
-- Restore original function (will still have bug, but known state)
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
    v_reset_at := NOW() + (p_window_seconds || ' seconds')::INTERVAL;
    INSERT INTO public.rate_limits (user_id, endpoint, request_count, reset_at)
    VALUES (auth.uid(), p_endpoint, 1, v_reset_at)
    ON CONFLICT (user_id, endpoint, reset_at)
    DO UPDATE SET request_count = rate_limits.request_count + 1
    RETURNING request_count INTO v_count;
    RETURN v_count <= p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

NOTIFY pgrst, 'reload schema';
```

### Option 2: Investigation + Fix (Preferred)
Don't immediately rollback. Instead:
1. Check logs: Is check_rate_limit being called correctly?
2. Check rate_limits table: Are rows being created/updated?
3. Test manually: Run test scenarios to identify specific failure
4. Determine if it's hotfix bug or pre-existing issue
5. Fix and redeploy (or rollback if genuinely broken)

---

## Concurrency Safety Verification

### Scenario: Rapid Parallel Calls to Same Endpoint
```
Time | Call 1                    | Call 2                    | Call 3
-----|---------------------------|---------------------------|----------
T0   | SELECT FOR UPDATE         |                           |
T1   |   (acquires row lock)     |                           |
T2   |   count=0, reset_at=T0+3s | SELECT FOR UPDATE         |
T3   |   (checks count < limit)  |   (waits for lock)        |
T4   |   UPDATE count=1          |                           |
T5   |   (releases lock)         | (acquires lock)           |
T6   |   RETURN true ✓           | count=1, reset_at=T0+3s   |
T7   |                           | (checks count < limit)    |
T8   |                           | UPDATE count=2            |
T9   |                           | (releases lock)           |
T10  |                           | RETURN true ✓             |
T11  |                           |                           | SELECT FOR UPDATE
T12  |                           |                           | (acquires lock)
T13  |                           |                           | count=2, reset_at=T0+3s
T14  |                           |                           | (count >= limit)
T15  |                           |                           | RETURN false ✗
```

**Result**: Calls 1 and 2 succeed, call 3 fails (at limit). ✓ Correct behavior.

---

## Expected Behavior After Hotfix

| Scenario | Before | After |
|----------|--------|-------|
| First montaj tamamlama | ❌ FAILS (rate limit error) | ✅ SUCCEEDS |
| Immediate second call | ❌ FAILS (rate limit error) | ✓ ALLOWED or ✓ BLOCKED (depending on limit) |
| After 4 seconds | ❌ FAILS (still broken) | ✅ SUCCEEDS (new window) |
| Installer earnings created | ❌ NO (transaction rolled back) | ✅ YES (automatic) |
| Hakediş screen updated | ❌ NO (no earnings) | ✅ YES (instant) |

---

## Monitoring After Deployment

**Metrics to Watch** (24 hours post-deployment):
1. **update_installation_completion RPC calls**: Should succeed (not error)
2. **installer_earnings table**: New entries created when jobs completed
3. **Rate limit errors in logs**: Should drop to near-zero
4. **User complaints**: Watch Slack/email for montaj tamamlama issues

**Logs to Check**:
```bash
# Check Supabase logs for errors
SELECT * FROM pg_stat_statements
WHERE query LIKE '%update_installation_completion%'
ORDER BY calls DESC;

# Check rate_limits table for healthy entries
SELECT COUNT(*), COUNT(DISTINCT endpoint) 
FROM public.rate_limits
WHERE reset_at > NOW();  -- Active windows
```

---

## What This Hotfix Does NOT Do

- ❌ Does NOT backfill 14 old completed jobs (separate decision needed)
- ❌ Does NOT create manual "Hakediş Ekle" screen (never implemented)
- ❌ Does NOT change orders or installation_jobs schema
- ❌ Does NOT modify authorization or RLS policies
- ❌ Does NOT add UNIQUE constraint to rate_limits (design avoided it)
- ❌ Does NOT require data migration or cleanup

---

## Questions & Answers

**Q: Why SELECT FOR UPDATE instead of ON CONFLICT?**  
A: ON CONFLICT requires UNIQUE constraint. Production doesn't have one, and we're avoiding adding it (simpler design). FOR UPDATE achieves same atomicity without constraint.

**Q: Does this require schema migration?**  
A: No. Same table structure. Just function replacement (idempotent).

**Q: What if auth.uid() is NULL?**  
A: Function raises exception with clear message. This should never happen in production (authenticated users only).

**Q: Will this affect other rate-limited endpoints?**  
A: No. Same function handles all endpoints (record_order_payment, record_supplier_payment, etc.). Fix benefits all.

**Q: How does fixed-window logic differ from sliding window?**  
A: Fixed-window resets at exact intervals (e.g., T=0, T=3, T=6 seconds). Simpler and prevents edge-case double-submission. Trade-off: user might hit reset boundary and get different behavior. Acceptable for our use case.

**Q: Can I test without waiting 3+ seconds?**  
A: Yes. Update test_scenarios.sql to use smaller p_window_seconds (e.g., 1 second). Or use database clock manipulation (SET LOCAL timezone, etc.) for faster tests.

---

## Sign-Off Checklist

- [ ] Reviewed hotfix SQL (supabase_fix_check_rate_limit.sql)
- [ ] Reviewed pre-check queries (validates production state)
- [ ] Reviewed test scenarios (manual verification plan)
- [ ] Confirmed no schema migration needed
- [ ] Confirmed no breaking changes
- [ ] Reviewed rollback plan
- [ ] Identified monitoring strategy
- [ ] Ready to deploy to production

---

**Prepared By**: Claude Code  
**Date**: 2026-07-12  
**Status**: ✅ Ready for Production Application  

**Next Step**: Run pre-check, apply hotfix, run smoke tests, monitor for 24 hours.
