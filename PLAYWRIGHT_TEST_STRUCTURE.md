# PLAYWRIGHT E2E TEST SUITE STRUCTURE
**Status:** Plan Only (No Code Yet)

---

## 📁 FILE STRUCTURE & NAMING

```
tests/
│
├── fixtures/
│   ├── auth.fixtures.ts
│   │   ├── loginAs(role: 'super_admin' | 'admin' | 'member' | 'installer')
│   │   ├── logout()
│   │   └── getCurrentUser()
│   │
│   ├── test-data.fixtures.ts
│   │   ├── setupTestCompany() → returns company_id
│   │   ├── createTestCustomer(company_id)
│   │   ├── createTestSupplier(company_id, unit_cost)
│   │   ├── createTestInstaller(company_id, commission_type)
│   │   ├── createTestProduct(company_id, type: 'quantity'|'area')
│   │   └── cleanupTestData(company_id)
│   │
│   ├── api.fixtures.ts
│   │   ├── supabaseAdmin (direct DB access for setup)
│   │   ├── directInsert(table, data)
│   │   └── directQuery(sql)
│   │
│   └── navigation.fixtures.ts
│       ├── goto(route)
│       ├── clickButton(label)
│       └── fillForm(fields)
│
├── specs/
│   │
│   ├── 1-order-creation.spec.ts
│   │   ├── test('Create new order with single line item')
│   │   ├── test('Create order with multiple items (adet + area)')
│   │   ├── test('Assign supplier to order item')
│   │   ├── test('Order status transitions (draft → confirmed → completed)')
│   │   ├── test('Delete order cascades to order_items and ledger')
│   │   └── test('Cannot create order with invalid customer')
│   │
│   ├── 2-quote-to-order.spec.ts
│   │   ├── test('Create quote with items')
│   │   ├── test('Convert quote to order preserves items')
│   │   ├── test('Quote status becomes "converted" after order creation')
│   │   ├── test('Quote items prices match order item prices')
│   │   └── test('Cannot convert quote twice')
│   │
│   ├── 3-supplier-ledger.spec.ts
│   │   ├── test('Order item creation triggers supplier debt')
│   │   ├── test('Supplier debt amount = supplier_total_cost')
│   │   ├── test('Supplier ledger shows debt, payments, balance')
│   │   ├── test('Record supplier payment updates balance')
│   │   ├── test('Multiple payments reduce balance correctly')
│   │   ├── test('Paid-off debt shows balance = 0')
│   │   ├── test('Delete order cascades debt cancellation')
│   │   └── test('RLS: Different company cannot see supplier ledger')
│   │
│   ├── 4-installer-ledger.spec.ts
│   │   ├── test('Set installer commission_type (quantity/area/hybrid)')
│   │   ├── test('Installation complete triggers earnings record')
│   │   ├── test('Quantity commission: earnings = qty × rate')
│   │   ├── test('Area commission: earnings = area_m2 × rate')
│   │   ├── test('Hybrid commission: earnings = (qty × rate_qty) + (area × rate_area)')
│   │   ├── test('Installer ledger displays earnings and payments')
│   │   ├── test('Record installer payment updates balance')
│   │   ├── test('Delete installation cascades earnings cancellation')
│   │   ├── test('RLS: Installer sees own earnings only')
│   │   └── test('RLS: Different installer cannot see other earnings')
│   │
│   ├── 5-payments.spec.ts
│   │   ├── test('Record payment for order')
│   │   ├── test('Record payment for supplier debt')
│   │   ├── test('Record payment for installer earnings')
│   │   ├── test('Partial payment leaves remaining balance')
│   │   ├── test('Overpayment handled (negative balance policy)')
│   │   ├── test('Payment method stored and displayed')
│   │   └── test('Payment date defaults to today')
│   │
│   ├── 6-dashboard.spec.ts
│   │   ├── test('Dashboard shows total orders sum')
│   │   ├── test('Pending orders count accurate')
│   │   ├── test('Completed installations count accurate')
│   │   ├── test('Total collected payments sum accurate')
│   │   ├── test('Supplier debt outstanding shown')
│   │   ├── test('Installer earnings balance shown')
│   │   ├── test('Dashboard refreshes on tab switch')
│   │   ├── test('Filter by date range works')
│   │   └── test('Export to CSV works')
│   │
│   └── 7-rls-security.spec.ts
│       ├── describe('SUPER_ADMIN')
│       │   ├── test('Sees all companies')
│       │   ├── test('Sees all orders from all companies')
│       │   ├── test('Can create/update/delete any data')
│       │   ├── test('Dashboard shows aggregate metrics')
│       │   └── test('Can impersonate other users')
│       │
│       ├── describe('COMPANY_ADMIN')
│       │   ├── test('Sees only own company orders')
│       │   ├── test('Cannot see other company orders')
│       │   ├── test('Can create order in own company')
│       │   ├── test('Cannot create order in other company')
│       │   ├── test('Can delete own company orders')
│       │   ├── test('Cannot delete other company orders')
│       │   ├── test('Can manage own company staff')
│       │   └── test('Dashboard shows own company metrics')
│       │
│       ├── describe('COMPANY_MEMBER (readonly)')
│       │   ├── test('Can read own company data')
│       │   ├── test('Cannot read other company data')
│       │   ├── test('Cannot create records')
│       │   ├── test('Cannot update records')
│       │   ├── test('Cannot delete records')
│       │   ├── test('Installer can see own earnings')
│       │   └── test('Installer cannot see other earnings')
│       │
│       └── describe('ANONYMOUS')
│           ├── test('Cannot access any protected routes')
│           ├── test('Cannot query any tables')
│           ├── test('Redirected to login')
│           └── test('Cannot insert/update/delete')
│
├── helpers/
│   ├── navigation.ts
│   │   ├── export async function navigateTo(page, path)
│   │   ├── export async function fillOrderForm(page, data)
│   │   └── export async function selectFromDropdown(page, label, value)
│   │
│   ├── assertions.ts
│   │   ├── export async function expectTableRowCount(page, table, count)
│   │   ├── export async function expectOrderTotal(page, expected)
│   │   ├── export async function expectBalance(page, supplier, expected)
│   │   └── export async function expectAccessDenied(page)
│   │
│   └── reporting.ts
│       ├── export async function takeScreenshot(page, testName)
│       ├── export async function logTestResult(name, status, error?)
│       └── export async function generateReport()
│
└── playwright.config.ts
    ├── baseURL: 'http://localhost:5173' (or test.curtin-saas.local)
    ├── timeout: 30000
    ├── retries: 1 (only on CI)
    ├── use:
    │   ├── headless: false (local), true (CI)
    │   ├── video: 'retain-on-failure'
    │   ├── screenshot: 'only-on-failure'
    │   └── trace: 'on-first-retry'
    └── webServer:
        └── command: 'npm run dev'
```

