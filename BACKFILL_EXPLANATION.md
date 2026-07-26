# Backfill Strategy: Retroactive Earnings Creation

**Status:** Design (Not Implemented)  
**Date:** 2026-07-11  
**Affected Records:** 14 completed installation_jobs with zero earnings

---

## 1. PROBLEM STATEMENT

### Current State
- 14 installation_jobs with `status IN ('completed', 'installation_completed')`
- All marked as completed (updated_at shows actual completion time)
- All have `assigned_staff_id` (installer is known)
- **ZERO** earnings records exist for these jobs
- **ZERO** transaction records exist for these jobs

### Root Cause
- Trigger `on_installation_job_completed()` doesn't exist in production
- `update_installation_completion()` function only updated status, didn't create earnings
- These jobs were completed before the fix, so no earnings were auto-created

### Impact
- Installers not credited for completed work
- Accounting records incomplete
- Hakediş (earnings) ledger missing 14 entries
- Installer cari summary shows incorrect balance

---

## 2. WHY BACKFILL IS SEPARATE (Not Part of Main Migration)

### Reason 1: Risk Isolation
**Main Migration Risk:** Update function logic
- If function change fails → Easy rollback (restore original function)
- If function works but has bugs → Easy fix (update function again)
- Impact: Only affects NEW completions going forward

**Backfill Risk:** Create 14 historical records
- If backfill fails → 14 partial historical records
- If backfill has bugs → 14 wrong earnings entered
- Impact: Historical data corruption
- Recovery: Manual deletion and re-backfill

**Better:** Do main migration first, verify it works on new completions, THEN backfill

### Reason 2: Validation Window
**Sequence:**
1. Deploy main migration → Test on new jobs for 24-48 hours
2. Verify new completions creating earnings correctly
3. Monitor: No errors, no duplicates, calculations correct
4. THEN: Run backfill (now confident the logic is sound)

This prevents scenarios like:
- Deploy backfill → Realizes calculation formula is wrong → Rollback
- Now have to DELETE backfilled earnings, fix migration, RE-backfill

### Reason 3: Data Audit Trail
**Backfill Properties:**
- 14 earnings all created at same time (timestamp clusters)
- Created by system/migration (not by user action)
- May need special flag: `metadata.backfilled = true`
- May need special flag: `metadata.backfill_date = 2026-07-11`

**Front vs Main:**
- New completions: Created by user action (via UI), timestamp = when user completed
- Backfilled: Created by migration, timestamp = migration run time

Better to keep them separate for audit clarity.

### Reason 4: Approval & Verification
**Main Migration:** Technical change
- Review for SQL correctness, security
- Deploy to production

**Backfill:** Data change
- Review WHICH 14 jobs will be backfilled
- Verify calculations are correct BEFORE inserting
- Get accounting team approval
- Run read-only verification queries BEFORE backfill
- Document which 14 jobs got earnings

### Reason 5: Partial Success Handling
**Main Migration:** All-or-nothing
- SQL transaction ensures atomicity
- Either fully deployed or fully rolled back

**Backfill:** Could fail for some jobs
- Job A: Backfill succeeds
- Job B: Backfill fails (corrupt order_items data)
- Job C: Backfill succeeds

With separate backfill:
- Can identify which jobs failed
- Can fix the failure (repair order_items, etc.)
- Can re-run backfill just for failed jobs

If backfill was part of main migration:
- Migration would fail completely
- All-or-nothing rollback
- Would have to troubleshoot in production

---

## 3. BACKFILL STRATEGY

### Phase 1: Pre-Backfill Verification (1-2 days before backfill)

#### Step 1a: Identify Jobs to Backfill
```sql
SELECT
  ij.id as job_id,
  ij.company_id,
  ij.order_id,
  ij.assigned_staff_id,
  ij.status,
  ij.updated_at,
  e.commission_type,
  e.commission_quantity_rate,
  e.commission_area_rate
FROM public.installation_jobs ij
LEFT JOIN public.employees e ON ij.assigned_staff_id = e.id
WHERE ij.status IN ('completed', 'installation_completed')
  AND NOT EXISTS (
    SELECT 1 FROM public.installer_earnings
    WHERE installation_job_id = ij.id
  )
ORDER BY ij.updated_at DESC;
```

**Expected:** Exactly 14 records

#### Step 1b: Calculate Expected Earnings (Dry-Run)
```sql
SELECT
  ij.id as job_id,
  e.commission_type,
  result.quantity_earning,
  result.area_earning,
  result.manual_earning,
  result.total_earning
FROM public.installation_jobs ij
LEFT JOIN public.employees e ON ij.assigned_staff_id = e.id
LEFT JOIN LATERAL public.calculate_commission_for_job(
  ij.id,
  ij.assigned_staff_id,
  ij.company_id
) result ON true
WHERE ij.status IN ('completed', 'installation_completed')
  AND NOT EXISTS (
    SELECT 1 FROM public.installer_earnings
    WHERE installation_job_id = ij.id
  )
ORDER BY ij.updated_at DESC;
```

