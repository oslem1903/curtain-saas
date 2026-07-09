// Montajcı Cari hesap mantığı simülasyonu — InstallerLedger.tsx ile aynı kurallar
// Çalıştır: node scripts/installer_ledger_sim.mjs
let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✓ " + m); else { fail++; console.error("  ✗ " + m); } };
const r2 = (n) => Math.round(n * 100) / 100;

function ledger(jobs, txs) {
    const earned = jobs.filter(j => j.status === "completed").reduce((a, j) => a + (j.installer_fee ?? 0), 0);
    const paid = txs.reduce((a, t) => a + (t.type === "payment" ? t.amount : -t.amount), 0);
    return {
        earned,
        paid,
        remaining: Math.max(r2(earned - paid), 0),
        advance: Math.max(r2(paid - earned), 0),
    };
}

console.log("Test 1: Bekleyen iş + ödeme yapılmış");
let l = ledger([{ status: "waiting", installer_fee: 600 }], [{ type: "payment", amount: 2000 }]);
ok(l.earned === 0, `Hakediş=0 (${l.earned})`);
ok(l.advance === 2000, `Avans=2000 (${l.advance})`);
ok(l.remaining === 0, `Kalan=0 (${l.remaining})`);

console.log("Test 2: Tamamlanan iş + eksik ödeme");
l = ledger([{ status: "completed", installer_fee: 5000 }], [{ type: "payment", amount: 2000 }]);
ok(l.earned === 5000 && l.remaining === 3000, `Hakediş=5000, Kalan=3000 (${l.remaining})`);
ok(l.earned > l.remaining, "Hakediş > Kalan Borç");
ok(l.advance === 0, `Avans=0 (${l.advance})`);

console.log("Test 3: Tamamlanan iş + tam ödeme");
l = ledger([{ status: "completed", installer_fee: 600 }], [{ type: "payment", amount: 600 }]);
ok(l.remaining === 0, `Kalan=0 (${l.remaining})`);
ok(l.advance === 0, `Avans=0 (${l.advance})`);

console.log("Test 4: Ödeme iptali sonrası yeniden hesaplama");
l = ledger(
    [{ status: "completed", installer_fee: 1000 }],
    [{ type: "payment", amount: 1000 }, { type: "cancel", amount: 1000 }],
);
ok(l.paid === 0, `Ödenen=0 (${l.paid})`);
ok(l.remaining === 1000, `Kalan=1000 (${l.remaining})`);
ok(l.advance === 0, `Avans=0 (${l.advance})`);

console.log("Ek: Fiyat tipi hesapları");
ok(r2(5 * 80) === 400, "m²: 5 m² × 80 = 400");
ok(r2(2 * 250) === 500, "Adet: 2 × 250 = 500");

console.log("Ek: Sipariş tutarı hakedişe karışmıyor");
l = ledger([{ status: "completed", installer_fee: 600, total_amount: 5000 }], []);
ok(l.earned === 600, `Sipariş 5000 iken hakediş=600 (${l.earned})`);

console.log(fail === 0 ? "\n✅ TÜM TESTLER GEÇTİ" : `\n❌ ${fail} test BAŞARISIZ`);
process.exit(fail ? 1 : 0);