---

## 🔑 KEY TEST PATTERNS

### Pattern 1: LOGIN + PERFORM ACTION + LOGOUT
```typescript
// Don't repeat this code in every test. Use fixture.

test('Admin can create order', async ({ page }) => {
  // Setup
  await loginAs(page, 'admin', 'qa_admin@test.local');
  
  // Action
  await navigateTo(page, '/orders/new');
  await fillOrderForm(page, { 
    customer: 'QA-Customer-1',
    items: [{ product: 'Single Pane', qty: 5 }]
  });
  await page.click('button:has-text("Kaydet")');
  
  // Assert
  await expectTableRowCount(page, 'orders', 1);
  
  // Cleanup
  await logout(page);
});
```

### Pattern 2: DIRECT DB SETUP (Don't use UI for setup)
```typescript
// For complex setup, use direct DB inserts to save time

test.beforeEach(async ({ apiClient }) => {
  // Create test company directly
  const company = await apiClient.directInsert('companies', {
    name: 'QA-TEST-2026',
    created_at: new Date()
  });
  
  // Create customers directly
  await apiClient.directInsert('customers', {
    company_id: company.id,
    name: 'QA-Customer-1'
  });
});
```

### Pattern 3: VERIFY RLS ISOLATION
```typescript
test('Member cannot see other company data', async ({ page }) => {
  // Company A admin creates order
  await loginAs(page, 'admin', 'qa_admin_a@test.local');
  const orderId = await createOrderViaUI(page, 'Company A', 'Customer 1');
  await logout(page);
  
  // Company B member tries to view
  await loginAs(page, 'member', 'qa_member_b@test.local');
  await navigateTo(page, `/orders/${orderId}`);
  
  // Should see access denied
  await expect(page.locator('text=/Access Denied|404/')).toBeVisible();
  await logout(page);
});
```

