# PerdePRO - PRODUCTION-GRADE QA ARCHITECTURE v2.0

**Version:** 2.0  
**Status:** Architecture & Plan (Implementation Pending)  
**Focus:** End-to-End Business Workflows, Not CRUD Operations

---

## 🏛️ TESTING ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────────┐
│                    CI/CD PIPELINE                       │
│  (Every PR + Before Production Release)                 │
└──────────────────┬──────────────────────────────────────┘
                   │
        ┌──────────┼──────────┐
        │          │          │
        ▼          ▼          ▼
   ┌────────┐ ┌────────┐ ┌────────┐
   │ Lint & │ │ Unit   │ │ Type   │
   │ Format │ │ Tests  │ │ Check  │
   └────────┘ └────────┘ └────────┘
        │          │          │
        └──────────┼──────────┘
                   │
        ┌──────────▼──────────┐
        │  E2E Test Suite     │
        │  (PRODUCTION-GRADE) │
        └──────────┬──────────┘
                   │
    ┌──────────────┼──────────────┐
    │              │              │
    ▼              ▼              ▼
┌─────────┐  ┌──────────┐  ┌────────────┐
│ Desktop │  │ Mobile   │  │ Tablet     │
│ Tests   │  │ Tests    │  │ Tests      │
└─────────┘  └──────────┘  └────────────┘
    │              │              │
    └──────────────┼──────────────┘
                   │
        ┌──────────▼──────────┐
        │  Advanced Reporting │
        │  (Screenshots, Logs,│
        │   DB State, Traces) │
        └─────────────────────┘
