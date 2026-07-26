# Test Scenarios: Installation Completion with Earnings

**Status:** Design (Not Executed Yet)  
**Date:** 2026-07-11  
**Environment:** Must test in non-production database first

---

## 1. PRE-DEPLOYMENT TEST (Local/Staging)

### 1.1 Test Data Setup

```sql
-- Create test company
INSERT INTO public.companies (id, name, is_active)
VALUES ('test-company-123'::uuid, 'Test Company', true);

-- Create test users
INSERT INTO public.profiles (user_id, email, role, company_id)
VALUES 
  ('admin-user'::uuid, 'admin@test.com', 'admin', 'test-company-123'::uuid),
  ('installer-user'::uuid, 'installer@test.com', 'installer', 'test-company-123'::uuid),
  ('accountant-user'::uuid, 'accountant@test.com', 'accountant', 'test-company-123'::uuid);

-- Create test employees (installers)
INSERT INTO public.employees (id, company_id, user_id, commission_type, commission_quantity_rate, commission_area_rate)
VALUES 
  ('installer-emp-1'::uuid, 'test-company-123'::uuid, 'installer-user'::uuid, 'quantity', 50, 80),
  ('installer-emp-2'::uuid, 'test-company-123'::uuid, 'installer-user'::uuid, 'area', 50, 100),
  ('installer-emp-3'::uuid, 'test-company-123'::uuid, 'installer-user'::uuid, 'hybrid', 40, 90),
  ('installer-emp-4'::uuid, 'test-company-123'::uuid, 'installer-user'::uuid, 'manual', 50, 80);

-- Create test customer and order
INSERT INTO public.customers (id, company_id, name)
VALUES ('customer-123'::uuid, 'test-company-123'::uuid, 'Test Customer');

INSERT INTO public.orders (id, company_id, customer_id, total_amount, status)
VALUES 
  ('order-qty'::uuid, 'test-company-123'::uuid, 'customer-123'::uuid, 5000, 'siparis_olusturuldu'),
  ('order-area'::uuid, 'test-company-123'::uuid, 'customer-123'::uuid, 8000, 'siparis_olusturuldu'),
  ('order-hybrid'::uuid, 'test-company-123'::uuid, 'customer-123'::uuid, 10000, 'siparis_olusturuldu'),
  ('order-manual'::uuid, 'test-company-123'::uuid, 'customer-123'::uuid, 3000, 'siparis_olusturuldu');

-- Create order items
INSERT INTO public.order_items (id, order_id, qty, area_m2)
VALUES
  ('item-qty'::uuid, 'order-qty'::uuid, 10, 5),      -- 10 adet, 5 m²
  ('item-area'::uuid, 'order-area'::uuid, 3, 20),    -- 3 adet, 20 m²
  ('item-hybrid'::uuid, 'order-hybrid'::uuid, 8, 15), -- 8 adet, 15 m²
  ('item-manual'::uuid, 'order-manual'::uuid, 5, 10);  -- 5 adet, 10 m²

-- Create installation jobs
INSERT INTO public.installation_jobs (id, company_id, order_id, assigned_staff_id, status)
VALUES
  ('job-qty'::uuid, 'test-company-123'::uuid, 'order-qty'::uuid, 'installer-emp-1'::uuid, 'onway'),
  ('job-area'::uuid, 'test-company-123'::uuid, 'order-area'::uuid, 'installer-emp-2'::uuid, 'onway'),
  ('job-hybrid'::uuid, 'test-company-123'::uuid, 'order-hybrid'::uuid, 'installer-emp-3'::uuid, 'onway'),
  ('job-manual'::uuid, 'test-company-123'::uuid, 'order-manual'::uuid, 'installer-emp-4'::uuid, 'onway'),
  ('job-no-installer'::uuid, 'test-company-123'::uuid, 'order-qty'::uuid, NULL, 'onway');
```

---

## 2. UNIT TEST CASES

### Test 2.1: Quantity-Based Commission

**Scenario:** Complete job with quantity-based commission type

```
Installer: commission_type = 'quantity', rate = 50 TL per unit
Order items: qty = 10
Expected earning: 10 × 50 = 500 TL
```

