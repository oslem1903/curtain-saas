import { test, expect } from "@playwright/test";
import { hasAuthState } from "./helpers/auth";

// Kullanıcının gezmesini istediği tüm ana sayfalar (hash route'lar).
const ROUTES: { name: string; path: string }[] = [
  { name: "Dashboard", path: "/#/dashboard" },
  { name: "Ölçü", path: "/#/measurements/new" },
  { name: "Teklif", path: "/#/quotes" },
  { name: "Sipariş", path: "/#/orders" },
  { name: "Tedarikçiler", path: "/#/suppliers" },
  { name: "Muhasebe", path: "/#/accounting" },
  { name: "Montaj", path: "/#/installations" },
  { name: "Müşteriler", path: "/#/customers" },
  { name: "Randevular", path: "/#/appointments/new" },
  { name: "Süper Admin", path: "/#/super-admin/companies" },
];

test.describe("Authed sayfa gezintisi (storageState)", () => {
  test.skip(!hasAuthState(), "storageState yok — önce: node scripts/e2e-record-auth.mjs çalıştır.");

  for (const r of ROUTES) {
    test(`${r.name} sayfası açılıyor (çökme/console/network)`, async ({ page }) => {
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      const serverErrors: string[] = [];

      page.on("pageerror", (e) => pageErrors.push(String(e)));
      page.on("console", (m) => {
        if (m.type() === "error") consoleErrors.push(m.text());
      });
      page.on("response", (res) => {
        // 4xx/5xx ağ hatası (HARD FAIL). 404 favicon gibi statik varlıkları hariç tut.
        if (res.status() >= 400 && !/\.(ico|png|svg|jpg|jpeg|webp|woff2?)(\?|$)/i.test(res.url())) {
          serverErrors.push(`${res.status()} ${res.request().method()} ${res.url()}`);
        }
      });

      await page.goto(r.path);
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(1200);

      // Oturum geçerli → login'e düşmemeli (yetki yoksa rol-bazlı başka sayfaya gidebilir, login'e değil).
      expect(page.url(), `${r.name}: login'e düştü (oturum geçersiz)`).not.toMatch(/#\/login/);
      // ErrorBoundary ekranına düşmemeli.
      await expect(page.locator("body")).not.toContainText(/Bir şeyler ters gitti|Something went wrong|Uygulama çöktü/i);
      // Yakalanan uncaught JS hatası olmamalı (HARD FAIL).
      expect(pageErrors, `${r.name} pageerror: ${pageErrors.join(" | ")}`).toHaveLength(0);
      // Ağ 4xx/5xx olmamalı (HARD FAIL).
      expect(serverErrors, `${r.name} ağ hatası: ${serverErrors.join(" | ")}`).toHaveLength(0);
      // console.error olmamalı (HARD FAIL).
      expect(consoleErrors, `${r.name} console.error: ${consoleErrors.join(" | ")}`).toHaveLength(0);
    });
  }
});