```

---

## 📊 TEST SUITE ARCHITECTURE

### Core Test Categories

```
E2E_TEST_SUITE/
│
├─ 1_BUSINESS_WORKFLOWS/ (PRIMARY FOCUS)
│  ├─ 1.1_Happy_Path_Flows/
│  │  ├─ complete-order-lifecycle.spec.ts
│  │  ├─ quote-to-cash.spec.ts
│  │  ├─ supplier-payment-cycle.spec.ts
│  │  └─ installer-earnings-cycle.spec.ts
│  │
│  ├─ 1.2_Reverse_Scenarios/
│  │  ├─ order-cancellation.spec.ts
│  │  ├─ payment-adjustments.spec.ts
│  │  └─ installer-payment-adjustments.spec.ts
│  │
│  └─ 1.3_Complex_Workflows/
│     ├─ multi-installer-order.spec.ts
│     ├─ partial-payment-flow.spec.ts
│     └─ order-modification-after-creation.spec.ts
│
├─ 2_DASHBOARD_VALIDATION/ (DB COMPARISON)
│  ├─ 2.1_Financial_Metrics/
│  │  ├─ monthly-income-validation.spec.ts
│  │  ├─ monthly-expenses-validation.spec.ts
│  │  ├─ pending-collections-validation.spec.ts
│  │  └─ cash-flow-validation.spec.ts
│  │
│  ├─ 2.2_Order_Metrics/
│  │  ├─ pending-orders-count.spec.ts
│  │  ├─ completed-orders-count.spec.ts
│  │  ├─ order-value-totals.spec.ts
│  │  └─ order-status-breakdown.spec.ts
│  │
│  └─ 2.3_Ledger_Balances/
│     ├─ supplier-balance-validation.spec.ts
│     ├─ installer-balance-validation.spec.ts
│     └─ customer-receivable-validation.spec.ts
│
├─ 3_MOBILE_RESPONSIVE/
│  ├─ 3.1_Mobile_Devices/
│  │  ├─ iphone-13-workflow.spec.ts
│  │  ├─ iphone-14-workflow.spec.ts
│  │  ├─ android-12-workflow.spec.ts
│  │  └─ android-13-workflow.spec.ts
│  │
│  ├─ 3.2_Tablets/
│  │  ├─ ipad-pro-workflow.spec.ts
│  │  └─ ipad-air-workflow.spec.ts
│  │
│  └─ 3.3_Mobile_Validations/
│     ├─ layout-no-overflow.spec.ts
│     ├─ buttons-accessible.spec.ts
│     ├─ forms-usable.spec.ts
│     └─ modals-responsive.spec.ts
│
├─ 4_EXPORT_FUNCTIONALITY/
│  ├─ 4.1_PDF_Generation/
│  │  ├─ order-pdf-content.spec.ts
│  │  ├─ ledger-pdf-formatting.spec.ts
│  │  ├─ invoice-pdf-totals.spec.ts
│  │  └─ pdf-file-integrity.spec.ts
│  │
│  ├─ 4.2_Excel_Export/
│  │  ├─ order-list-excel.spec.ts
│  │  ├─ ledger-excel-calculations.spec.ts
│  │  ├─ dashboard-export-excel.spec.ts
│  │  └─ excel-file-integrity.spec.ts
│  │
│  └─ 4.3_Export_Validation/
│     ├─ filename-correctness.spec.ts
│     ├─ company-info-included.spec.ts
│     ├─ totals-match-db.spec.ts
│     └─ formatting-correct.spec.ts
│
├─ 5_NEGATIVE_TESTING/
│  ├─ 5.1_Invalid_Payments/
│  │  ├─ negative-payment-rejected.spec.ts
│  │  ├─ zero-payment-rejected.spec.ts
│  │  ├─ overpayment-handling.spec.ts
│  │  └─ duplicate-payment-prevention.spec.ts
│  │
│  ├─ 5.2_Invalid_Orders/
│  │  ├─ duplicate-order-prevention.spec.ts
│  │  ├─ missing-required-fields.spec.ts
│  │  ├─ invalid-customer-rejected.spec.ts
│  │  └─ invalid-supplier-rejected.spec.ts
│  │
│  ├─ 5.3_Invalid_Data/
│  │  ├─ invalid-dates-rejected.spec.ts
│  │  ├─ future-dates-rejected.spec.ts
│  │  ├─ deleted-customer-error.spec.ts
│  │  ├─ cancelled-order-modification.spec.ts
│  │  └─ invalid-installer-rejected.spec.ts
│  │
│  └─ 5.4_Graceful_Error_Handling/
│     ├─ user-friendly-error-messages.spec.ts
│     ├─ error-recovery-flows.spec.ts
│     └─ form-validation-feedback.spec.ts
│
├─ 6_PERFORMANCE_TESTS/
│  ├─ 6.1_Large_Dataset_Loading/
│  │  ├─ dashboard-1k-customers.spec.ts
│  │  ├─ dashboard-5k-orders.spec.ts
│  │  ├─ dashboard-10k-ledger-records.spec.ts
│  │  └─ search-1k-customers.spec.ts
│  │
│  ├─ 6.2_Operation_Speed/
│  │  ├─ order-creation-time.spec.ts
│  │  ├─ export-large-dataset.spec.ts
│  │  ├─ dashboard-render-time.spec.ts
│  │  └─ search-response-time.spec.ts
│  │
│  └─ 6.3_Performance_Baselines/
│     ├─ dashboard-load-<2s.spec.ts
│     ├─ search-<1s.spec.ts
│     ├─ export-<5s.spec.ts
│     └─ order-creation-<3s.spec.ts
│
├─ 7_RLS_SECURITY/ (ENHANCED)
│  ├─ 7.1_Company_Isolation/
│  │  ├─ company-data-isolation.spec.ts
│  │  ├─ cross-company-access-denied.spec.ts
│  │  └─ company-metrics-isolated.spec.ts
│  │
│  ├─ 7.2_Ledger_Isolation/
│  │  ├─ supplier-ledger-isolation.spec.ts
│  │  └─ installer-ledger-isolation.spec.ts
│  │
│  ├─ 7.3_Data_Isolation/
│  │  ├─ customer-isolation.spec.ts
│  │  ├─ order-isolation.spec.ts
│  │  ├─ supplier-isolation.spec.ts
│  │  └─ installer-isolation.spec.ts
│  │
│  ├─ 7.4_Role_Verification/
│  │  ├─ super-admin-full-access.spec.ts
│  │  ├─ company-admin-restricted-access.spec.ts
│  │  ├─ company-member-readonly.spec.ts
│  │  └─ anon-denied-access.spec.ts
│  │
│  └─ 7.5_Permission_Enforcement/
│     ├─ unauthorized-create-denied.spec.ts
│     ├─ unauthorized-update-denied.spec.ts
│     ├─ unauthorized-delete-denied.spec.ts
│     └─ unauthorized-export-denied.spec.ts
│
└─ 8_FIXTURES_AND_HELPERS/
   ├─ auth.fixtures.ts (login, logout, role switching)
   ├─ api.fixtures.ts (direct DB setup/teardown)
   ├─ workflow.fixtures.ts (complete business workflows)
   ├─ validation.helpers.ts (DB vs UI comparison)
   ├─ reporting.helpers.ts (advanced error reporting)
   ├─ mobile.fixtures.ts (device emulation)
   └─ performance.helpers.ts (timing, metrics)
