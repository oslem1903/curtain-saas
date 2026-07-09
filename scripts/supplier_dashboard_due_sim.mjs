// ============================================================
// Dashboard "Tedarikçi Ödemeleri" kartı doğruluk simülasyonu
// ESKİ: vadeli borçların BRÜT tutarını toplar (ödemeleri düşmez)
// YENİ: tedarikçi başına NET bakiye (borç - ödeme - iptal), kalan
//       tutarla ve en erken vade ile gösterir.
//
// Çalıştır: node scripts/supplier_dashboard_due_sim.mjs
// ============================================================

function iso(daysFromToday) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return d.toISOString().slice(0, 10);
}

const todayStr = iso(0);
const weekEnd = iso(7);

// supplier_transactions örnek verisi
const supplierRows = [
  // S1: 1000 borç (gelecek hafta vadeli) + 600 ödeme  → kalan 400 (vadesi gelen)
  { supplier_id: "S1", suppliers: { name: "Kumaş A.Ş." }, transaction_type: "debt",    amount: 1000, due_date: iso(3) },
  { supplier_id: "S1", suppliers: { name: "Kumaş A.Ş." }, transaction_type: "payment", amount: 600,  due_date: null },
  // S2: 500 borç (dün vadeli, geciken), ödeme yok  → kalan 500 (geciken)
  { supplier_id: "S2", suppliers: { name: "Tül B." },     transaction_type: "debt",    amount: 500,  due_date: iso(-2) },
  // S3: 300 borç (gelecek hafta vadeli) + 300 ödeme  → kalan 0 (görünmemeli)
  { supplier_id: "S3", suppliers: { name: "Mekanizma C." }, transaction_type: "debt",  amount: 300,  due_date: iso(4) },
  { supplier_id: "S3", suppliers: { name: "Mekanizma C." }, transaction_type: "payment", amount: 300, due_date: null },
  // S4: 200 borç (VADESİZ), ödeme yok  → vade yok, karta girmez
  { supplier_id: "S4", suppliers: { name: "Aksesuar D." }, transaction_type: "debt",   amount: 200,  due_date: null },
];

const pickOne = (x) => (Array.isArray(x) ? x[0] : x);

// ---- ESKİ mantık (brüt dated debt) ----
function oldLogic(rows) {
  const dated = rows.filter((r) => r.transaction_type === "debt" && r.due_date != null);
  const supplierDueRows = dated
    .map((row) => ({ name: pickOne(row.suppliers)?.name || "Tedarikçi", amount: Number(row.amount ?? 0), due: row.due_date }))
    .filter((row) => row.amount > 0.01 && row.due);
  const due = supplierDueRows.filter((r) => r.due >= todayStr && r.due <= weekEnd);
  const overdue = supplierDueRows.filter((r) => r.due < todayStr);
  const total = [...due, ...overdue].reduce((s, r) => s + r.amount, 0);
  return { total, dueCount: due.length, overdueCount: overdue.length, rows: supplierDueRows };
}

// ---- YENİ mantık (net bakiye) — Dashboard.tsx ile birebir ----
function newLogic(rows) {
  const supplierAgg = new Map();
  for (const row of rows) {
    const sid = row.supplier_id;
    if (!sid) continue;
    const entry = supplierAgg.get(sid) ?? { name: pickOne(row.suppliers)?.name || "Tedarikçi", balance: 0, earliestDue: null };
    const amt = Number(row.amount ?? 0);
    if (row.transaction_type === "debt") entry.balance += amt;
    else if (row.transaction_type === "payment" || row.transaction_type === "cancel") entry.balance -= amt;
    if (row.transaction_type === "debt" && row.due_date) {
      if (!entry.earliestDue || row.due_date < entry.earliestDue) entry.earliestDue = row.due_date;
    }
    supplierAgg.set(sid, entry);
  }
  const supplierDueRows = Array.from(supplierAgg.values())
    .filter((e) => e.earliestDue && e.balance > 0.01)
    .map((e) => ({ name: e.name, amount: e.balance, due: e.earliestDue }));
  const due = supplierDueRows.filter((r) => r.due >= todayStr && r.due <= weekEnd);
  const overdue = supplierDueRows.filter((r) => r.due < todayStr);
  const total = [...due, ...overdue].reduce((s, r) => s + r.amount, 0);
  return { total, dueCount: due.length, overdueCount: overdue.length, rows: supplierDueRows };
}

const old = oldLogic(supplierRows);
const neu = newLogic(supplierRows);

const EXPECTED_TOTAL = 900; // S1 kalan 400 + S2 kalan 500
const EXPECTED_DUE = 1;     // S1
const EXPECTED_OVERDUE = 1; // S2

console.log("==================================================");
console.log(" DASHBOARD 'TEDARİKÇİ ÖDEMELERİ' KARTI TESTİ");
console.log("==================================================");
console.log("\nSenaryo:");
console.log("  S1: 1000 borç(vadeli) - 600 ödeme = 400 kalan  → vadesi gelen");
console.log("  S2:  500 borç(geciken) - 0       = 500 kalan  → geciken");
console.log("  S3:  300 borç(vadeli) - 300 ödeme = 0          → görünmemeli");
console.log("  S4:  200 borç(VADESİZ)                         → karta girmez");
console.log(`\n  Doğru toplam = ${EXPECTED_TOTAL} TL (geciken 1, vadesi gelen 1)`);

console.log(`\n--- ESKİ KOD (brüt) ---`);
console.log(`  Kart toplamı : ${old.total} TL  (geciken ${old.overdueCount}, vadesi gelen ${old.dueCount})`);
console.log(`  ${old.total === EXPECTED_TOTAL ? "DOĞRU" : `YANLIŞ ❌ (${old.total - EXPECTED_TOTAL} TL fazla gösteriyor)`}`);

console.log(`\n--- YENİ KOD (net) ---`);
console.log(`  Kart toplamı : ${neu.total} TL  (geciken ${neu.overdueCount}, vadesi gelen ${neu.dueCount})`);
neu.rows.forEach((r) => console.log(`     • ${r.name}: ${r.amount} TL (vade ${r.due})`));

const pass =
  neu.total === EXPECTED_TOTAL &&
  neu.dueCount === EXPECTED_DUE &&
  neu.overdueCount === EXPECTED_OVERDUE &&
  !neu.rows.some((r) => r.name === "Mekanizma C.") && // S3 net 0 → yok
  !neu.rows.some((r) => r.name === "Aksesuar D.");    // S4 vadesiz → yok

console.log("\n==================================================");
console.log(` Eski kod hatalı mı : ${old.total !== EXPECTED_TOTAL ? "EVET (şişiriyor)" : "HAYIR"}`);
console.log(` Yeni kod doğru mu  : ${pass ? "EVET" : "HAYIR"}`);
console.log("==================================================");
console.log(pass ? "\n✅ PASS: Kart artık kalan (net) tedarikçi borcunu doğru gösteriyor." : "\n❌ FAIL: Beklenen değerler tutmadı.");
process.exit(pass ? 0 : 1);
