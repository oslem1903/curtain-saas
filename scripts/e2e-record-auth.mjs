// ============================================================
// E2E oturum kaydedici.
// Bir tarayıcı açar; SEN uygulamaya elle giriş yaparsın; giriş algılanınca
// oturum (cookies + localStorage: Supabase token, device id) JSON'a kaydedilir.
// Tüm authed testler bu storageState'i tekrar kullanır — testler arası login yok.
//
// Çalıştır:  node scripts/e2e-record-auth.mjs
// ============================================================
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.E2E_BASE_URL || "http://localhost:5173";
const OUT = path.resolve(process.cwd(), "tests/e2e/.auth/state.json");

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(BASE + "/#/login");

console.log("\n========================================================");
console.log(" Açılan tarayıcıda UYGULAMAYA ELLE GİRİŞ YAP.");
console.log(" Giriş başarılı olunca oturum otomatik kaydedilecek.");
console.log(" (En fazla 5 dakika bekler)");
console.log("========================================================\n");

const deadline = Date.now() + 5 * 60 * 1000;
let ok = false;
while (Date.now() < deadline) {
  const url = page.url();
  if (/#\/(dashboard|field|accounting|super-admin)/.test(url)) {
    ok = true;
    break;
  }
  const hasSession = await page
    .evaluate(() => {
      try {
        const keyed = Object.keys(localStorage).some((k) => k.includes("curtain-saas-auth"));
        return keyed && !location.hash.includes("/login");
      } catch {
        return false;
      }
    })
    .catch(() => false);
  if (hasSession) {
    ok = true;
    break;
  }
  await page.waitForTimeout(1500);
}

if (!ok) {
  console.error("✗ Zaman aşımı: giriş algılanmadı. Tekrar dene.");
  await browser.close();
  process.exit(1);
}

// Uygulamanın oturumu localStorage'a tam yazması için kısa bekleme.
await page.waitForTimeout(1500);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
await context.storageState({ path: OUT });
console.log("\n✓ Oturum kaydedildi:", OUT);
console.log("  Artık: npm run test:e2e\n");
await browser.close();
process.exit(0);