```

---

## 🎯 PRIMARY TEST FOCUS: END-TO-END BUSINESS WORKFLOWS

### 1.1 HAPPY PATH: Complete Order Lifecycle

**Test Name:** `complete-order-lifecycle.spec.ts`

**Workflow:**
```
1. Create Customer
   → Verify: customer record in DB
   
2. Take Measurement
   → Measure: 500cm × 300cm
   → Verify: measurement record saved
   
3. Create Quote
   → Add: 1× Single Pane (qty), 1× Custom Frame (m²)
   → Calculate: (qty × price_qty) + (area × price_area)
   → Verify: quote_total matches calculation
   
4. Convert Quote to Order
   → Click: "Siparişe Çevir"
   → Verify: quote.status = 'converted'
   → Verify: order created with same items
   
5. Add Products
   → Add more products to order
   → Verify: order_items updated
   
6. Assign Supplier
   → Assign: QA-Supplier-1 to items
   → Verify: supplier_transactions INSERT (debt)
   
7. Verify Supplier Ledger
   → UI: Suppliers → Supplier → Ledger
   → DB: SELECT * FROM supplier_transactions WHERE supplier_id = X
   → Assert: UI total_debt == DB SUM(amount WHERE type='debt')
   
8. Assign Installer
   → Assign: QA-Installer-1 (commission_type='quantity')
   → Create: installation_job record
   
9. Complete Installation
   → Update: installation_job.status = 'completed'
   → Verify: installer_earnings trigger fires
   → DB: SELECT * FROM installer_earnings WHERE job_id = X
   → Assert: earnings = qty × commission_rate
   
10. Receive Customer Payment
    → Record: payment amount = order.total_amount
    → Verify: payment record created
    → DB: SELECT balance FROM (earnings - payments)
    
11. Dashboard Verification
    → Monthly Income: should include this order
    → Completed Orders: +1
    → Supplier Balance: decreased (after supplier payment)
    → Installer Balance: decreased (after installer payment)
```

**Assertions:**
- ✅ Customer created
- ✅ Measurement recorded
- ✅ Quote generated (prices calculated)
- ✅ Quote → Order conversion successful
- ✅ Order items preserved
- ✅ Supplier debt recorded
- ✅ Supplier ledger correct
- ✅ Installation job created
- ✅ Installation completion triggers earnings
- ✅ Payment recorded
- ✅ Dashboard metrics accurate

**DB Validation Points:**
```sql
-- 1. Customer exists
SELECT COUNT(*) FROM customers WHERE id = :customer_id;

-- 2. Measurement exists
SELECT COUNT(*) FROM measurements WHERE customer_id = :customer_id;

-- 3. Quote created
SELECT COUNT(*) FROM quotes WHERE id = :quote_id;

-- 4. Order created from quote
SELECT COUNT(*) FROM orders WHERE quote_id = :quote_id;

-- 5. Order items match quote items
SELECT COUNT(*) FROM order_items WHERE order_id = :order_id
  AND COUNT(*) = (SELECT COUNT(*) FROM quote_items WHERE quote_id = :quote_id);

-- 6. Supplier transaction created
SELECT SUM(amount) AS total_debt FROM supplier_transactions 
  WHERE supplier_id = :supplier_id AND type = 'debt';

-- 7. Installation job created
SELECT COUNT(*) FROM installation_jobs WHERE order_id = :order_id;

-- 8. Installer earnings created
SELECT COUNT(*) FROM installer_earnings WHERE job_id = :job_id;

-- 9. Earning amount correct
SELECT total_earning FROM installer_earnings WHERE job_id = :job_id;
-- Assert: total_earning = qty × commission_rate

-- 10. Payment recorded
SELECT SUM(amount) FROM payments WHERE order_id = :order_id;

-- 11. Dashboard aggregate correct
SELECT 
  SUM(orders.total_amount) AS monthly_income,
  COUNT(*) AS order_count
FROM orders 
WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW());
```

---

### 1.2 REVERSE SCENARIOS

#### Scenario: Order Cancellation
```
1. Create order (above workflow)
2. Cancel order → order.status = 'cancelled'
3. Verify:
   - supplier_transactions: debt → cancelled
   - installer_earnings: earnings → cancelled (adjustment)
   - supplier ledger: balance recalculated
   - installer ledger: balance recalculated