**Output:** Save results to CSV for review
**Action:** Have accounting team verify calculations are reasonable

#### Step 1c: Check for Data Quality Issues
```sql
-- Check for jobs with no order items
SELECT ij.id, ij.order_id
FROM public.installation_jobs ij
WHERE ij.status IN ('completed', 'installation_completed')
  AND NOT EXISTS (
    SELECT 1 FROM public.installer_earnings
    WHERE installation_job_id = ij.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.order_items
    WHERE order_id = ij.order_id
  );

-- Check for manual commission type (will result in 0 earning)
SELECT ij.id, e.commission_type
FROM public.installation_jobs ij
LEFT JOIN public.employees e ON ij.assigned_staff_id = e.id
WHERE ij.status IN ('completed', 'installation_completed')
  AND NOT EXISTS (
    SELECT 1 FROM public.installer_earnings
    WHERE installation_job_id = ij.id
  )
  AND e.commission_type = 'manual';

-- Check for jobs with no installer assigned (should be 0)
SELECT COUNT(*)
FROM public.installation_jobs ij
WHERE ij.status IN ('completed', 'installation_completed')
  AND NOT EXISTS (
    SELECT 1 FROM public.installer_earnings
    WHERE installation_job_id = ij.id
  )
  AND ij.assigned_staff_id IS NULL;
```

### Phase 2: Backfill Execution (Create Separate Migration)

#### File: `supabase_backfill_14_completed_jobs_earnings.sql`

```sql
-- ============================================================================
-- BACKFILL MIGRATION: Create earnings for 14 completed jobs
-- DATE: 2026-07-11 (to be deployed 3-5 days after main migration)
-- PREREQUISITE: supabase_fix_update_installation_completion_earnings.sql
-- ============================================================================

BEGIN TRANSACTION;

-- 1. Create earnings and transactions for all 14 jobs
WITH jobs_to_backfill AS (
    SELECT
        ij.id as job_id,
        ij.company_id,
        ij.order_id,
        ij.assigned_staff_id,
        ij.updated_at
    FROM public.installation_jobs ij
    WHERE ij.status IN ('completed', 'installation_completed')
      AND NOT EXISTS (
        SELECT 1 FROM public.installer_earnings
        WHERE installation_job_id = ij.id
      )
),
calculated_earnings AS (
    SELECT
        j.job_id,
        j.company_id,
        j.order_id,
        j.assigned_staff_id,
        j.updated_at,
        r.quantity_earning,
        r.area_earning,
        r.manual_earning,
        r.total_earning,
        r.calculation_details
    FROM jobs_to_backfill j
    LEFT JOIN LATERAL public.calculate_commission_for_job(
        j.job_id,
        j.assigned_staff_id,
        j.company_id
    ) r ON true
)
INSERT INTO public.installer_earnings (
    company_id,
    installer_id,
    installation_job_id,
    order_id,
    job_completed_date,
    earning_type,
    quantity,
    area_m2,
    quantity_rate,
    area_rate,
    quantity_earning,
    area_earning,
    manual_earning,
    total_earning,
    metadata
)
SELECT
    ce.company_id,
    ce.assigned_staff_id,
    ce.job_id,
    ce.order_id,
    ce.updated_at,  -- Use original completion timestamp
    ce.calculation_details->>'type',
    (ce.calculation_details->>'quantity')::numeric,
    (ce.calculation_details->>'area_m2')::numeric,
    (ce.calculation_details->>'quantity_rate')::numeric,
    (ce.calculation_details->>'area_rate')::numeric,
    ce.quantity_earning,
    ce.area_earning,
    ce.manual_earning,
    ce.total_earning,
    jsonb_set(
        ce.calculation_details,
        '{backfilled}',
        'true'::jsonb
    ) || jsonb_build_object('backfill_date', now()::text)
FROM calculated_earnings ce
ON CONFLICT (company_id, installation_job_id) DO NOTHING
RETURNING id, installation_job_id;

-- 2. Create corresponding transactions
WITH earnings_just_created AS (
    SELECT ie.id as earning_id, ie.installation_job_id, ie.total_earning, ie.company_id, ie.installer_id
    FROM public.installer_earnings ie
    WHERE ie.metadata->>'backfilled' = 'true'
      AND ie.job_completed_date > now() - interval '1 hour'  -- Just created
)
INSERT INTO public.installer_transactions (
    company_id,
    installer_id,
    transaction_date,
    transaction_type,
    amount,
    description,
    related_job_id,
    earning_id,
    earning_type
)
SELECT
    ej.company_id,
    ej.installer_id,
    now(),
    'earning',
    ej.total_earning,
    'Montaj tamamlandı - Geçmiş hakediş (backfill)',
    ej.installation_job_id,
    ej.earning_id,
    'backfill'
FROM earnings_just_created ej;

COMMIT;

NOTIFY pgrst, 'reload schema';
```

### Phase 3: Post-Backfill Verification

#### Verification Query 1: Count Backfilled Earnings
```sql
SELECT COUNT(*) as backfilled_count
FROM public.installer_earnings
WHERE metadata->>'backfilled' = 'true';
-- Expected: 14
```

