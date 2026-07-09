# PerdePRO - E2E QA TEST PLAN
**Version:** 1.0  
**Date:** 2026-07-07  
**Scope:** Order-to-Cash Flow + RLS Security + Dashboard Accuracy

---

## 📋 PART 1: MANUAL QA CHECKLIST

### 1. SIPARIŞ OLUŞTURMA (Order Creation)

| # | Scenario | Steps | Expected | Status |
|---|----------|-------|----------|--------|
| 1.1 | Yeni sipariş oluştur | Dashboard → Siparişler → Yeni Sipariş | Order form açılsın | [ ] |
| 1.2 | Müşteri seç | Müşteri dropdown'ından seç | Müşteri bilgileri doldursun | [ ] |
| 1.3 | Ürün ekle (adet bazlı) | Ürün seç, qty gir, fiyat otomatik | order_items record created | [ ] |
| 1.4 | Ürün ekle (m² bazlı) | Ürün seç, area_m2 gir, fiyat otomatik | order_items record with area_m2 | [ ] |
| 1.5 | Tedarikçi atama | order_item'a supplier_id ata | supplier_total_cost hesaplansın | [ ] |
| 1.6 | Sipariş kaydet | Kaydet butonuna tıkla | Order ID generate, status='draft' | [ ] |
| 1.7 | Sipariş durumunu güncelle | Status → 'confirmed' | Order log updated | [ ] |
| 1.8 | Silinen sipariş restore | Soft delete test | Order recoverable? | [ ] |

**Pass Criteria:** Tüm 8 step başarılı

---

### 2. TEKLIFTEN SIPARIŞE (Quote to Order)

| # | Scenario | Steps | Expected | Status |
|---|----------|-------|----------|--------|
| 2.1 | Teklif oluştur | Teklifler → Yeni → form doldur | Quote ID generate | [ ] |
| 2.2 | Teklif detaylarını gir | Müşteri + ürün + fiyat | Quote record create | [ ] |
| 2.3 | Tekliften sipariş oluştur | "Siparişe Çevir" button | Order created, Quote linked | [ ] |
| 2.4 | Quote status güncelle | Status → 'converted' | Quote.status = 'converted' | [ ] |
| 2.5 | Order items otomatik kopyalan | Quote items → Order items | Item count match | [ ] |
| 2.6 | Fiyatlar doğru kopyalansın | Quote price = Order price | Prices identical | [ ] |

**Pass Criteria:** Quote → Order conversion seamless

---

### 3. TEDARIKÇI CARI (Supplier Ledger - FAZ 1)

| # | Scenario | Steps | Expected | Status |
|---|----------|-------|----------|--------|
| 3.1 | Borç otomatik oluştur | Order item create + supplier | supplier_transactions INSERT | [ ] |
| 3.2 | Borç tutarı doğru | supplier_total_cost = debt amount | Amount matches order_item cost | [ ] |
| 3.3 | Cari özeti görüntüle | Suppliers → Supplier → Ledger | Total Debt, Paid, Balance | [ ] |
| 3.4 | Ödeme kaydı | Payment button → Ödeme Tut | supplier_transactions INSERT (payment) | [ ] |
| 3.5 | Bakiye doğru hesaplansın | Debt - Payment = Balance | Math correct | [ ] |
| 3.6 | Sıfırlanmış borç | Balance = 0 | Ledger cleared | [ ] |
| 3.7 | Tedarikçi sil | Supplier delete | supplier_transactions cancelled | [ ] |
| 3.8 | RLS: Başka şirket borç göremez | Company B user → Supplier (Company A) | Access Denied (or no data) | [ ] |

**Pass Criteria:** Supplier cari isolate ve accurate

---

### 4. MONTAJCI CARI (Installer Ledger - FAZ 2)