4. Payment attempt → should reject (order cancelled)
```

#### Scenario: Partial Payment
```
1. Order total: 5000 TL
2. Payment 1: 2000 TL
3. Verify: balance = 3000 TL
4. Payment 2: 1000 TL
5. Verify: balance = 2000 TL
6. Payment 3: 2000 TL
7. Verify: balance = 0 TL, order.status = 'paid'
```

#### Scenario: Order Modification After Creation
```
1. Create order with 5 items
2. Add item #6
3. Verify: order_items count = 6
4. Verify: supplier_transactions new debt added
5. Remove item #1
6. Verify: order_items count = 5
7. Verify: supplier_transactions cancelled for item #1
```

---

## 📊 DASHBOARD VALIDATION (DB vs UI Comparison)

**Key Principle:** Never only check UI visibility. Every dashboard card must be validated against database.

### 2.1 Monthly Income Validation

**Test:** `monthly-income-validation.spec.ts`

```typescript
// Pseudo-code structure

test('Dashboard Monthly Income matches database', async ({ page, apiClient }) => {
  // 1. Create test data
  const order1 = await createOrder(5000);  // Jan 1
  const order2 = await createOrder(3000);  // Jan 15
  const order3 = await createOrder(2000);  // Feb 1
  
  // 2. Query database for true value
  const dbValue = await apiClient.query(`
    SELECT SUM(total_amount) as income
    FROM orders
    WHERE DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NOW())
    AND status IN ('completed', 'paid', 'invoiced')
  `);
  // Expected: 5000 + 3000 = 8000 (Feb 1 not included - different month)
  
  // 3. Navigate to dashboard
  await page.goto('/dashboard');
  
  // 4. Extract UI value
  const uiValue = await page.locator('[data-testid="monthly-income"]')
    .textContent();
  // Extract number from "₺8.000,00"
  
  // 5. Compare
  expect(uiValue).toBe(formatCurrency(dbValue.income));
  
  // 6. Verify components
  expect(dbValue.income).toBeGreaterThan(0);
  expect(uiValue).toContain('₺');  // Turkish locale
});
```

### 2.2 Supplier Balance Validation

```typescript
test('Dashboard Supplier Balance matches ledger', async ({ page, apiClient }) => {
  // 1. Create supplier with transactions
  const supplier = await createSupplier();
  await createDebt(supplier.id, 5000);   // Debt
  await createPayment(supplier.id, 2000); // Payment
  // Balance should be: 5000 - 2000 = 3000
  
  // 2. DB query
  const dbBalance = await apiClient.query(`
    SELECT 
      SUM(CASE WHEN type='debt' THEN amount ELSE -amount END) as balance
    FROM supplier_transactions
    WHERE supplier_id = $1
  `, [supplier.id]);
  
  // 3. UI check
  await page.goto('/dashboard');
  const uiBalance = await page.locator('[data-testid="supplier-balance"]')
    .textContent();
  
  // 4. Compare
  expect(uiBalance).toBe(formatCurrency(dbBalance.balance));
});
```

### 2.3 Installer Balance Validation

```typescript
test('Dashboard Installer Balance = Earnings - Payments', async ({ page, apiClient }) => {
  // 1. Create installer with commission setup
  const installer = await createInstaller({ 
    commission_type: 'quantity', 
    rate: 50 
  });
  
  // 2. Create installation job that completes
  const job = await createInstallationJob(installer.id);
  await completeInstallation(job.id);  // Triggers earnings
  // Earnings = qty × 50
  
  // 3. Add payment
  await recordInstallerPayment(installer.id, 500);
  
  // 4. DB calculation
  const dbBalance = await apiClient.query(`
    SELECT 
      SUM(CASE 
        WHEN type='earning' THEN amount
        WHEN type='payment' THEN -amount
        ELSE 0
      END) as balance
    FROM installer_transactions
    WHERE installer_id = $1
  `, [installer.id]);
  
  // 5. UI check
  const uiBalance = await page.locator('[data-testid="installer-balance"]')
    .textContent();
  
  expect(uiBalance).toBe(formatCurrency(dbBalance.balance));
});
```

---

## 📱 MOBILE RESPONSIVE TESTING

### 3.1 Device Matrix

| Device | Viewport | Test |
|--------|----------|------|
| iPhone 13 | 390×844 | complete-order-lifecycle |
| iPhone 14 | 390×844 | quote-to-order conversion |
| iPhone 14 Pro | 430×932 | payment recording |
| iPhone SE | 375×667 | order editing |
| Android 12 | 412×915 | dashboard viewing |
| Android 13 | 412×915 | ledger export |
| iPad Pro | 1024×1366 | form filling |
| iPad Air | 820×1180 | multi-item order |

### 3.2 Mobile Validation Checklist

```typescript
test('iPhone 13: Complete order workflow responsive', async ({ page }) => {
  // Set device
  await page.setViewportSize({ width: 390, height: 844 });
  
  // 1. Navigation accessible
  const menuButton = page.locator('[data-testid="mobile-menu"]');
  await expect(menuButton).toBeVisible();
  
  // 2. Forms usable
  const submitButton = page.locator('button[type="submit"]');
  await expect(submitButton).toBeInViewport();
  
  // 3. No horizontal overflow
  const overflow = await page.evaluate(() => 
    document.documentElement.scrollWidth > window.innerWidth
  );
  expect(overflow).toBe(false);
  
  // 4. Modals fit screen
  await openOrderForm();
  const modal = page.locator('[role="dialog"]');
  const bbox = await modal.boundingBox();
  expect(bbox.width).toBeLessThan(390);
  
  // 5. Complete workflow on mobile
  await fillOrderForm();
  await submitForm();
  await verifySuccessMessage();
});
```

---

## 📄 EXPORT VALIDATION

### 4.1 PDF Export Testing

```typescript
test('Order PDF contains correct data and totals', async ({ page, apiClient }) => {
  // 1. Create order
  const order = await createOrder({
    customer: 'Test Customer',
    items: [{ desc: 'Item 1', qty: 5, price: 100 }],
    total: 500
  });
  
  // 2. Export to PDF
  await page.goto(`/orders/${order.id}`);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('[data-testid="export-pdf"]')
  ]);
  
  // 3. Verify PDF properties
  const path = await download.path();
  const pdf = await PDFParser.parse(path);
  
  // 4. Validate content
  expect(pdf.text).toContain(order.customer);
  expect(pdf.text).toContain('₺500,00');
  expect(pdf.text).toContain(order.id);
  
  // 5. Validate formatting
  const tables = pdf.tables;
  expect(tables.length).toBeGreaterThan(0);
  expect(tables[0].rows).toContainEqual(['Item 1', '5', '₺100,00', '₺500,00']);
});
```

### 4.2 Excel Export Testing

```typescript
test('Order list Excel export matches database', async ({ page, apiClient }) => {
  // 1. Create multiple orders
  await createOrder({ total: 1000 });
  await createOrder({ total: 2000 });
  await createOrder({ total: 3000 });
  
  // 2. Export to Excel
  await page.goto('/orders');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('[data-testid="export-excel"]')
  ]);
  
  // 3. Parse Excel
  const excel = await ExcelParser.parse(await download.path());
  const rows = excel.worksheets[0].rows;
  
  // 4. Validate totals
  const totalSum = rows
    .slice(1)  // Skip header
    .reduce((sum, row) => sum + parseFloat(row[3]), 0);
  
  expect(totalSum).toBe(6000);  // 1000 + 2000 + 3000
  
  // 5. Compare with DB
  const dbTotal = await apiClient.query(
    'SELECT SUM(total_amount) as total FROM orders'
  );
  expect(totalSum).toBe(dbTotal.total);
});
```

---

## ❌ NEGATIVE TESTING

### 5.1 Invalid Payment Prevention

```typescript
test('Negative payment rejected with error message', async ({ page }) => {
  const order = await createOrder({ total: 1000 });
  
  // 1. Navigate to payment form
  await page.goto(`/orders/${order.id}`);
  await page.click('[data-testid="record-payment"]');
  
  // 2. Enter negative amount
  await page.fill('[name="amount"]', '-500');
  await page.click('button[type="submit"]');
  
  // 3. Verify error
  await expect(page.locator('[role="alert"]')).toContainText('Negatif tutar kabul edilmez');
  
  // 4. Verify payment NOT recorded
  const payments = await apiClient.query(
    'SELECT COUNT(*) FROM payments WHERE order_id = $1',
    [order.id]
  );
  expect(payments.count).toBe(0);
});
```

### 5.2 Duplicate Payment Prevention

```typescript
test('Duplicate payment within 60 seconds rejected', async ({ page, apiClient }) => {
  const order = await createOrder({ total: 1000 });
  
  // 1. Record payment
  await recordPayment(page, order.id, 500);
  await expect(page.locator('[role="alert"]')).toContainText('Ödeme kaydedildi');
  
  // 2. Try duplicate immediately
  await recordPayment(page, order.id, 500);
  
  // 3. Verify rejection
  await expect(page.locator('[role="alert"]')).toContainText(
    'Benzer ödeme kısa süre önce kaydedildi'
  );
  
  // 4. DB check
  const payments = await apiClient.query(
    'SELECT COUNT(*) FROM payments WHERE order_id = $1 AND amount = 500',
    [order.id]
  );
  expect(payments.count).toBe(1);  // Only one recorded
});
```

### 5.3 Missing Required Fields

```typescript
test('Order creation fails without required fields', async ({ page }) => {
  // 1. Navigate to new order
  await page.goto('/orders/new');
  
  // 2. Try submit without customer
  await page.click('button[type="submit"]');
  
  // 3. Verify validation error
  await expect(page.locator('[data-testid="error-customer"]'))
    .toContainText('Müşteri seçiniz');
  
  // 4. Verify order NOT created
  const orders = await apiClient.query('SELECT COUNT(*) FROM orders');
  expect(orders.count).toBe(0);
});
```

---

## ⚡ PERFORMANCE TESTING

### 6.1 Dashboard Performance with Large Dataset

```typescript
test('Dashboard loads in <2 seconds with 10k ledger records', async ({ page, apiClient }) => {
  // 1. Create large dataset
  console.log('Creating 10k ledger records...');
  await apiClient.seedData({
    customers: 1000,
    orders: 5000,
    ledger_records: 10000
  });
  
  // 2. Measure load time
  const startTime = Date.now();
  await page.goto('/dashboard');
  const loadTime = Date.now() - startTime;
  
  // 3. Verify performance
  expect(loadTime).toBeLessThan(2000);  // 2 seconds
  
  // 4. Verify data correctness despite size
  const monthlyIncome = await page.locator('[data-testid="monthly-income"]');
  await expect(monthlyIncome).toBeVisible();
});
```

### 6.2 Search Performance

```typescript
test('Customer search completes in <1 second for 1k customers', async ({ page, apiClient }) => {
  // 1. Create 1000 customers
  await apiClient.seedData({ customers: 1000 });
  
  // 2. Measure search time
  await page.goto('/customers');
  const startTime = Date.now();
  await page.fill('[name="search"]', 'Test Customer #500');
  await page.waitForSelector('[data-testid="customer-row"]');
  const searchTime = Date.now() - startTime;
  
  // 3. Verify performance
  expect(searchTime).toBeLessThan(1000);  // 1 second
  
  // 4. Verify correct result
  const row = page.locator('[data-testid="customer-row"]').first();
  await expect(row).toContainText('Test Customer #500');
});
```

### 6.3 Export Performance

```typescript
test('Export 5000 orders to Excel in <5 seconds', async ({ page, apiClient }) => {
  // 1. Create 5000 orders
  await apiClient.seedData({ orders: 5000 });
  
  // 2. Measure export time
  await page.goto('/orders');
  const startTime = Date.now();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('[data-testid="export-excel"]')
  ]);
  const exportTime = Date.now() - startTime;
  
  // 3. Verify performance
  expect(exportTime).toBeLessThan(5000);  // 5 seconds
  
  // 4. Verify file integrity
  const excel = await ExcelParser.parse(await download.path());
  expect(excel.worksheets[0].rows.length).toBe(5001);  // 5000 + header
});
```

---

## 🔒 RLS SECURITY (ENHANCED)

### 7.1 Company Isolation - Comprehensive Test

```typescript
test('Company B cannot access Company A ledger data', async ({ page, apiClient }) => {
  // 1. Setup: Create two companies with separate data
  const companyA = await createCompany('Company-A');
  const companyB = await createCompany('Company-B');
  
  const supplierA = await createSupplier(companyA, { name: 'Supplier-A' });
  const supplierB = await createSupplier(companyB, { name: 'Supplier-B' });
  
  // 2. Create transactions
  const debtA = await createDebt(supplierA, 5000);
  const debtB = await createDebt(supplierB, 3000);
  
  // 3. Company A admin login
  await page.goto('/login');
  await page.fill('[name="email"]', 'admin-a@test.local');
  await page.fill('[name="password"]', 'Password123');
  await page.click('button[type="submit"]');
  
  // 4. Try to access Company B supplier
  const response = await page.request.get(
    `/api/suppliers/${supplierB.id}/ledger`
  );
  expect(response.status()).toBe(403);  // Access denied
  
  // 5. Verify SQL query respects RLS
  const dbResult = await apiClient.query(
    'SELECT * FROM supplier_transactions WHERE supplier_id = $1',
    [supplierB.id],
    { asCompanyA: true }  // Query as Company A
  );
  expect(dbResult.rows).toEqual([]);  // Empty result
});
```

### 7.2 Ledger Isolation

```typescript
test('Supplier B ledger completely isolated from Supplier A', async ({ apiClient }) => {
  // 1. Create suppliers
  const supplierA = await createSupplier('Supplier-A');
  const supplierB = await createSupplier('Supplier-B');
  
  // 2. Add transactions
  await createDebt(supplierA, 5000);
  await createDebt(supplierB, 3000);
  await createPayment(supplierA, 2000);
  
  // 3. Query as different suppliers should return nothing
  const supplierATransactions = await apiClient.query(
    'SELECT * FROM supplier_transactions WHERE supplier_id = $1',
    [supplierA.id],
    { asSupplier: supplierB.id }  // Query as Supplier B
  );
  
  expect(supplierATransactions.rows).toEqual([]);
});
```

---

## 📋 ADVANCED ERROR REPORTING

Every test failure automatically includes:

```typescript
// Automatic on failure:
interface TestFailureReport {
  // Identification
  testId: string;
  testName: string;
  timestamp: ISO8601;
  environment: 'staging' | 'test';
  