#### Verification Query 2: Compare with Original Jobs
```sql
SELECT
  COUNT(DISTINCT ij.id) as total_jobs_that_were_completed,
  COUNT(DISTINCT ie.id) as earnings_now_created
FROM public.installation_jobs ij
LEFT JOIN public.installer_earnings ie ON ij.id = ie.installation_job_id
WHERE ij.status IN ('completed', 'installation_completed')
  AND NOT EXISTS (
    SELECT 1 FROM public.installation_jobs ij2
    WHERE ij2.status IN ('completed', 'installation_completed')
      AND ij2.updated_at > now() - interval '1 day'  -- Recent completions (not backfilled)
  );
-- Expected: Both counts = 14 (all backfilled jobs now have earnings)
```

#### Verification Query 3: Total Earnings Created
```sql
SELECT
  COUNT(*) as total_earnings_records,
  SUM(total_earning) as total_amount_backfilled,
  AVG(total_earning) as avg_earning,
  MAX(total_earning) as max_earning,
  MIN(total_earning) as min_earning
FROM public.installer_earnings
WHERE metadata->>'backfilled' = 'true';
```

#### Verification Query 4: Installer Cari Updated
```sql
SELECT
  i.id,
  i.name,
  (SELECT public.get_installer_cari_summary(i.id, ic.company_id)).*
FROM public.employees i
JOIN public.company_members cm ON i.company_id = cm.company_id
LEFT JOIN public.installer_earnings ie ON i.id = ie.installer_id
LEFT JOIN (SELECT DISTINCT company_id FROM public.installer_earnings WHERE metadata->>'backfilled' = 'true') ic ON i.company_id = ic.company_id
WHERE ie.metadata->>'backfilled' = 'true';
-- Should show updated balance including backfilled earnings
```

---

## 4. RISK MITIGATION

### Risk 1: Wrong Calculation Formula
**Mitigation:**
- Run dry-run (Step 1b) before backfill
- Compare calculated totals with order values
- Have accounting verify before proceeding

### Risk 2: Double-Creation (Backfill + Manual Entry)
**Mitigation:**
- UNIQUE constraint on (company_id, installation_job_id) prevents this
- ON CONFLICT ... DO NOTHING in backfill INSERT
- If someone manually created earning between pre-check and backfill, backfill skips it

### Risk 3: Manual Commission Type = 0
**Mitigation:**
- Acceptable (manual requires admin entry anyway)
- Clearly documented
- Accounting can manually update if needed

### Risk 4: Data Quality Issues (Missing Order Items)
**Mitigation:**
- Step 1c checks for this
- If found, repair order_items BEFORE backfill
- Or exclude those jobs from backfill (manual handling)

### Risk 5: Backfill Fails Mid-Way
**Mitigation:**
- Transaction: All or nothing
- If fails, rollback completely
- Retry after fixing issue
- Check logs for error message

---

## 5. ROLLBACK PROCEDURE

### If Backfill Needs to be Reversed

```sql
BEGIN TRANSACTION;

-- 1. Delete backfilled transactions
DELETE FROM public.installer_transactions
WHERE earning_id IN (
    SELECT id FROM public.installer_earnings
    WHERE metadata->>'backfilled' = 'true'
);

-- 2. Delete backfilled earnings
DELETE FROM public.installer_earnings
WHERE metadata->>'backfilled' = 'true';

COMMIT;

-- Verify
SELECT COUNT(*) FROM public.installer_earnings
WHERE metadata->>'backfilled' = 'true';
-- Expected: 0
```

---

## 6. TIMELINE

```
T+0 Days: Deploy main migration (supabase_fix_update_installation_completion_earnings.sql)
T+1 Days: Monitor new completions, verify no issues
T+3 Days: Run pre-backfill verification queries
T+4 Days: Get accounting team approval
T+5 Days: Deploy backfill migration (supabase_backfill_14_completed_jobs_earnings.sql)
T+6 Days: Run post-backfill verification
T+7 Days: Close PO / Mark issue complete
```

---

## 7. SUCCESS CRITERIA

### Main Migration Success ✅
- New job completions create earnings ✓
- Calculations are correct ✓
- No duplicate errors ✓
- Authorization working ✓

### Backfill Success ✅
- 14 jobs now have earnings ✓
- Calculations match pre-backfill review ✓
- All 14 installer_transactions created ✓
- No partial state ✓
- Installers can see earnings in cari ✓

---

## 8. DOCUMENTATION FOR TEAM

### What Happened
"14 completed jobs between [date] and [date] were not credited with earnings due to missing trigger in production database."

### What We're Doing
"Creating two separate migrations: (1) Fix the completion function (2) Backfill 14 historical earnings"

### Why Two Migrations
"Risk isolation. If function fix has bugs, only affects new jobs. If backfill has issues, we can rollback without affecting function."

### Timeline
"Main migration deployed [date]. Backfill will run [date] after verification."

### No User Action Needed
"System automatically creates earnings. Users will see new entries in Accounting module."

---