**Test Steps:**
```sql
SELECT public.update_installation_completion(
    'test-company-123'::uuid,
    'job-qty'::uuid,
    'installation_completed',
    'order-qty'::uuid,
    'montaj_tamamlandi'
);
```

**Expected Response:**
```json
{
  "success": true,
  "job_id": "job-qty",
  "new_status": "installation_completed",
  "earning_id": "<uuid>",
  "transaction_id": "<uuid>",
  "total_earning": 500,
  "updated_at": "<timestamp>"
}
```

**Verification Queries:**
```sql
-- 1. Check installation_jobs status updated
SELECT status, completion_timestamp FROM public.installation_jobs 
WHERE id = 'job-qty'::uuid;
-- Expected: status = 'installation_completed', completion_timestamp = now()

-- 2. Check installer_earnings record created
SELECT * FROM public.installer_earnings 
WHERE installation_job_id = 'job-qty'::uuid;
-- Expected: 1 record with total_earning = 500

-- 3. Check installer_transactions record created
SELECT * FROM public.installer_transactions 
WHERE related_job_id = 'job-qty'::uuid AND transaction_type = 'earning';
-- Expected: 1 record with amount = 500, type = 'earning'
```

---

### Test 2.2: Area-Based Commission

**Scenario:** Complete job with area-based commission type

```
Installer: commission_type = 'area', rate = 100 TL per m²
Order items: area_m2 = 20
Expected earning: 20 × 100 = 2000 TL
```

**Expected Response:**
```json
{
  "success": true,
  "total_earning": 2000
}
```

---

### Test 2.3: Hybrid Commission (Quantity + Area)

**Scenario:** Complete job with hybrid commission type

```
Installer: commission_type = 'hybrid', qty_rate = 40, area_rate = 90
Order items: qty = 8, area_m2 = 15
Expected earning: (8 × 40) + (15 × 90) = 320 + 1350 = 1670 TL
```

**Expected Response:**
```json
{
  "success": true,
  "total_earning": 1670
}
```

---

### Test 2.4: Manual Commission

**Scenario:** Complete job with manual commission type

```
Installer: commission_type = 'manual'
Expected earning: 0 TL (requires manual entry)
```

**Expected Response:**
```json
{
  "success": true,
  "total_earning": 0,
  "note": "Manual entry required"
}
```

**Verification:**
```sql
SELECT * FROM public.installer_earnings 
WHERE installation_job_id = 'job-manual'::uuid;
-- Expected: Record exists with total_earning = 0, earning_type = 'manual'
```

---

### Test 2.5: Missing Installer Assignment

**Scenario:** Try to complete job with no installer assigned

**Test:**
```sql
SELECT public.update_installation_completion(
    'test-company-123'::uuid,
    'job-no-installer'::uuid,
    'installation_completed',
    'order-qty'::uuid,
    'montaj_tamamlandi'
);
```

**Expected Response:**
```json
{
  "success": false,
  "error": "Installer not assigned to this job. Cannot mark as completed.",
  "required_field": "assigned_staff_id"
}
```

**Verification:**
```sql
-- No earnings should be created
SELECT COUNT(*) FROM public.installer_earnings 
WHERE installation_job_id = 'job-no-installer'::uuid;
-- Expected: 0

-- Job status should NOT change
SELECT status FROM public.installation_jobs 
WHERE id = 'job-no-installer'::uuid;
-- Expected: 'onway' (unchanged)
```

---

### Test 2.6: Double Completion Prevention

**Scenario:** Try to complete same job twice

**Test Step 1:**
```sql
SELECT public.update_installation_completion(
    'test-company-123'::uuid,
    'job-qty'::uuid,
    'installation_completed',
    'order-qty'::uuid,
    'montaj_tamamlandi'
);
```
**Result:** Success (first completion)

**Test Step 2:**
```sql
SELECT public.update_installation_completion(
    'test-company-123'::uuid,
    'job-qty'::uuid,
    'installation_completed',
    'order-qty'::uuid,
    'montaj_tamamlandi'
);
```

**Expected Response (second call):**
```json
{
  "success": false,
  "error": "Earnings already created for this job",
  "note": "Double-creation prevented by database constraint"
}
```

