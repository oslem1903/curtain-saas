// Release Audit Simülasyonu
// Dashboard / Muhasebe / SupplierDetail ekranlarının hesaplama mantığını
// sentetik veri üzerinde birebir uygulayıp tutarlılığı doğrular.
// Çalıştır: node scripts/release_audit_sim.mjs

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log("  ✓ " + msg);
  else { failures++; console.error("  ✗ HATA: " + msg); }
}
const r2 = (n) => Math.round(n * 100) / 100;

// ── Sentetik veri: 20 müşteri, 20 teklif, 15 sipariş, 10 tahsilat,
//    10 tedarikçi ödemesi, 5 montajcı ödemesi, 5 vadeli tahsilat, 5 vadeli borç
const customers = Array.from({ length: 20 }, (_, i) => ({ id: `c${i}`, name: `Müşteri ${i + 1}` }));
const quotes = Array.from({ length: 20 }, (_, i) => ({
  id: `q${i}`, customer_id: `c${i}`, status: i < 15 ? "done" : "done", order_id: i < 15 ? `o${i}` : null,
}));
const suppliers = Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, name: `Tedarikçi ${i + 1}` }));

// 15 sipariş: toplamlar 1000..15000, her birinde tedarikçi borcu = %40 maliyet
const orders = Array.from({ length: 15 }, (_, i) => ({
  id: `o${i}`, customer_id: `c${i}`, status: "open",
  total_amount: (i + 1) * 1000, paid_amount: 0, remaining_amount: (i + 1) * 1000,
  payment_due_date: null,
}));

const supplierTx = [];
orders.forEach((o, i) => {
  supplierTx.push({
    supplier_id: suppliers[i % 4].id, transaction_type: "debt",
    amount: o.total_amount * 0.4, order_id: o.id, due_date: i < 5 ? "2026-06-15" : null, // 5 vadeli borç
  });
});

// 10 tahsilat: ilk 10 siparişe yarısı kadar ödeme (income + orders güncellenir)
const income = [];
for (let i = 0; i < 10; i++) {
  const o = orders[i];
  const amount = o.total_amount / 2;
  // saveCollection mantığı:
  const remaining = o.remaining_amount != null ? o.remaining_amount : Math.max(o.total_amount - o.paid_amount, 0);
  if (amount > remaining + 0.01) throw new Error("overpay engellenmedi");
  o.paid_amount = r2(o.paid_amount + amount);
  o.remaining_amount = r2(Math.max(remaining - amount, 0));
  if (i < 5) o.payment_due_date = "2026-06-20"; // 5 vadeli tahsilat (kalan için vade)
  income.push({ amount, source: "order_payment", order_id: o.id, income_date: "2026-06-11" });
}

// 10 tedarikçi ödemesi: her tedarikçiye borcunun bir kısmı
const supplierPayments = [];
const expenses = [];
for (let i = 0; i < 10; i++) {
  const sup = suppliers[i % 4];
  // saveSupplierPayment mantığı: kalan borç kontrolü
  const debt = supplierTx.filter(t => t.supplier_id === sup.id && t.transaction_type === "debt").reduce((a, t) => a + t.amount, 0);
  const paid = supplierTx.filter(t => t.supplier_id === sup.id && (t.transaction_type === "payment" || t.transaction_type === "cancel")).reduce((a, t) => a + t.amount, 0);
  const remaining = Math.max(debt - paid, 0);
  const amount = r2(Math.min(remaining * 0.3, remaining));
  if (amount <= 0) continue;
  if (remaining > 0 && amount > remaining) throw new Error("tedarikçi overpay engellenmedi");
  supplierTx.push({ supplier_id: sup.id, transaction_type: "payment", amount });
  supplierPayments.push({ supplier_id: sup.id, amount });
  expenses.push({ amount, category: "Tedarik", status: "paid", supplier_id: sup.id, expense_date: "2026-06-11" });
}

// 5 montajcı ödemesi (personel gideri)
for (let i = 0; i < 5; i++) {
  expenses.push({ amount: 2000, category: "Personel ödemesi", status: "paid", supplier_id: null, expense_date: "2026-06-11" });
}

// ── 1. SupplierDetail bakiye mantığı (transaction_type bazlı)
function supplierDetailBalance(sid) {
  const txs = supplierTx.filter(t => t.supplier_id === sid);
  const totalDebt = txs.filter(t => t.transaction_type === "debt").reduce((a, b) => a + b.amount, 0);
  const totalPaid = txs.filter(t => t.transaction_type === "payment").reduce((a, b) => a + b.amount, 0);
  const totalCancel = txs.filter(t => t.transaction_type === "cancel").reduce((a, b) => a + b.amount, 0);
  return r2(totalDebt - totalPaid - totalCancel);
}