### Pattern 4: VERIFY CALCULATIONS
```typescript
test('Supplier debt = supplier_total_cost', async ({ page, apiClient }) => {
  // Create order with supplier cost 500
  const order = await createOrderViaAPI(apiClient, {
    items: [{ supplier_total_cost: 500 }]
  });
  
  // View supplier ledger
  await loginAs(page, 'admin', 'qa_admin@test.local');
  await navigateTo(page, `/suppliers/${order.supplier_id}/ledger`);
  
  // Verify debt matches
  const debtAmount = await page.locator('text=/Toplam Borç/).evaluate(el => 
    el.textContent.match(/[\d,]+/)[0]
  );
  expect(debtAmount).toBe('500,00'); // Turkish locale
});
```

---

## 🧩 FIXTURE USAGE EXAMPLES

### Auth Fixture
```typescript
// tests/fixtures/auth.fixtures.ts

export const test = base.extend({
  loginAs: async ({ page }, use) => {
    await use(async (role: 'super_admin'|'admin'|'member'|'installer') => {
      const creds = {
        'super_admin': { email: 'qa_super@test.local', pwd: process.env.QA_SUPER_PWD },
        'admin': { email: 'qa_admin@test.local', pwd: process.env.QA_ADMIN_PWD },
        'member': { email: 'qa_member@test.local', pwd: process.env.QA_MEMBER_PWD },
        'installer': { email: 'qa_installer@test.local', pwd: process.env.QA_INSTALLER_PWD },
      };
      
      await page.goto('/login');
      await page.fill('input[name="email"]', creds[role].email);
      await page.fill('input[name="password"]', creds[role].pwd);
      await page.click('button:has-text("Giriş Yap")');
      await page.waitForURL('/dashboard');
    });
  }
});
```

### Test Data Fixture
```typescript
// tests/fixtures/test-data.fixtures.ts

export const test = base.extend({
  testData: async ({ apiClient }, use) => {
    const data = {
      company: null,
      users: {},
      customers: {},
      suppliers: {}
    };
    
    // Setup
    data.company = await apiClient.directInsert('companies', {
      name: 'QA-TEST-' + Date.now()
    });
    
    data.users.admin = await createTestUser('qa_admin@test.local', 'admin');
    data.users.member = await createTestUser('qa_member@test.local', 'member');
    
    data.customers.c1 = await apiClient.directInsert('customers', {
      company_id: data.company.id,
      name: 'QA-Customer-1'
    });
    
    await use(data);
    
    // Teardown: Delete cascade via company_id
    await apiClient.directDelete('companies', data.company.id);
  }
});
```

---

## 🎯 TEST EXECUTION FLOW

### 1. SMOKE TEST PHASE (5 min)
- Can login
- Can navigate to main pages
- Dashboard loads
- Basic UI responsive

### 2. FUNCTIONAL PHASE (30 min)
- Order creation works
- Quote to order conversion works
- Payment recording works
- Supplier/Installer ledgers update

### 3. CALCULATION PHASE (20 min)
- Supplier debt = supplier_total_cost
- Installer earnings = qty×rate OR area×rate OR hybrid
- Payment reduces balance correctly
- Dashboard totals = DB sums

### 4. RLS PHASE (20 min)
- Super admin sees all
- Company admin sees own only
- Company member readonly
- Anon gets no access

### 5. REGRESSION PHASE (15 min)
- Tab switch doesn't lose state
- Refresh doesn't break data
- Filters work
- Exports work