**Verification:**
```sql
-- Only 1 earnings record should exist (not 2)
SELECT COUNT(*) FROM public.installer_earnings 
WHERE installation_job_id = 'job-qty'::uuid;
-- Expected: 1 (UNIQUE constraint prevents duplicates)

-- Only 1 transaction should exist (not 2)
SELECT COUNT(*) FROM public.installer_transactions 
WHERE related_job_id = 'job-qty'::uuid AND transaction_type = 'earning';
-- Expected: 1
```

---

### Test 2.7: Authorization - Super Admin

**Scenario:** Super admin completes job

**Setup:**
```sql
-- Assume calling as super_admin user
```

**Expected:** Success ✅

---

### Test 2.8: Authorization - Company Admin

**Scenario:** Company admin completes own company's job

**Expected:** Success ✅

---

### Test 2.9: Authorization - Company Accountant

**Scenario:** Company accountant completes own company's job

**Expected:** Success ✅

---

### Test 2.10: Authorization - Denied (Normal Installer)

**Scenario:** Try to complete job as regular installer (not admin/accountant)

**Expected Response:**
```json
{
  "success": false,
  "error": "Not authorized. Only owner/admin/accountant can complete installations.",
  "required_role": "admin|accountant"
}
```

---

### Test 2.11: Authorization - Denied (Other Company)

**Scenario:** Admin from Company A tries to complete Company B's job

**Test:**
```sql
-- Set auth context to Company B's admin
SELECT public.update_installation_completion(
    'test-company-B'::uuid,  -- Different company
    'job-qty'::uuid,          -- Job from Company A
    'installation_completed',
    'order-qty'::uuid,
    'montaj_tamamlandi'
);
```

**Expected Response:**
```json
{
  "success": false,
  "error": "Job not found"
  // (No earnings created, no access to foreign company's data)
}
```

---

### Test 2.12: Invalid Status Value

**Scenario:** Pass invalid status string

**Test:**
```sql
SELECT public.update_installation_completion(
    'test-company-123'::uuid,
    'job-qty'::uuid,
    'invalid_status_value',
    'order-qty'::uuid,
    'montaj_tamamlandi'
);
```

**Expected Response:**
```json
{
  "success": false,
  "error": "Invalid status value",
  "provided_status": "invalid_status_value",
  "allowed_values": ["waiting", "planned", "assigned", "onway", "completed", "installation_completed"]
}
```

---

### Test 2.13: Rate Limiting

**Scenario:** Call completion twice within 3 seconds

**Test Step 1:**
```sql
SELECT public.update_installation_completion(...);
```
**Result:** Success

**Test Step 2 (within 3 seconds):**
```sql
SELECT public.update_installation_completion(..., 'job-area'::uuid, ...);
```

**Expected Response:**
```json
{
  "success": false,
  "error": "Rate limit exceeded. Please wait 3 seconds before updating another installation."
}
```

---

### Test 2.14: Non-Existent Job

**Scenario:** Try to complete job that doesn't exist

**Test:**
```sql
SELECT public.update_installation_completion(
    'test-company-123'::uuid,
    'nonexistent-job'::uuid,
    'installation_completed',
    'order-qty'::uuid,
    'montaj_tamamlandi'
);
```

**Expected Response:**
```json
{
  "success": false,
  "error": "Installation job not found"
}
```

---

### Test 2.15: Transaction Atomicity

**Scenario:** Simulate write failure (e.g., FK constraint violation)

**Setup:**
```sql
-- Manually delete the related order to cause FK violation on insert
DELETE FROM public.orders WHERE id = 'order-qty'::uuid;
```

**Test:**
```sql
SELECT public.update_installation_completion(
    'test-company-123'::uuid,
    'job-qty'::uuid,
    'installation_completed',
    'order-qty'::uuid,
    'montaj_tamamlandi'
);
```

**Expected:**
- Response shows error
- installation_jobs.status NOT changed (rollback via savepoint)
- No earnings record created
- No transaction record created
- Zero partial state persists