| # | Scenario | Steps | Expected | Status |
|---|----------|-------|----------|--------|
| 4.1 | Hakediş ayarlarını kur | Staff → Installer → commission_type | commission_type saved | [ ] |
| 4.2 | Adet bazlı hakediş | commission_type='quantity', rate=50 | Earnings = qty × 50 | [ ] |
| 4.3 | m² bazlı hakediş | commission_type='area', rate=80 | Earnings = area × 80 | [ ] |
| 4.4 | Hibrit hakediş | commission_type='hybrid' | Earnings = (qty × 50) + (area × 80) | [ ] |
| 4.5 | Montaj tamamlanınca hakediş | Installation job status='completed' | installer_earnings INSERT auto | [ ] |
| 4.6 | Cari özeti | Installer → Earnings detail page | Total, Paid, Balance | [ ] |
| 4.7 | Ödeme kaydı | Payment → Installer payment | installer_transactions INSERT | [ ] |
| 4.8 | Bakiye doğru | Earnings - Payment | Math correct | [ ] |
| 4.9 | Montaj silince hakediş iptal | Job delete | installer_transactions adjustment (negative) | [ ] |
| 4.10 | RLS: Başka montajcı bakiye göremez | Installer B → Installer A earnings | Access Denied | [ ] |

**Pass Criteria:** Automatic earnings, accurate ledger, RLS isolated

---

### 5. TAHSILAT / ÖDEME (Payment Collection)

| # | Scenario | Steps | Expected | Status |
|---|----------|-------|----------|--------|
| 5.1 | Sipariş ödemesi kaydet | Order → Payment → Tut | payment record + transaction | [ ] |
| 5.2 | Tedarikçi ödemesi kaydet | Supplier cari → Ödeme → Tut | supplier_transaction (payment) | [ ] |
| 5.3 | Montajcı ödemesi kaydet | Installer earnings → Ödeme → Tut | installer_transaction (payment) | [ ] |
| 5.4 | Kısmi ödeme | Payment < Total owed | Balance remaining correct | [ ] |
| 5.5 | Fazla ödeme | Payment > Total owed | Negative balance? (test policy) | [ ] |
| 5.6 | Ödeme yöntemi kaydı | Payment method (cash/transfer/etc) | Method stored + visible | [ ] |
| 5.7 | Ödeme tarihi | Payment date = today (default) | Date correct | [ ] |

**Pass Criteria:** All payment flows record correctly

---

### 6. DASHBOARD RAKAMLAARI (Dashboard Numbers Accuracy)

| # | Scenario | Steps | Expected | Status |
|---|----------|-------|----------|--------|
| 6.1 | Toplam sipariş tutarı | Dashboard → Orders sum | Sum = SUM(orders.total_amount) | [ ] |
| 6.2 | Beklemede olan sipariş | Dashboard → Pending orders | Count correct | [ ] |
| 6.3 | Tamamlanan montaj | Dashboard → Completed installations | Count correct | [ ] |
| 6.4 | Tahsil edilen para | Dashboard → Total collected | SUM(payments) correct | [ ] |
| 6.5 | Ödenmemiş bordro | Dashboard → Pending supplier payments | SUM(debt) correct | [ ] |
| 6.6 | Montajcı bakiye | Dashboard → Installer earnings - payments | Calculation correct | [ ] |
| 6.7 | Dashboard refresh | Tab switch → dashboard | Numbers updated (no stale cache) | [ ] |

**Pass Criteria:** All dashboard metrics accurate

---

### 7. RLS - ROLE ISOLATION

#### 7.1 SUPER_ADMIN

| # | Scenario | Steps | Expected | Status |
|---|----------|-------|----------|--------|
| SA-1 | Tüm şirketleri görür | Queries | companies/orders/suppliers: ALL rows | [ ] |
| SA-2 | Tüm şirketleri yönetir | Create/Update/Delete | All modifications allowed | [ ] |
| SA-3 | Super admin dashboard | Dashboard | All metrics aggregated | [ ] |
| SA-4 | Impersonate ability | Admin panel → Impersonate | Switch to other user context | [ ] |

#### 7.2 COMPANY_ADMIN