  // User context
  currentUser: {
    email: string;
    role: string;
    company_id: string;
  };
  
  // Visual
  screenshot: string;  // Path to PNG
  video: string;       // Path to MP4 (if enabled)
  
  // Debugging
  consoleLogs: string[];
  networkRequests: {
    method: string;
    url: string;
    status: number;
    duration: number;
  }[];
  
  // Database state at failure
  databaseState: {
    table: string;
    query: string;
    result: any;
  }[];
  
  // Error information
  errorMessage: string;
  errorStack: string;
  assertion: string;
  
  // Performance
  pageLoadTime: number;
  lastInteractionTime: number;
  
  // Reproducibility
  stepsToReproduce: string[];
  testCode: string;
  seedData: any;
}
```

**Example Failure Report:**
```
=== TEST FAILURE REPORT ===
Test: complete-order-lifecycle
Status: FAILED
Time: 2026-07-07T14:30:45Z

USER CONTEXT:
- Email: qa_admin@test.local
- Role: admin
- Company: QA-TEST-2026

ASSERTION FAILED:
Expected: supplier debt = ₺5000.00
Actual: supplier debt = ₺0.00

SCREENSHOTS:
- Before payment: tests/reports/failure-001-before.png
- Error state: tests/reports/failure-001-error.png

