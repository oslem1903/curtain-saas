# Deployment Checklist: check_rate_limit Hotfix
**Date**: 2026-07-12  
**Target**: Production Database  
**Prepared By**: Claude Code  

---

## Pre-Deployment Phase

### Code Review
- [ ] Reviewed `supabase_fix_check_rate_limit.sql`
  - [ ] Signature unchanged: `check_rate_limit(text, integer, integer) RETURNS boolean`
  - [ ] SECURITY DEFINER retained
  - [ ] SET search_path = public, pg_temp included
  - [ ] No schema migration required
  - [ ] SELECT FOR UPDATE pattern is atomic
  - [ ] Fixed-window logic correct (deterministic reset_at)

### Pre-Deployment Validation
- [ ] Run `supabase_check_rate_limit_precheck.sql` on production
  - [ ] CHECK-1: rate_limits table structure ✓ PASS
  - [ ] CHECK-2: check_rate_limit function exists ✓ PASS
  - [ ] CHECK-3: RLS policy exists ✓ PASS
  - [ ] CHECK-4: Index for lookup ✓ PASS or WARNING (acceptable)
  - [ ] CHECK-5: Data integrity ✓ PASS
  - [ ] CHECK-6: Stale entries check ✓ PASS or WARNING (acceptable)
  - [ ] **No FAIL results before proceeding**

### Risk Assessment
- [ ] Function is SECURITY DEFINER (requires definer privileges)
  - [ ] Definer is `postgres` or `supabase_admin` (confirm in \df output)
- [ ] No UNIQUE constraint added (avoids schema change)
- [ ] No table migration (same rate_limits table)
- [ ] No permission grants needed (same as before)
- [ ] Rollback possible by restoring original function (reversible)

---

## Deployment Phase

### Step 1: Create Backup (Optional but Recommended)
```bash
# Optional: Backup current function definition
psql -U postgres -d curtain_saas -c "SELECT pg_get_functiondef('public.check_rate_limit(text, integer, integer)')" > check_rate_limit_backup.sql

# Verify backup captured the original
grep "ON CONFLICT" check_rate_limit_backup.sql
```

### Step 2: Apply Hotfix
```bash
# Run hotfix (idempotent, safe to re-run)
psql -U postgres -d curtain_saas < supabase_fix_check_rate_limit.sql
```

**Expected Output**:
```
BEGIN
COMMIT
NOTIFY pgrst, 'reload schema';
```

**On Error**:
- [ ] If syntax error: Check hotfix file for typos (see HOTFIX_CHECK_RATE_LIMIT_SUMMARY.md)
- [ ] If permission error: Ensure user is postgres/superuser
- [ ] If function doesn't exist: Likely pre-check missed (run CHECK-2 again)

### Step 3: Verify Deployment
```bash
# Confirm new function is in place
psql -U postgres -d curtain_saas -c "SELECT pg_get_functiondef('public.check_rate_limit(text, integer, integer)');" | head -20

# Should show: "SELECT FOR UPDATE" pattern (NOT "ON CONFLICT")
# Should show: "LANGUAGE plpgsql SECURITY DEFINER"
```

- [ ] Function signature is unchanged
- [ ] SECURITY DEFINER present
- [ ] SET search_path present
- [ ] SELECT FOR UPDATE visible in logic
- [ ] No ON CONFLICT pattern

### Step 4: Schema Cache Invalidation
```bash
# Wait 30 seconds for Supabase to invalidate schema cache
# OR manually trigger reload
psql -U postgres -d curtain_saas -c "NOTIFY pgrst, 'reload schema';"

# Check that pgrst worker has reloaded
# (may see temporary 503 errors in app - normal, cache invalidating)
```

- [ ] Waited 30-60 seconds
- [ ] App briefly unavailable during cache reload (expected)
- [ ] App comes back online
- [ ] No error logs in Supabase console

---

## Smoke Testing Phase

### Test 1: Rate Limit Function Works Directly
```bash
# As authenticated user, call function directly:
psql -U postgres -d curtain_saas -c "SELECT public.check_rate_limit('smoke_test_1', 1, 3);"

# Expected: true (first call always allowed)
```