| # | Scenario | Steps | Expected | Status |
|---|----------|-------|----------|--------|
| CA-1 | Kendi şirketi görür | Orders query | Only own company_id rows | [ ] |
| CA-2 | Diğer şirketi göremez | Suppliers query (other company) | Empty result OR 403 | [ ] |
| CA-3 | Kendi şirketi yazabilir | Create order | INSERT allowed | [ ] |
| CA-4 | Diğer şirketi yazamaz | Try create for other company | INSERT denied | [ ] |
| CA-5 | Kendi şirketi siler | Delete order (own) | DELETE allowed | [ ] |
| CA-6 | Diğer şirketi silemez | Delete order (other) | DELETE denied | [ ] |
| CA-7 | Staff yönetme | Employees create/update | Only own company | [ ] |

#### 7.3 COMPANY_MEMBER

| # | Scenario | Steps | Expected | Status |
|---|----------|-------|----------|--------|
| CM-1 | Kendi şirketi okur | Orders select | SELECT allowed | [ ] |
| CM-2 | Başka şirketi göremez | Suppliers (other company) | No access | [ ] |
| CM-3 | Yazamaz (readonly) | Try create order | INSERT denied | [ ] |
| CM-4 | Silemez | Try delete order | DELETE denied | [ ] |
| CM-5 | Installer earnings okur (kendi) | View own earnings | SELECT allowed | [ ] |
| CM-6 | Başka installer earnings göremez | View other installer | SELECT denied | [ ] |

#### 7.4 ANONYMOUS / UNAUTHENTICATED

| # | Scenario | Steps | Expected | Status |
|---|----------|-------|----------|--------|
| ANON-1 | Hiçbir tablo göremez | Any SELECT | Access denied (401/403) | [ ] |
| ANON-2 | Yazar | Try INSERT | Denied | [ ] |
| ANON-3 | Login sayfası erişilir | /login | Page loads | [ ] |
| ANON-4 | Protected route yönlendir | /orders | Redirect to /login | [ ] |

**Pass Criteria:** All role isolation working

---

## 🎭 TEST DATA SETUP

### TEST ŞIRKETI (ISOLATED)
```
Company: "QA-TEST-2026"
  ├─ super_admin: qa_super@test.local (can impersonate others)
  ├─ admin: qa_admin@test.local (full write)
  ├─ member1: qa_member1@test.local (readonly)
  ├─ member2: qa_member2@test.local (readonly)
  └─ installer: qa_installer@test.local
```

### TEST VERİ
```
Customers (QA-TEST-2026):
  ├─ QA-Customer-1 (residential)
  └─ QA-Customer-2 (commercial)

Suppliers (QA-TEST-2026):
  ├─ QA-Supplier-1 (glass, 500₺/box)
  └─ QA-Supplier-2 (frames, 1000₺/unit)

Staff/Installers (QA-TEST-2026):
  ├─ QA-Installer-1 (quantity, 50₺/unit)
  ├─ QA-Installer-2 (area, 80₺/m²)
  └─ QA-Installer-3 (hybrid)

Products (QA-TEST-2026):
  ├─ Single Pane (glass, adet)
  ├─ Double Pane (glass, adet)
  └─ Custom Frame (m²)
```

### ISOLATION GUARANTEE
- Test şirketi dışında veri READ/WRITE yok
- Existing production şirketlere erişim yok
- Test bitince cleanup (DELETE cascade via company_id)

---

## 🧪 PLAYWRIGHT TEST STRUCTURE

### Directory Structure
```
tests/
├── fixtures/
│   ├── auth.fixtures.ts (login/logout helpers)
│   ├── test-data.fixtures.ts (company/user/order setup)
│   └── api.fixtures.ts (direct DB inserts for setup)
├── specs/
│   ├── 1-order-creation.spec.ts
│   ├── 2-quote-to-order.spec.ts
│   ├── 3-supplier-ledger.spec.ts
│   ├── 4-installer-ledger.spec.ts
│   ├── 5-payments.spec.ts
│   ├── 6-dashboard.spec.ts
│   └── 7-rls-security.spec.ts
├── helpers/
│   ├── navigation.ts (route helpers)
│   ├── assertions.ts (custom matchers)
│   └── reporting.ts (failure screenshots/logs)
└── playwright.config.ts
```