NETWORK REQUESTS:
- POST /api/orders → 201 OK (45ms)
- POST /api/order-items → 201 OK (32ms)
- POST /api/supplier-transactions → 200 OK (28ms) ❌
  Response: {"error": "RLS policy denied access"}

CONSOLE LOGS:
[ERROR] Failed to record supplier debt: RLS policy not found

DATABASE STATE:
- Query: SELECT * FROM supplier_transactions WHERE order_id = 'abc123'
- Result: No rows returned ❌

RECOMMENDATION:
- Check if RLS policy exists on supplier_transactions table
- Verify supplier_id is correctly assigned to order_item
- Check if trigger on_order_item_create is firing
```

---

## 🚀 CI/CD INTEGRATION

### Pipeline Configuration

```yaml
# .github/workflows/e2e-tests.yml

name: E2E Tests

on:
  pull_request:
  push:
    branches: [main, staging]

jobs:
  test:
    runs-on: ubuntu-latest
    
    strategy:
      matrix:
        test-suite:
          - business-workflows
          - dashboard-validation
          - mobile-responsive
          - export-functionality
          - negative-testing
          - performance-tests
          - rls-security
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Setup test environment
        run: |
          npm install
          npm run setup:test-db
          npm run seed:test-data
      
      - name: Run ${{ matrix.test-suite }} tests
        run: npm test -- --grep="${{ matrix.test-suite }}"
      
      - name: Upload failure reports
        if: failure()
        uses: actions/upload-artifact@v3
        with:
          name: test-reports-${{ matrix.test-suite }}
          path: tests/reports/**/*
      
      - name: Upload performance metrics
        if: success()
        uses: actions/upload-artifact@v3
        with:
          name: performance-metrics
          path: tests/performance.json
      
      - name: Comment PR with results
        if: always()
        uses: actions/github-script@v6
        with:
          script: |
            // Post test summary to PR
