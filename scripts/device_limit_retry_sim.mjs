// ============================================================
// Cihaz limiti "Tekrar Dene" senkronizasyon simülasyonu
// AuthContext.loadAuth lisans-cache mantığını + sunucu RPC
// register_device_and_touch_login kararını birebir modeller.
//
// Amaç: Süper Admin limiti artırdıktan sonra, kullanıcı YENİDEN
// GİRİŞ YAPMADAN sadece "Tekrar Dene" ile erişebiliyor mu?
//
// Çalıştır:  node scripts/device_limit_retry_sim.mjs
// ============================================================

// ---- Sunucu durumu (companies + company_devices) ----
function makeServer() {
  return {
    company: { id: "C1", max_devices: 1, is_active: true, plan_status: "active", is_pilot: false },
    devices: [], // { company_id, device_id, is_active }
  };
}

// register_device_and_touch_login RPC (SQL ile birebir mantık)
function serverRpc(server, deviceId) {
  const c = server.company;
  if (c.is_active === false || String(c.plan_status).toLowerCase() === "suspended") return "suspended";
  // (trial/expired kontrolü bu senaryo için geçersiz — atlanıyor)

  const existing = server.devices.find((d) => d.company_id === c.id && d.device_id === deviceId);
  const activeCount = () => server.devices.filter((d) => d.company_id === c.id && d.is_active).length;

  if (existing) {
    if (existing.is_active === false) {
      if (activeCount() >= c.max_devices) return "device_limit";
    }
    existing.is_active = true;
    return "ok";
  } else {
    if (activeCount() >= c.max_devices) return "device_limit"; // satır INSERT'ten ÖNCE → kayıt eklenmez
    server.devices.push({ company_id: c.id, device_id: deviceId, is_active: true });
    return "ok";
  }
}

// Süper Admin: super_admin_set_company_device_limit
function superAdminSetLimit(server, n) {
  server.company.max_devices = n;
}

// ---- İstemci (bir cihazın AuthContext örneği) ----
function makeClient(server, deviceId, { forceOnRetry }) {
  return {
    server,
    deviceId,
    forceOnRetry, // true = düzeltilmiş kod, false = eski kod
    hasLoadedOnce: false,
    licenseCheckCache: null,
    licenseCheckTime: 0,
  };
}

// AuthContext.loadAuth (sadece lisans/cihaz bloğu)
function loadAuth(client, clockMs, opts = {}) {
  const isFirstLoad = !client.hasLoadedOnce;
  const cacheAge = clockMs - client.licenseCheckTime;
  const shouldRefreshLicense = !isFirstLoad && cacheAge > 5 * 60 * 1000;

  // ⬇️ Düzeltmenin kalbi: opts.forceLicense cache'i baypas eder
  if (isFirstLoad || shouldRefreshLicense || opts.forceLicense) {
    const result = serverRpc(client.server, client.deviceId);
    client.licenseCheckCache = result;
    client.licenseCheckTime = clockMs;
  }

  const cached = client.licenseCheckCache;
  client.hasLoadedOnce = true;
  if (cached === "device_limit") return "locked";
  if (cached === "suspended" || cached === "expired") return "locked";
  return "ready";
}

// refreshAuth: eski kod = loadAuth(), yeni kod = loadAuth({forceLicense:true})
function refreshAuth(client, clockMs) {
  return loadAuth(client, clockMs, { forceLicense: client.forceOnRetry });
}

// ---- Senaryo ----
function runScenario({ forceOnRetry, label }) {
  const server = makeServer();
  let clock = 0;

  // 1) Cihaz limiti = 1 (varsayılan). Cihaz A giriş yapar → kayıtlı, aktif.
  const deviceA = makeClient(server, "DEVICE_A", { forceOnRetry });
  const aState = loadAuth(deviceA, clock); // ready, A kayıtlı
  clock += 5000;

  // 2) İkinci cihaz (B) giriş dener → limit dolu → kilit.
  const deviceB = makeClient(server, "DEVICE_B", { forceOnRetry });
  const bFirst = loadAuth(deviceB, clock); // device_limit → locked

  // 3) Süper Admin limiti 2 yapar (B yeniden giriş YAPMAZ, sadece bekler).
  clock += 30000;
  superAdminSetLimit(server, 2);

  // 4) İkinci cihaz sadece "Tekrar Dene" butonuna basar (5 dk içinde).
  clock += 10000;
  const bRetry = refreshAuth(deviceB, clock);

  const pass = bRetry === "ready";
  console.log(`\n--- ${label} ---`);
  console.log(`A ilk giriş         : ${aState}  (beklenen ready)`);
  console.log(`B ilk giriş         : ${bFirst}  (beklenen locked/device_limit)`);
  console.log(`Süper Admin limit   : max_devices = ${server.company.max_devices}`);
  console.log(`B "Tekrar Dene"     : ${bRetry}`);
  console.log(`Aktif cihaz sayısı  : ${server.devices.filter((d) => d.is_active).length}`);
  console.log(`SONUÇ               : ${pass ? "PASS ✅ (sayfa açıldı)" : "FAIL ❌ (hâlâ kilitli)"}`);
  return pass;
}

console.log("==================================================");
console.log(" CİHAZ LİMİTİ 'TEKRAR DENE' SENKRONİZASYON TESTİ");
console.log("==================================================");

const oldPass = runScenario({ forceOnRetry: false, label: "ESKİ KOD (refreshAuth = loadAuth, force YOK)" });
const newPass = runScenario({ forceOnRetry: true, label: "YENİ KOD (refreshAuth = loadAuth{forceLicense:true})" });

console.log("\n==================================================");
console.log(` Eski kod hatayı üretiyor mu : ${!oldPass ? "EVET (FAIL — beklendiği gibi)" : "HAYIR"}`);
console.log(` Yeni kod düzeltti mi        : ${newPass ? "EVET (PASS)" : "HAYIR"}`);
console.log("==================================================");

if (!oldPass && newPass) {
  console.log("\n✅ DÜZELTME DOĞRULANDI: 'Tekrar Dene' artık yeniden giriş gerektirmeden erişim açıyor.");
  process.exit(0);
} else {
  console.log("\n❌ Beklenmeyen sonuç — düzeltme gözden geçirilmeli.");
  process.exit(1);
}
