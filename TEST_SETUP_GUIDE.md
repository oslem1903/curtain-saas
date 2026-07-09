# TEST SETUP & DATA ISOLATION GUIDE

**Goal:** Run QA tests safely without touching production data.

---

## 🏗️ INFRASTRUCTURE SETUP

### 1. TEST PROJECT vs PRODUCTION PROJECT

| Aspect | Production | Test |
|--------|-----------|------|
| Database | prod_curtain_saas | test_curtain_saas |
| URL | app.curtain-saas.com | test.curtain-saas.local |
| Users | Real customers | qa_* users only |
| Data | Real orders/suppliers | QA-TEST-* only |
| Backups | Daily | Before tests |
| Reset | NEVER | After each test run |

### 2. SUPABASE CONFIGURATION

**Production Project:**
```
Project ID: [PROD_ID]
URL: https://[PROD_ID].supabase.co
API Key: [PROD_KEY] (stored in production env)
DATABASE: prod_curtain_saas (original)
```

**Test Project:**
```
Project ID: [TEST_ID]
URL: https://[TEST_ID].supabase.co
API Key: [TEST_KEY] (stored in .env.test ONLY)
DATABASE: test_curtain_saas (separate)
```

⚠️ **NEVER mix these up!**

---

## 👥 TEST USER SETUP

### Create Test Users in Supabase Auth

**Method 1: Supabase Dashboard**
1. Go to Project Settings → Users
2. Invite users with test emails:

```
qa_super@test.local       (super_admin)
qa_admin@test.local       (company_admin)
qa_member1@test.local     (company_member)
qa_member2@test.local     (company_member)
qa_installer@test.local   (company_member + installer role)
```

Set temporary password for each (users will reset on first login).

**Method 2: SQL (Direct)**
```sql
-- Run in test project ONLY

INSERT INTO auth.users (email, email_confirmed_at, encrypted_password, raw_user_meta_data)
VALUES
  ('qa_super@test.local', NOW(), crypt('TestPass123!', gen_salt('bf')), '{"role": "super_admin"}'),
  ('qa_admin@test.local', NOW(), crypt('TestPass123!', gen_salt('bf')), '{"role": "admin"}'),
  ('qa_member1@test.local', NOW(), crypt('TestPass123!', gen_salt('bf')), '{"role": "member"}'),
  ('qa_installer@test.local', NOW(), crypt('TestPass123!', gen_salt('bf')), '{"role": "member"}');

-- Verify
SELECT id, email FROM auth.users WHERE email LIKE 'qa_%';
```

### Store Credentials in `.env.test`

```bash
# .env.test (DON'T COMMIT THIS FILE)

VITE_SUPABASE_URL=https://[TEST_PROJECT_ID].supabase.co
VITE_SUPABASE_ANON_KEY=[TEST_ANON_KEY]

# Test user credentials
QA_SUPER_EMAIL=qa_super@test.local
QA_SUPER_PWD=TestPass123!

QA_ADMIN_EMAIL=qa_admin@test.local
QA_ADMIN_PWD=TestPass123!

QA_MEMBER_EMAIL=qa_member1@test.local
QA_MEMBER_PWD=TestPass123!

QA_INSTALLER_EMAIL=qa_installer@test.local
QA_INSTALLER_PWD=TestPass123!

# Database admin (for direct API inserts)
SUPABASE_SERVICE_ROLE_KEY=[TEST_SERVICE_ROLE_KEY]
```

Add `.env.test` to `.gitignore`:
```
.env.test
.env.test.local
```

---

## 🏢 TEST COMPANY CREATION

### Option 1: Manual (via UI)

1. Login as qa_super@test.local
2. Go to Super Admin → Companies → Create
3. Fill form:
   ```
   Name: QA-TEST-2026
   Owner: qa_admin@test.local
   ```
4. Create company
5. Invite members:
   - qa_member1@test.local (member)
   - qa_installer@test.local (member + installer)

### Option 2: SQL (Direct)

```sql
-- Run in test project SQL Editor

-- 1. Create company
INSERT INTO public.companies (name, created_at)
VALUES ('QA-TEST-2026', NOW())
RETURNING id;  -- Copy this ID

-- 2. Add members
INSERT INTO public.company_members (company_id, user_id, role, is_active)
SELECT 
  '[COMPANY_ID]'::uuid,
  u.id,
  CASE u.email
    WHEN 'qa_admin@test.local' THEN 'admin'
    WHEN 'qa_member1@test.local' THEN 'member'
    WHEN 'qa_installer@test.local' THEN 'member'
    ELSE 'member'
  END,
  true
FROM auth.users u
WHERE u.email LIKE 'qa_%@test.local';

-- 3. Verify
SELECT c.name, cm.role, u.email 
FROM companies c
JOIN company_members cm ON c.id = cm.company_id
JOIN auth.users u ON cm.user_id = u.id
WHERE c.name = 'QA-TEST-2026'
ORDER BY u.email;
```

---