```

### Pre-Deployment Checklist

```yaml
# .github/workflows/production-release.yml

name: Production Release

on:
  workflow_dispatch:

jobs:
  qa-gate:
    runs-on: ubuntu-latest
    
    steps:
      - name: Run full E2E suite
        run: npm test -- --suite=all
      
      - name: Performance baseline check
        run: npm run test:performance -- --baseline
      
      - name: RLS security audit
        run: npm run test:security -- --comprehensive
      
      - name: Production data validation
        run: npm run test:sanity -- --production-copy
      
      - name: Report gate results
        run: |
          if [ $? -ne 0 ]; then
            echo "❌ E2E tests failed - blocking release"
            exit 1
          fi
          echo "✅ All E2E tests passed - ready for production"
      
      - name: Deploy
        if: success()
        run: npm run deploy:production
```

---

## 📈 METRICS & REPORTING

### Test Execution Dashboard

```
PerdePRO E2E TEST DASHBOARD
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Last Run: 2026-07-07 14:30:45 UTC
Environment: Staging

SUMMARY:
├─ Total Tests: 250+
├─ Passed: 248 ✅
├─ Failed: 2 ❌
├─ Skipped: 0
├─ Duration: 2h 15min
└─ Success Rate: 99.2%

TEST SUITE BREAKDOWN:
├─ Business Workflows: 25/25 ✅
├─ Dashboard Validation: 15/15 ✅
├─ Mobile Responsive: 24/25 ❌ (1 iPad Pro layout)
├─ Export Functionality: 10/10 ✅
├─ Negative Testing: 20/20 ✅
├─ Performance Tests: 8/10 ❌ (2 timeout)
├─ RLS Security: 148/150 ✅
└─ Helpers & Fixtures: 0/0 (not counted)