**Verification:**
```sql
SELECT status FROM public.installation_jobs WHERE id = 'job-qty'::uuid;
-- Expected: 'onway' (unchanged - rolled back)

SELECT COUNT(*) FROM public.installer_earnings 
WHERE installation_job_id = 'job-qty'::uuid;
-- Expected: 0 (rolled back)
```

---

## 3. INTEGRATION TEST CASES

### Test 3.1: End-to-End Workflow

```
1. Create order with items
2. Create installation job (unassigned)
3. Assign installer
4. Complete installation
5. Verify earnings created
6. Check accounting module shows new earning
```

---

### Test 3.2: Multiple Jobs, Same Installer

```
1. Create 3 orders
2. Assign same installer to all 3
3. Complete all 3 jobs (different times)
4. Verify installer_cari_summary shows total earnings
```

---

## 4. PERFORMANCE TESTS

### Test 4.1: Bulk Completion Response Time

**Scenario:** Complete 100 jobs sequentially

```
Expected: < 2 seconds per completion
Total: < 200 seconds for 100
```

---

### Test 4.2: Concurrent Completion Attempts

**Scenario:** Two users try to complete same job simultaneously

```
Expected: One succeeds, one fails with "Earnings already created"
(Row-level lock prevents both from succeeding)
```

---

## 5. EDGE CASES

### Test 5.1: Order without Order Items

**Scenario:** Complete job for order with no items

```
Expected: earnings with 0 qty and 0 area, total = 0
```

---

### Test 5.2: Null Commission Rates

**Scenario:** Installer has NULL commission_quantity_rate

```
Expected: Uses COALESCE defaults (50 for quantity, 80 for area)
```

---

### Test 5.3: Zero Quantity Items

**Scenario:** Order items have qty = 0

```
Expected: total_earning = 0
```

---

## 6. MONITORING QUERIES

Run these after deploying to production:

### 6.1 Verify All Completions Have Earnings

```sql
SELECT
  COUNT(DISTINCT ij.id) as total_completed_jobs,
  COUNT(DISTINCT ie.id) as jobs_with_earnings,
  COUNT(DISTINCT ij.id) - COUNT(DISTINCT ie.id) as missing_earnings
FROM public.installation_jobs ij
LEFT JOIN public.installer_earnings ie ON ij.id = ie.installation_job_id
WHERE ij.status IN ('completed', 'installation_completed')
  AND ij.updated_at > now() - interval '1 hour';
-- Expected: missing_earnings = 0
```

### 6.2 Error Rate

```sql
SELECT
  COUNT(*) as completion_attempts,
  SUM(CASE WHEN success THEN 1 ELSE 0 END) as successes,
  SUM(CASE WHEN NOT success THEN 1 ELSE 0 END) as failures,
  ROUND(100.0 * SUM(CASE WHEN success THEN 1 ELSE 0 END) / COUNT(*), 2) as success_rate
FROM function_call_logs
WHERE function_name = 'update_installation_completion'
  AND created_at > now() - interval '24 hours';
-- Expected: success_rate > 99%
```

### 6.3 Earnings Distribution

```sql
SELECT
  earning_type,
  COUNT(*) as count,
  AVG(total_earning) as avg_earning,
  MAX(total_earning) as max_earning,
  MIN(total_earning) as min_earning
FROM public.installer_earnings
WHERE created_at > now() - interval '24 hours'
GROUP BY earning_type
ORDER BY count DESC;
```

---

## 7. ROLLBACK SAFETY TEST

**Before deploying to production:**

1. Deploy migration to staging
2. Run all tests above
3. Run queries at end of this document
4. Run ROLLBACK_INSTRUCTIONS.sql
5. Verify original function works
6. Redeploy migration
7. Run tests again

---

## 8. DEPLOYMENT CHECKLIST

- [ ] All pre-deployment tests passed
- [ ] No duplicate earnings found in production
- [ ] Authorization checks working (admin/accountant only)
- [ ] Rate limiting not affecting normal use
- [ ] Atomicity verified (no partial updates)
- [ ] All error scenarios tested
- [ ] Rollback procedure tested and documented
- [ ] Monitoring queries written
- [ ] Team trained on new feature
- [ ] Release notes prepared