- [ ] Returns: `true`
- [ ] No errors thrown
- [ ] New entry created in rate_limits table

### Test 2: Montaj Tamamlandı Button Works
- [ ] Open OrderDetail page (app)
- [ ] Navigate to a job with assigned installer
- [ ] Click "Montaj Tamamlandı" button
- [ ] Expected: No error, modal shown for confirmation
- [ ] Complete confirmation
- [ ] Expected: Job status changes to "completed"
- [ ] Expected: No error toast or notification

### Test 3: Automatic Earnings Created
- [ ] After clicking "Montaj Tamamlandı"
- [ ] Navigate to InstallerLedger page
- [ ] Expected: New earning entry visible
- [ ] Check amount is correct (based on installation commission)
- [ ] Check cari bakiye updated

### Test 4: Database State Verification
```bash
# Check that update_installation_completion succeeded
psql -U postgres -d curtain_saas -c "
SELECT COUNT(*) as completed_count 
FROM public.installation_jobs 
WHERE status = 'completed' AND updated_at > NOW() - INTERVAL '5 minutes'
;"

# Should show recent completed jobs
```

- [ ] New completed jobs appear
- [ ] Timestamp is recent (within 5 minutes)
- [ ] No NULL values in critical columns

### Test 5: No Rate Limit Errors in Logs
```bash
# Check Supabase logs for rate limit errors
# In Supabase console: Menu > Logs > SQL Editor
# Search for: "rate limit" OR "ON CONFLICT" OR "no unique or exclusion"

# Expected: No results (errors resolved)
```

- [ ] No error logs containing "rate limit exceeded"
- [ ] No error logs containing "no unique or exclusion constraint"
- [ ] Logs clean (only normal operations)

---

## Full Test Suite Phase (Optional but Recommended)

### Run Comprehensive Test Scenarios
```bash
# After smoke tests pass, run full suite
psql -U postgres -d curtain_saas < supabase_check_rate_limit_test_scenarios.sql
```

**Test Results Expected**:
- [ ] TEST-1: result = true ✓
- [ ] TEST-2: result = false ✓
- [ ] TEST-3: result = true ✓ (after 4-second wait)
- [ ] TEST-4a-d: Endpoints independent ✓
- [ ] TEST-5a-d: Higher limit works ✓
- [ ] TEST-6: update_installation_completion works ✓

**If Any Test Fails**:
- [ ] Identify which test failed
- [ ] Check error message
- [ ] Consult troubleshooting section in test_scenarios.sql
- [ ] Do NOT mark deployment complete until resolved

---

## Post-Deployment Monitoring

### Immediate (First Hour)
- [ ] Monitor app logs for errors
  - [ ] No "rate limit" errors
  - [ ] No "ON CONFLICT" errors
  - [ ] No "schema cache" errors
- [ ] Check database connections (should be normal)
- [ ] Verify montaj tamamlama RPC calls succeed
  - [ ] Open browser DevTools > Network
  - [ ] Click "Montaj Tamamlandı"
  - [ ] Inspect update_installation_completion RPC response
  - [ ] Expected: success = true

### Short Term (First 24 Hours)
- [ ] Monitor rate_limits table growth
  ```bash
  # Check active rate limit entries
  psql -U postgres -d curtain_saas -c "
  SELECT endpoint, COUNT(*) as active_entries
  FROM public.rate_limits
  WHERE reset_at > NOW()
  GROUP BY endpoint
  ORDER BY active_entries DESC
  LIMIT 10
  ;"
  ```
  - [ ] Entries increment as users call endpoints
  - [ ] Expired entries cleaned up (or accumulate slightly)

- [ ] Monitor montaj tamamlama completion rate
  - [ ] Check dashboard: number of completed jobs
  - [ ] Should show same as before hotfix
  - [ ] No spike in errors

- [ ] Watch user reports (Slack, email, support)
  - [ ] No new complaints about montaj tamamlama
  - [ ] No "rate limit" error reports
  - [ ] No data inconsistency reports

### Medium Term (24-72 Hours)
- [ ] Verify earnings accuracy
  - [ ] Spot-check installer ledger entries
  - [ ] Compare amounts with commission calculation
  - [ ] No duplicates (UNIQUE constraint prevents it)