FAILURES:
├─ iPad Pro: Modal overflow at 1024px
│  Screenshot: reports/failure-001-ipad-pro.png
│  Fix: Reduce modal max-width to 95vw
│
└─ Performance: Export timeout at 8s
   Test: export-5000-orders
   Baseline: <5s
   Actual: 8.2s
   Status: Investigate database query

PERFORMANCE METRICS:
├─ Dashboard load: 1.8s ✅ (<2s)
├─ Search (1k customers): 0.9s ✅ (<1s)
├─ Order creation: 2.1s ✅ (<3s)
└─ Export (5000 orders): 8.2s ⚠️ (baseline 5s)

TREND:
├─ Success rate: 99.2% (↑ from 98.5%)
├─ Performance: Stable
├─ RLS violations: 0 (↓ from 2)
└─ Overall: ✅ PASS - Ready for production
```

---

## ✅ ARCHITECTURE APPROVAL CHECKLIST

Before implementing Playwright tests:

- [ ] E2E Business Workflows: Complete order-to-cash flows validated
- [ ] Dashboard Validation: UI vs DB comparison implemented
- [ ] Mobile Testing: iPhone, Android, Tablet coverage defined
- [ ] Export Testing: PDF/Excel integrity verified
- [ ] Negative Testing: Invalid operations rejected gracefully
- [ ] Performance Tests: Large dataset scenarios defined
- [ ] RLS Security: Company/ledger/data isolation verified
- [ ] Error Reporting: Screenshots, logs, DB state captured
- [ ] CI/CD: GitHub Actions pipeline designed
- [ ] Reporting: Dashboard metrics setup

**Status:** 🟡 PLAN COMPLETE - AWAITING APPROVAL FOR IMPLEMENTATION

---

## 📝 IMPLEMENTATION PHASES

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| Phase 1 | 1 week | Business Workflow tests (1.1-1.3) |
| Phase 2 | 1 week | Dashboard Validation tests (2.1-2.3) |
| Phase 3 | 1 week | Mobile, Export, Negative tests (3-5) |
| Phase 4 | 1 week | Performance & RLS tests (6-7) |
| Phase 5 | 1 week | Error Reporting & CI/CD setup |
| Phase 6 | 1 week | Integration & documentation |
| **Total** | **6 weeks** | **Production-grade test suite** |

---

## 🎯 SUCCESS CRITERIA

✅ All 250+ tests pass  
✅ 0 production data touched  
✅ 0 RLS violations detected  
✅ Dashboard metrics 100% accurate  
✅ Mobile workflows 100% responsive  
✅ All exports validated  
✅ All negative scenarios rejected  
✅ Performance baselines met  
✅ Complete failure reports generated  
✅ CI/CD pipeline automatic  

**When ALL are met: Production-ready QA system**