## 📦 TEST DATA INITIALIZATION

### Phase 1: Create Core Test Data

```sql
-- These inserts create minimal data for testing
-- Run in test project ONLY

-- Company ID from previous step
\set COMPANY_ID '[UUID]'

-- Customers
INSERT INTO public.customers (company_id, name, phone, email, address)
VALUES
  (:'COMPANY_ID', 'QA-Customer-1', '5551234567', 'c1@test.local', 'Istanbul'),
  (:'COMPANY_ID', 'QA-Customer-2', '5559876543', 'c2@test.local', 'Ankara');

-- Suppliers
INSERT INTO public.suppliers (company_id, name, phone, email, address)
VALUES
  (:'COMPANY_ID', 'QA-Supplier-1', '5551111111', 's1@test.local', 'Supplier City'),
  (:'COMPANY_ID', 'QA-Supplier-2', '5552222222', 's2@test.local', 'Supplier City');

-- Products
INSERT INTO public.products (company_id, name, category, unit_type, description)
VALUES
  (:'COMPANY_ID', 'Single Pane', 'Glass', 'quantity', 'Single pane glass'),
  (:'COMPANY_ID', 'Double Pane', 'Glass', 'quantity', 'Double pane glass'),
  (:'COMPANY_ID', 'Custom Frame', 'Frame', 'area', 'Custom aluminum frame');

-- Staff/Installers
INSERT INTO public.employees (company_id, full_name, phone, target_role, commission_type, commission_quantity_rate, commission_area_rate)
VALUES
  (:'COMPANY_ID', 'QA-Installer-1', '5553333333', 'installer', 'quantity', 50, 0),
  (:'COMPANY_ID', 'QA-Installer-2', '5554444444', 'installer', 'area', 0, 80),
  (:'COMPANY_ID', 'QA-Installer-3', '5555555555', 'installer', 'hybrid', 50, 80);

-- Verify
SELECT 
  (SELECT COUNT(*) FROM customers WHERE company_id = :'COMPANY_ID') as customers_count,
  (SELECT COUNT(*) FROM suppliers WHERE company_id = :'COMPANY_ID') as suppliers_count,
  (SELECT COUNT(*) FROM products WHERE company_id = :'COMPANY_ID') as products_count,
  (SELECT COUNT(*) FROM employees WHERE company_id = :'COMPANY_ID') as employees_count;
```

### Phase 2: Create Test Orders (for later tests)

```typescript
// tests/setup/create-test-data.ts
// This runs as part of test setup

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function setupTestOrders(companyId: string) {
  // Create order 1: Quantity-based
  const order1 = await supabase
    .from('orders')
    .insert({
      company_id: companyId,
      customer_id: '[customer-1-id]',
      status: 'draft',
      total_amount: 5000,
      notes: 'Test order 1'
    })
    .select()
    .single();

  // Add order items
  await supabase
    .from('order_items')
    .insert([
      {
        order_id: order1.data.id,
        product_id: '[product-1-id]',
        qty: 5,
        unit_price: 500,
        supplier_id: '[supplier-1-id]',
        supplier_total_cost: 2500
      }
    ]);

  return order1.data.id;
}
```

---

## 🛡️ DATA ISOLATION STRATEGY

### Principle: Company-Based Filtering

All test queries MUST filter by company_id:

```typescript
// ✅ CORRECT - Only test company data
const orders = await supabase
  .from('orders')
  .select('*')
  .eq('company_id', testCompanyId);  // <-- THIS IS CRITICAL

// ❌ WRONG - Could return production data
const orders = await supabase
  .from('orders')
  .select('*');  // No filter!
```

### RLS Policy Verification

Before running tests, verify that test company can access data:

```sql
-- Test as qa_admin@test.local (should have admin role in QA-TEST-2026)

SELECT * FROM companies;  -- Should see QA-TEST-2026 only
SELECT * FROM orders;     -- Should see only QA-TEST-2026 orders
SELECT * FROM suppliers;  -- Should see only QA-TEST-2026 suppliers
```

If you see production data, **STOP** - RLS is broken.

---

## 🧹 CLEANUP & TEARDOWN

### Cleanup Strategy

```typescript
// tests/teardown.ts

export async function cleanupTestData(companyId: string) {
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // DELETE CASCADE via company_id
  // PostgreSQL will cascade delete:
  // companies → company_members
  //          → orders → order_items → supplier_transactions
  //          → suppliers → supplier_transactions
  //          → employees → installer_earnings → installer_transactions
  //          → etc.

  await supabase
    .from('companies')
    .delete()
    .eq('id', companyId);

  console.log(`✅ Cleaned up company ${companyId}`);
}
```

### Verify Cleanup

```sql
-- Run after tests complete
-- Should return 0 rows

SELECT COUNT(*) FROM orders WHERE company_id = '[TEST_COMPANY_ID]';
SELECT COUNT(*) FROM suppliers WHERE company_id = '[TEST_COMPANY_ID]';
SELECT COUNT(*) FROM customers WHERE company_id = '[TEST_COMPANY_ID]';
SELECT COUNT(*) FROM companies WHERE id = '[TEST_COMPANY_ID]';
```

