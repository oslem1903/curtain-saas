// ============================================================
// PerdePRO reklam için GERÇEK ekran kaydı alıcı (telefon görünümü, 430x932 @2x).
// - Şifre/oturum bu betiğe verilmez: açılan pencerede DEMO hesaba SEN elle giriş yaparsın.
// - Yalnızca okur ve gezinir; kayıt oluşturmaz, silmez, değiştirmez.
// - Çıktı: marketing/instagram-ad/captures/<ekran>.png ve <ekran>.webm
//
// Önce başka bir terminalde:  npm run dev
// Sonra:                       node marketing/instagram-ad/capture-real-screens.mjs
// ============================================================
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const BASE = process.env.E2E_BASE_URL || "http://localhost:5173";
const OUT = path.resolve("marketing/instagram-ad/captures");
fs.mkdirSync(OUT, { recursive: true });

const SCREENS = [
  ["olcu", "/measurements/new"],
  ["teklif", "/quotes"],
  ["siparis", "/orders"],
  ["randevu", "/appointments/new"],
  ["tahsilat", "/collections"],
];

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  viewport: { width: 430, height: 932 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  recordVideo: { dir: OUT, size: { width: 860, height: 1864 } },
});
const page = await context.newPage();
await page.goto(`${BASE}/#/login`);
console.log("\nAçılan pencerede DEMO hesaba elle giriş yap (en fazla 5 dk bekler).\n");

const deadline = Date.now() + 5 * 60 * 1000;
while (Date.now() < deadline && /#\/(login|signup|setup)/.test(page.url())) {
  await page.waitForTimeout(1000);
}
if (/#\/(login|signup|setup)/.test(page.url())) {
  console.error("Giriş algılanmadı, çıkılıyor.");
  await browser.close();
  process.exit(1);
}

for (const [name, route] of SCREENS) {
  await page.goto(`${BASE}/#${route}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  // Yumuşak kaydırma: kayıtta içerik hareketli görünsün
  await page.mouse.wheel(0, 350);
  await page.waitForTimeout(1200);
  await page.mouse.wheel(0, -350);
  await page.waitForTimeout(800);
  console.log("alındı:", name);
}
await context.close(); // video dosyasını kapatır
await browser.close();
console.log("\nTamam. Görüntüler:", OUT);
console.log("Bu klasörde kişisel veri olup olmadığını kontrol edip bana bildir; videoyu buna göre yeniden kurarım.");