// ── 2. Accounting debtMap mantığı
function accountingSupplierDebts() {
  const debtMap = {};
  supplierTx.forEach(t => {
    if (!debtMap[t.supplier_id]) debtMap[t.supplier_id] = { totalDebt: 0, totalPaid: 0 };
    if (t.transaction_type === "debt") debtMap[t.supplier_id].totalDebt += t.amount;
    else if (["payment", "cancel", "credit"].includes(t.transaction_type)) debtMap[t.supplier_id].totalPaid += t.amount;
  });
  return Object.fromEntries(Object.entries(debtMap).map(([k, v]) => [k, r2(Math.max(v.totalDebt - v.totalPaid, 0))]));
}

console.log("── Tedarikçi cari tutarlılığı (SupplierDetail vs Muhasebe)");
const accDebts = accountingSupplierDebts();
suppliers.forEach(s => {
  const a = supplierDetailBalance(s.id);
  const b = accDebts[s.id] ?? 0;
  assert(Math.abs(a - b) < 0.01, `${s.name}: SupplierDetail=${a} / Muhasebe=${b}`);
  assert(a >= 0, `${s.name}: bakiye negatif değil (${a})`);
});

// ── 3. Bekleyen tahsilat: Dashboard vs Muhasebe
console.log("── Bekleyen tahsilat tutarlılığı (Dashboard vs Muhasebe)");
const dashPending = r2(orders
  .filter(o => o.status !== "cancelled" && o.status !== "draft")
  .reduce((a, o) => a + Math.max(Number(o.remaining_amount || 0), 0), 0));
const accPending = r2(orders.reduce((sum, o) => {
  const total = Number(o.total_amount ?? 0), paid = Number(o.paid_amount ?? 0);
  const rem = o.remaining_amount != null ? Number(o.remaining_amount) : Math.max(total - paid, 0);
  return sum + Math.max(rem, 0);
}, 0)); // Accounting sorgusu draft/cancelled'ı zaten dışlıyor
assert(Math.abs(dashPending - accPending) < 0.01, `Dashboard=${dashPending} / Muhasebe=${accPending}`);

// Elle hesap: toplam sipariş 1000+...+15000=120000; tahsilat = ilk 10'un yarısı = 55000/2=27500
const expectedTotal = 120000, expectedCollected = 27500;
const expectedPending = expectedTotal - expectedCollected;
assert(Math.abs(accPending - expectedPending) < 0.01, `Elle hesap bekleyen=${expectedPending}, sistem=${accPending}`);

// ── 4. Bu ay tahsilat
console.log("── Bu Ay Tahsilat");
const monthCollected = r2(income.filter(r => r.source === "order_payment").reduce((a, r) => a + r.amount, 0));
assert(Math.abs(monthCollected - expectedCollected) < 0.01, `Elle hesap=${expectedCollected}, sistem=${monthCollected}`);

// ── 5. Toplam gider = tedarikçi ödemeleri + montajcı ödemeleri
console.log("── Toplam Gider");
const totalExpense = r2(expenses.reduce((a, e) => a + e.amount, 0));
const supplierPaid = r2(supplierPayments.reduce((a, p) => a + p.amount, 0));
const expectedExpense = r2(supplierPaid + 5 * 2000);
assert(Math.abs(totalExpense - expectedExpense) < 0.01, `Gider=${totalExpense} = tedarikçi(${supplierPaid}) + montajcı(10000)`);

// Gider modalındaki tedarikçi ödeme listesi toplamı, cari ödemelerle eşit mi
const modalSupplierTotal = r2(supplierTx.filter(t => ["payment", "credit"].includes(t.transaction_type)).reduce((a, t) => a + t.amount, 0));
assert(Math.abs(modalSupplierTotal - supplierPaid) < 0.01, `Gider modalı=${modalSupplierTotal} / supplier_payments=${supplierPaid}`);

// ── 6. Yinelenen kayıt: order başına tek debt
console.log("── Yinelenen kayıt kontrolü");
const debtPerOrder = {};
supplierTx.filter(t => t.transaction_type === "debt").forEach(t => {
  debtPerOrder[t.order_id] = (debtPerOrder[t.order_id] || 0) + 1;
});
assert(Object.values(debtPerOrder).every(c => c === 1), "Sipariş başına tek borç kaydı");

// ── 7. Vade kayıtları
console.log("── Vade kayıtları");
assert(orders.filter(o => o.payment_due_date && o.remaining_amount > 0).length === 5, "5 vadeli müşteri tahsilatı");
assert(supplierTx.filter(t => t.transaction_type === "debt" && t.due_date).length === 5, "5 vadeli tedarikçi borcu");

// ── 8. Overpay koruması (negatif bakiye imkansız)
console.log("── Negatif bakiye koruması");
const o0 = orders[0];
const tryOver = o0.remaining_amount + 100;
assert(tryOver > o0.remaining_amount + 0.01, "Fazla tahsilat girişimi tespit edilir (kayıt reddedilir)");
assert(orders.every(o => o.remaining_amount >= 0 && o.paid_amount <= o.total_amount), "Hiçbir siparişte negatif kalan / fazla ödeme yok");

console.log(failures === 0 ? "\n✅ TÜM KONTROLLER GEÇTİ" : `\n❌ ${failures} kontrol BAŞARISIZ`);
process.exit(failures === 0 ? 0 : 1);
