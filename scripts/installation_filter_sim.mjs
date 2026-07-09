// Montaj Takibi filtre mantığı simülasyonu — InstallationTracking.tsx ile aynı kurallar
let fail = 0;
const ok = (c, m) => { if (c) console.log("  ✓ " + m); else { fail++; console.error("  ✗ " + m); } };

function filterRows(rows, { statusFilter = "all", showCompleted = true } = {}) {
    return rows.filter((row) => {
        const completedExplicitlyRequested = statusFilter === "completed";
        if (!showCompleted && !completedExplicitlyRequested && row.status === "completed") return false;
        const matchesStatus = statusFilter === "all" || row.status === statusFilter;
        return matchesStatus;
    });
}

const completedJob = { id: "1", status: "completed" };
const waitingJob = { id: "2", status: "waiting" };

console.log("Test 1: Tamamlandı + filtre 'Montaj Tamamlandı'");
let r = filterRows([completedJob, waitingJob], { statusFilter: "completed", showCompleted: true });
ok(r.length === 1 && r[0].id === "1", "İş listede görünüyor");

console.log("Test 2: Tamamlanan iş + filtre 'Tüm Durumlar' (varsayılan checkbox açık)");
r = filterRows([completedJob, waitingJob], { statusFilter: "all", showCompleted: true });
ok(r.some((x) => x.id === "1"), "İş listede görünüyor");

console.log("Test 3: 'Tamamlananları göster' KAPALI + filtre 'Montaj Tamamlandı'");
r = filterRows([completedJob, waitingJob], { statusFilter: "completed", showCompleted: false });
ok(r.length === 1 && r[0].id === "1", "Filtre öncelikli — kayıt yine görünüyor");

console.log("Test 4: Tamamlandı → Bekliyor (hakediş senkronu)");
const earned = (jobs) => jobs.filter((j) => j.status === "completed").reduce((a, j) => a + (j.fee ?? 0), 0);
let jobs = [{ status: "completed", fee: 600 }];
ok(earned(jobs) === 600, "Tamamlandı iken hakediş=600");
jobs[0].status = "waiting";
ok(earned(jobs) === 0, "Bekliyor'a dönünce hakediş=0 (otomatik yeniden hesap)");

console.log(fail === 0 ? "\n✅ TÜM TESTLER GEÇTİ" : `\n❌ ${fail} test BAŞARISIZ`);
process.exit(fail ? 1 : 0);