---

## 🚨 SAFETY GUARDRAILS

### 1. Prevent Production Access

In `playwright.config.ts`:

```typescript
export default defineConfig({
  use: {
    baseURL: process.env.VITE_TEST_URL || 'http://localhost:5173',
    // FAIL if trying to connect to production
    trace: process.env.SUPABASE_PROJECT_ID?.includes('prod') ? 'never' : 'on-first-retry'
  }
});
```

### 2. Test Database Connection Check

```typescript
// tests/setup/verify-test-db.ts

export async function verifyTestDatabase() {
  const url = process.env.VITE_SUPABASE_URL;
  
  if (url?.includes('prod')) {
    throw new Error('❌ DANGEROUS: Trying to run tests on PRODUCTION database!');
  }
  
  if (!url?.includes('test')) {
    console.warn('⚠️  WARNING: Database URL does not contain "test". Verify this is correct.');
  }
  
  console.log('✅ Using test database:', url);
}
```

### 3. Prevent Accidental Production Deletes

```typescript
// Never allow broad DELETE without filtering
const dangerousDelete = async (table: string) => {
  throw new Error(`❌ DENIED: Cannot delete all rows from ${table}. Use .eq() to filter.`);
};
```

---

## 📋 PREFLIGHT CHECKLIST

Before running any tests, run this:

```bash
# 1. Verify .env.test exists and is not committed
ls -la .env.test
git status | grep env.test  # Should show in .gitignore

# 2. Verify test database is accessible
npx supabase status  # Check if pointing to test project

# 3. Run verification SQL in test project
# (Check if test company and users exist)

# 4. Compile TypeScript
npm run type-check

# 5. Verify fixtures work
npm test -- tests/fixtures  # Just check syntax

# 6. Final confirmation
echo "About to run tests on: $(grep VITE_SUPABASE_URL .env.test | cut -d= -f2)"
read -p "Is this the TEST database? (y/n)" confirm
if [ "$confirm" != "y" ]; then exit 1; fi

# 7. Run tests
npm test
```

---

## 🆘 TROUBLESHOOTING

### Problem: Tests see production data

**Cause:** Using wrong Supabase project or missing RLS filter

**Fix:**
```bash
# Verify .env.test
cat .env.test | grep SUPABASE_URL
# Should show test project URL

# Run this in Supabase SQL Editor (test project only)
SELECT 'TEST PROJECT' AS which_project;
```

### Problem: RLS denies access to test company

**Cause:** Test user not added to company_members

**Fix:**
```sql
-- Verify user is in company
SELECT * FROM company_members 
WHERE company_id = '[TEST_COMPANY_ID]'
AND user_id IN (
  SELECT id FROM auth.users WHERE email LIKE 'qa_%'
);

-- Should show rows for each test user. If empty, insert them.
```

### Problem: Old test data still exists

**Cause:** Cleanup didn't run or failed

**Fix:**
```bash
# Manual cleanup
npx ts-node tests/cleanup.ts

# Or delete via SQL
DELETE FROM companies WHERE name LIKE 'QA-TEST-%';
```

---

## ✅ FINAL VERIFICATION BEFORE RUNNING TESTS

```bash
#!/bin/bash

# Verify test environment
set -e

echo "🔍 Checking test environment..."

# 1. Check .env.test exists
if [ ! -f .env.test ]; then
  echo "❌ .env.test not found"
  exit 1
fi

# 2. Verify .env.test in .gitignore
if ! grep -q ".env.test" .gitignore; then
  echo "⚠️  WARNING: .env.test not in .gitignore!"
fi

# 3. Check no production URL in .env.test
if grep "prod.supabase.co" .env.test; then
  echo "❌ DANGER: Production URL found in .env.test"
  exit 1
fi

# 4. Verify test project has test users
echo "Checking test users exist..."
npm run supabase -- query 'SELECT COUNT(*) FROM auth.users WHERE email LIKE "qa_%"' > /dev/null 2>&1 || {
  echo "⚠️  Test users not found. Run setup SQL first."
}

# 5. Verify test company exists
echo "Checking test company exists..."
npm run supabase -- query 'SELECT COUNT(*) FROM companies WHERE name LIKE "QA-TEST-%"' > /dev/null 2>&1 || {
  echo "⚠️  Test company not found. Run setup SQL first."
}

echo "✅ Test environment verified!"
echo ""
echo "Ready to run tests with:"
echo "  npm test"
```

---

## 📚 REFERENCES

- [Supabase CLI Docs](https://supabase.com/docs/guides/cli)
- [Playwright Configuration](https://playwright.dev/docs/test-configuration)
- [Supabase RLS](https://supabase.com/docs/guides/auth/row-level-security)
- PerdePRO RLS Policies: `supabase_rls_hardening_critical.sql`
