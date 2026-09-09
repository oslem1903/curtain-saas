import { Page, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Authed testler storageState kullanır (scripts/e2e-record-auth.mjs ile kaydedilir).
// Testler arası login YOK — tek seferlik kaydedilen oturum tekrar kullanılır.
export const STATE_PATH = path.resolve(process.cwd(), "tests/e2e/.auth/state.json");

export const hasAuthState = () => fs.existsSync(STATE_PATH);

// Yazma (kayıt/düzenle/sil) testleri yalnızca açıkça izin verildiğinde çalışır.
export const allowWrites = () => process.env.E2E_ALLOW_WRITES === "1";

// super_admin oturumunu, bir TEST firması üzerinden "admin" demo görünümüne geçirir.
// GERÇEK "İşlem Modu" butonuna tıklar (SuperAdminCompanies.tsx::openDemo(company,"admin",false)) —
// localStorage'ı elle yazıp reload etmek YERİNE, çünkü openDemo bir SPA nav() yapıyor ve rol
// geçişi yalnızca reload OLMADAN doğru çalışıyor (2026-09-09 QA oturumunda canlı doğrulandı: reload
// sonrası RoleContext'in mount effect'i demo_viewing_role'u siper-admin icin sifirliyor). Eskiden bu
// fonksiyon header'daki rol seçiciyi arıyordu ("Süper Admin" option'lı <select>) — bu artık YANLIŞ
// çünkü (a) etiket "Süper Yönetici"ye değişti, (b) demo/tenant modundayken kutu firmanın
// enabled_roles'una göre filtreleniyor ve "Süper Admin" hiçbir zaman seçenek olarak görünmüyor.
// Döndürür: seçilen test firması. Bu çağrıdan SONRA sayfa gezintisi navHash() ile (reload'suz)
// yapılmalı; aksi halde rol super_admin'e döner.
// Supabase realtime websocket açık kaldığı için "networkidle" asla oturmaz ve 30s timeout'u boşa
// yer. Bunun yerine window.supabase hazır olana kadar bekle.
async function waitSupabaseReady(page: Page) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForFunction(() => !!(window as any).supabase, null, { timeout: 15_000 }).catch(() => {});
}

export async function actAsTestCompanyAdmin(page: Page): Promise<{ id: string; name: string }> {
  await page.goto("/#/super-admin/companies", { waitUntil: "domcontentloaded" });
  await waitSupabaseReady(page);
  // storageState.json, kaydedildiği anda tarayıcıda AÇIK olan demo/impersonation localStorage
  // anahtarlarını da (demo_company_id vb.) olduğu gibi yakalar — kaydeden kişi daha önce elle
  // "İşlem Modu"na girmişse bu, HER testin BAŞKA bir firmanın demo bağlamıyla başlamasına yol açar.
  // Temiz bir başlangıç için önce açıkça temizle (clearDemoTenantContext ile aynı anahtarlar).
  await page.evaluate(() => {
    localStorage.removeItem("demo_company_id");
    localStorage.removeItem("demo_read_only");
    localStorage.removeItem("demo_viewing_role");
    localStorage.removeItem("demo_viewing_user_id");
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitSupabaseReady(page);
  // Bu sayfa firma başına ayrı istatistik sorguları attığı için (37+ firma) yüklenmesi uzun
  // sürüyor ve liste sürekli yeniden render oluyor — "Yükleniyor..." kaybolana kadar bekle,
  // aksi halde arama kutusuna yazma/tıklama sürekli devam eden re-render'larla yarışır.
  await page.waitForFunction(() => !document.body.innerText.includes("Yükleniyor..."), null, { timeout: 30_000 }).catch(() => {});

  const company = await page.evaluate(async () => {
    const sb = (window as any).supabase;
    if (!sb) return null;
    const { data } = await sb.from("companies").select("id,name").order("name");
    const list = (data || []) as { id: string; name: string }[];
    return (
      list.find((c) => /test\s*company\s*1/i.test(c.name || "")) ||
      list.find((c) => /test\s*company\s*2/i.test(c.name || "")) ||
      list.find((c) => /test|demo/i.test(c.name || "")) ||
      null
    );
  });
  if (!company) throw new Error("Test firması bulunamadı (companies içinde 'test/demo' adlı firma yok).");

  // Arama kutusuna firma adını yaz — 37+ karttan doğru "İşlem Modu" butonunu tekilleştirmek için.
  // Filtrelemenin GERÇEKTEN uygulandığını (yalnızca hedef firmanın kartı kaldığını) bekle — aksi
  // halde React henüz yeniden render etmeden tıklama YANLIŞ (örn. alfabetik ilk) karta gidebilir.
  await page.getByPlaceholder("Firma ara...").fill(company.name);
  await expect(page.getByRole("button", { name: "İşlem Modu" })).toHaveCount(1, { timeout: 10_000 });
  await page.getByRole("button", { name: "İşlem Modu" }).click({ timeout: 10_000 });
  await page.waitForURL(/#\/(dashboard|accounting|route\/today)/, { timeout: 15_000 });
  await waitSupabaseReady(page);
  await page.waitForTimeout(800);
  return company;
}

// actAsTestCompanyAdmin'in HAFİF alternatifi: /super-admin/companies'in yavaş, firma-başına-ayrı-
// sorgulu listesini (bkz. 2026-09-09 QA oturumunda ayrıca bildirilen performans sorunu) hiç
// YÜKLEMEDEN, doğrudan localStorage'a demo bağlamını yazıp BİR KEZ reload eder. "İşlem Modu"
// butonunun kendisini test etmeyen (yalnızca yazma-etkin bir tenant bağlamına ihtiyaç duyan)
// testler için kullanılır — actAsTestCompanyAdmin'in kendisi (buton tıklama akışının doğru
// çalıştığını doğrulayan testler için) hâlâ mevcut ve ayrı kalır.
export async function enterDemoWriteModeDirect(page: Page, companyId: string, companyName: string, targetRoute = "/dashboard"): Promise<{ id: string; name: string }> {
  // Süper admin, demo_company_id HENÜZ set edilmeden hedef rotaya gidince uygulama onu kendi
  // paneline (/#/super-admin/companies) yönlendirebiliyor — ama localStorage.setItem sayfanın O
  // ANKİ rotasından TAMAMEN bağımsız çalışır (origin bazlı). Bu yüzden: önce hedef rotaya git (nereye
  // yönlendirilirse yönlendirilsin fark etmez), localStorage'ı yaz, SONRA reload et — bu reload artık
  // demo_company_id ZATEN VARKEN, hedef rotanın hash'iyle baştan başlar.
  await page.goto(`/#${targetRoute}`, { waitUntil: "domcontentloaded" });
  await page.evaluate((cid) => {
    localStorage.setItem("demo_company_id", cid);
    localStorage.setItem("demo_read_only", "false");
    localStorage.removeItem("demo_viewing_role");
    localStorage.removeItem("demo_viewing_user_id");
  }, companyId);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitSupabaseReady(page);
  await page.waitForTimeout(800);
  return { id: companyId, name: companyName };
}

// Reload'suz SPA gezintisi (hash değişimi) — demo admin rolünü korur.
export async function navHash(page: Page, routePath: string) {
  const clean = routePath.replace(/^#/, "");
  await page.evaluate((p) => {
    window.location.hash = "#" + p;
  }, clean);
  // networkidle güvenilmez (realtime ws). Sayfanın veri çekip render etmesi için
  // kısa, sabit bir bekleme yeterli.
  await page.waitForTimeout(1200);
}