**Total: ~90 minutes per full run**

---

## 🔍 ERROR HANDLING IN TESTS

### Test Fails → What to Capture

1. **Screenshot**
   ```typescript
   await page.screenshot({ path: `tests/screenshots/fail-${test.title}-${Date.now()}.png` });
   ```

2. **Console Logs**
   ```typescript
   page.on('console', msg => console.log('PAGE LOG:', msg.text()));
   ```

3. **Network Logs**
   ```typescript
   page.on('response', resp => console.log(`${resp.url()} ${resp.status()}`));
   ```

4. **DB State**
   ```typescript
   const dbState = await apiClient.directQuery(
     `SELECT * FROM orders WHERE id = '${orderId}'`
   );
   console.log('DB STATE:', dbState);
   ```

5. **User Context**
   ```typescript
   const currentUser = await apiClient.getCurrentUser();
   console.log('CURRENT USER:', currentUser.role, currentUser.company_id);
   ```

---

## 📊 REPORTING

### Test Report Template
```
=== PerdePRO E2E TEST REPORT ===
Date: 2026-07-07
Environment: test.curtain-saas.local
Database: qa_test_2026

SUMMARY:
- Total Tests: 87
- Passed: 85
- Failed: 2
- Skipped: 0
- Duration: 1h 32min

FAILURES:
1. 4.5-installer-ledger: Installation complete doesn't trigger earnings
   - Error: installer_earnings table empty after job status='completed'
   - Screenshot: fail-4.5-[timestamp].png
   - Role: qa_admin
   - Company: QA-TEST-2026

2. 6.2-dashboard: Dashboard pending orders count wrong
   - Error: Expected 3, got 2
   - SQL: SELECT COUNT(*) FROM orders WHERE status='pending'
   - Screenshot: fail-6.2-[timestamp].png

PASSED SECTIONS:
✅ Order Creation (1.1-1.8)
✅ Quote to Order (2.1-2.6)
✅ Supplier Ledger (3.1-3.7)
⚠️  Installer Ledger (4/10 passed)
✅ Payments (5.1-5.7)
⚠️  Dashboard (5/7 passed)
✅ RLS Security (28/28 passed)

RECOMMENDATIONS:
1. Check if trigger on_installation_job_completed is firing
2. Verify dashboard query includes pending orders only
3. Re-run failed tests after fixes

Next Run: [timestamp]
```

---

## ✅ READINESS CHECKLIST (BEFORE RUNNING TESTS)

- [ ] Test company "QA-TEST-2026" exists in Supabase
- [ ] Test users created (qa_admin, qa_member, qa_installer, qa_super)
- [ ] Test credentials stored in `.env.test`
- [ ] `playwright.config.ts` points to correct baseURL
- [ ] `npm install` completed
- [ ] Dev server can run locally (`npm run dev`)
- [ ] Supabase RLS policies verified (test company has access)
- [ ] No conflicting test data from previous runs
- [ ] Screenshots/videos directory writable
- [ ] All fixtures compile (TypeScript check)

---

## 🚀 NEXT STEPS (AFTER PLAN APPROVAL)

1. Create `tests/` directory structure
2. Write fixture files (auth, test-data, api, navigation)
3. Write helper files (assertions, reporting)
4. Write 7 spec files (one per functional area)
5. Configure `playwright.config.ts`
6. Run smoke test on first spec
7. Iterate until all specs pass
8. Generate final report
9. Archive screenshots/videos
10. Document any production issues found

---

## 🎯 SUCCESS CRITERIA FOR PLAYWRIGHT SUITE

- [x] Plan documented
- [ ] All 87 test cases defined in specs
- [ ] Fixtures working (auth, test-data, API)
- [ ] Helpers complete (navigation, assertions, reporting)
- [ ] All tests run without errors (0 failures)
- [ ] All tests run in <2 minutes each
- [ ] Screenshots/videos captured on failure
- [ ] Report generated automatically
- [ ] No production data touched
- [ ] Test company cleaned up after run