- [ ] Check rate_limits table size
  ```bash
  psql -U postgres -d curtain_saas -c "
  SELECT 
    pg_size_pretty(pg_total_relation_size('public.rate_limits')) as table_size,
    COUNT(*) as row_count
  FROM public.rate_limits
  ;"
  ```
  - [ ] Table not growing exponentially
  - [ ] Cleanup function working (expired entries gone)

- [ ] Confirm no regressions in other RPC endpoints
  - [ ] Check other rate-limited operations
  - [ ] record_order_payment: works
  - [ ] record_installer_payment: works
  - [ ] record_invoice_save: works

---

## Rollback Decision Point

**Rollback immediately if**:
- [ ] Montaj tamamlama still fails with rate limit error
- [ ] New errors appear (different error, not rate limit)
- [ ] Database performance degraded
- [ ] Schema cache not invalidating (persistent 503 errors)
- [ ] User data corrupted or inconsistent

**Do NOT rollback if**:
- ✓ Montaj tamamlama works (hotfix successful)
- ✓ Earnings created automatically (feature works)
- ✓ Logs clean (no errors)
- ✓ Performance normal (no slowdown)

**If Uncertain**:
- Check logs more carefully (search for specific errors)
- Run test scenarios again (verify correct behavior)
- Contact team lead before rolling back (gather more data)

---

## Rollback Procedure (Emergency)

### If Rollback Needed
```bash
# Step 1: Restore original function
psql -U postgres -d curtain_saas < check_rate_limit_backup.sql

# OR manually:
psql -U postgres -d curtain_saas << 'EOF'
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
EOF

# Step 2: Invalidate cache
sleep 30

# Step 3: Verify rollback
psql -U postgres -d curtain_saas -c "SELECT pg_get_functiondef('public.check_rate_limit(text, integer, integer)');" | grep "ON CONFLICT"

# Expected: Shows ON CONFLICT (original code restored)
```

- [ ] Original function restored
- [ ] Cache invalidated (waited 30+ seconds)
- [ ] Verified with grep output
- [ ] App tested (montaj tamamlama may fail again, but known state)
- [ ] Team notified of rollback

---

## Sign-Off

**Deployment Completed By**: _______________  
**Date**: _______________  
**Time**: _______________  
**Status**: ✅ SUCCESS / ❌ ROLLBACK / ⚠️ PARTIAL

**Notes**:
```
[Add any issues, observations, or anomalies found during deployment]
```

**Follow-Up Tasks**:
- [ ] Update CHANGELOG.md with hotfix details
- [ ] Archive hotfix files (supabase_fix_check_rate_limit.sql)
- [ ] Document lessons learned
- [ ] Plan permanent fix for rate limiting (e.g., advisory locks, MERGE syntax)

---

## Appendix: Common Issues & Solutions

### Issue: "relation "public.rate_limits" does not exist"
**Cause**: Pre-check didn't run or failed  
**Solution**: 
1. Run CHECK-1 to verify table exists
2. If table doesn't exist, create it (not part of this hotfix)
3. Re-run hotfix

### Issue: "function check_rate_limit(...) is not unique"
**Cause**: Duplicate functions defined  
**Solution**: 
1. List all check_rate_limit functions: `SELECT * FROM pg_proc WHERE proname='check_rate_limit';`
2. DROP extra copies (keep public.check_rate_limit(text, int, int))
3. Re-run hotfix

### Issue: "User not authenticated for rate limit check"
**Cause**: auth.uid() returns NULL (user not logged in)  
**Solution**: 
1. This is expected for unauthenticated calls
2. Montaj tamamlama RPC always has authenticated context
3. If happening in RPC, check auth middleware

### Issue: Montaj tamamlama still fails after hotfix
**Cause**: Hotfix not deployed OR schema cache not invalidated  
**Solution**: 
1. Verify function was updated: `SELECT pg_get_functiondef(...)`
2. Wait additional 60 seconds (cache expiry)
3. Restart app (force schema reload)
4. If still broken, check other errors (not rate limit)

---

**Prepared**: 2026-07-12  
**Target Deployment**: TBD (when authorized by team lead)  
**Status**: ✅ READY FOR DEPLOYMENT