### TEST FLOW

**Setup Phase:**
1. Create test company "QA-TEST-2026" (IF NOT EXISTS)
2. Create test users (qa_admin, qa_member1, qa_installer)
3. Create test data (customers, suppliers, products)
4. VERIFY: RLS policies allow test company access

**Test Phases:**
1. **Smoke Tests** - Can login, navigate, create records
2. **Functional Tests** - Order/Payment/Ledger flows work
3. **Calculation Tests** - Totals, balances, commissions accurate
4. **RLS Tests** - Role isolation enforced
5. **Regression Tests** - Dashboard, filters, export

**Teardown Phase:**
1. Delete test company (CASCADE)
2. Verify no test data remains
3. Generate report

---

## 🔴 FAILURE REPORTING TEMPLATE

When test fails, report:

```
=== TEST FAILURE REPORT ===
Test ID: [e.g., 1.3-order-creation]
Scenario: [e.g., "Add order item with quantity"]
User Role: [qa_admin / qa_member1 / super_admin]
Company: QA-TEST-2026

STEPS TO REPRODUCE:
1. Login as [role]
2. Navigate to [/orders/new]
3. [action that failed]

EXPECTED:
[expected outcome]

ACTUAL:
[what happened instead]

ERROR MESSAGE:
[console error or assertion failure]

SCREENSHOT:
[saved to tests/screenshots/failure-[timestamp].png]

DATABASE STATE:
- Query: SELECT * FROM orders WHERE id = '[failed order id]'
- Result: [actual DB record]

RELATED OBJECTS:
- Order ID: [uuid]
- Customer ID: [uuid]
- Supplier ID: [if applicable]

SEVERITY:
[ ] CRITICAL (blocks functionality)
[ ] HIGH (major feature broken)
[ ] MEDIUM (workaround exists)
[ ] LOW (edge case)
```

---

## 📊 TEST EXECUTION CHECKLIST

- [ ] Test company "QA-TEST-2026" created
- [ ] All test users created and verified
- [ ] Test data (customers/suppliers/staff) created
- [ ] RLS policies verified (test company can access)
- [ ] Playwright config ready
- [ ] Smoke tests pass
- [ ] All 7 spec groups executed
- [ ] No failures, or all failures documented
- [ ] Test data cleanup successful
- [ ] Report generated
- [ ] Screenshots/videos available

---

## 🚫 WHAT NOT TO DO

❌ Don't touch production company data  
❌ Don't run tests against production database  
❌ Don't delete test company mid-run  
❌ Don't use real email addresses (use test@test.local)  
❌ Don't assume RLS prevents access (test it explicitly)  
❌ Don't skip teardown  

---

## ✅ SUCCESS CRITERIA

- All 7 manual checklist sections PASS
- All Playwright specs PASS (0 failures)
- RLS isolation verified for all 4 roles
- Dashboard numbers match database
- Payment/ledger calculations accurate
- Test data fully cleaned up
- No production data modified

**When ALL pass: Ready for production deployment**

---

## 📅 TIMELINE

| Phase | Task | Duration |
|-------|------|----------|
| Setup | Create test infrastructure | 1 hour |
| Manual QA | Run 40+ checklist items | 3-4 hours |
| Playwright | Write + run specs | 4-6 hours |
| RLS Verification | Security testing | 2-3 hours |
| Reporting | Document results | 1 hour |
| **TOTAL** | | **11-15 hours** |

---

## 📝 NOTES

1. **Supabase Test User Setup:**
   - Use test email domain (@test.local)
   - Store credentials in .env.test
   - Rotate credentials monthly

2. **Local Testing:**
   - Run against local Supabase (docker) if available
   - Fallback: test project (separate from prod)

3. **CI/CD Integration:**
   - Run on every PR
   - Fail if any spec fails
   - Archive screenshots/videos

4. **Production Safety:**
   - Test database ≠ Production database
   - No data synchronization between environments
   - Test data isolated by company_id filtering
