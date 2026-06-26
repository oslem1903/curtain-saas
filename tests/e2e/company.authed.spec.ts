import { test, expect, Page } from "@playwright/test";
import { hasAuthState, allowWrites, actAsTestCompanyAdmin, navHash } from "./helpers/auth";

// Ağ hatası tanımı: 5xx (sunucu) veya 400 (hatalı sorgu = gerçek bug, ör. olmayan kolon).
// 401/403 (RLS), 406 (.single() boş sonuç) ve statik 404'ler bağlama bağlı → benign.
function isRealNetworkError(status: number, url: string) {
  if (/\.(ico|png|svg|jpg|jpeg|webp|woff2?|map)(\?|$)/i.test(url)) return false;
  if (status >= 500) return true;
  if (status === 400) return true;
  return false;
}

function attachErrorCollectors(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const netErrors: string[] = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    // Tarayıcının ağ yanıtları için otomatik ürettiği "Failed to load resource"
    // mesajları app hatası DEĞİL — HTTP durumu zaten isRealNetworkError ile
    // (404/403 benign, 400/5xx gerçek) netErrors'ta değerlendiriliyor. Burada
    // yalnızca gerçek client-side (React/JS) hatalarını topla, çift sayma.
    if (/Failed to load resource/i.test(m.text())) return;
    consoleErrors.push(m.text());
  });
  page.on("response", (res) => {
    if (isRealNetworkError(res.status(), res.url())) {
      netErrors.push(`${res.status()} ${res.request().method()} ${res.url()}`);
    }
  });
  return { pageErrors, consoleErrors, netErrors };
}

test.describe("Company (admin demo) — uçtan uca QA", () => {
  test.skip(!hasAuthState(), "storageState yok — önce: node scripts/e2e-record-auth.mjs");
  test.skip(!allowWrites(), "Yazma testi kapalı (E2E_ALLOW_WRITES=1 gerekir).");

  // ---- 1) Tüm company sayfaları: çökme / console / network ----
  test("tüm company sayfaları açılıyor (console=0, network=0)", async ({ page }) => {
    await actAsTestCompanyAdmin(page);
    const { pageErrors, consoleErrors, netErrors } = attachErrorCollectors(page);

    const routes: { name: string; path: string }[] = [
      { name: "Dashboard", path: "/dashboard" },
      { name: "Ölçü", path: "/measurements/new" },
      { name: "Teklif", path: "/quotes" },
      { name: "Sipariş", path: "/orders" },
      { name: "Tedarikçiler", path: "/suppliers" },
      { name: "Muhasebe", path: "/accounting" },
      { name: "Montaj", path: "/installations" },
      { name: "Müşteriler", path: "/customers" },
      { name: "Randevular", path: "/appointments/new" },
    ];

    for (const r of routes) {
      await navHash(page, r.path);
      expect(page.url(), `${r.name}: login'e düştü`).not.toMatch(/#\/login/);
      await expect(page.locator("body"), `${r.name}: ErrorBoundary`).not.toContainText(
        /Bir şeyler ters gitti|Something went wrong|Uygulama çöktü/i,
      );
    }

    expect(pageErrors, `pageerror: ${pageErrors.join(" | ")}`).toHaveLength(0);
    expect(consoleErrors, `console.error: ${consoleErrors.join(" | ")}`).toHaveLength(0);
    expect(netErrors, `network: ${netErrors.join(" | ")}`).toHaveLength(0);
  });

  // ---- 2) Tedarikçi: CRUD + Arama + Ödeme + Excel + PDF + Filtre + Sil ----
  test("Tedarikçi tam akışı: oluştur → ara → ödeme → Excel → PDF → filtre → sil", async ({ page }) => {
    const company = await actAsTestCompanyAdmin(page);
    const { pageErrors, consoleErrors, netErrors } = attachErrorCollectors(page);
    const name = `E2E TEST Tedarikçi ${Date.now()}`;
    let supplierId: string | null = null;

    // CREATE
    await navHash(page, "/suppliers/new");
    await page.getByPlaceholder("Örn: ABC Tekstil").fill(name);
    await page.getByPlaceholder("05xx xxx xx xx").fill("05551112233");
    await page.getByRole("button", { name: "Kaydet" }).click();
    await expect(page).toHaveURL(/#\/suppliers$/, { timeout: 15_000 });

    // SEARCH (liste arama)
    await page.getByPlaceholder("Tedarikçi ara...").fill(name);
    await expect(page.locator("body")).toContainText(name, { timeout: 10_000 });

    // Oluşan tedarikçinin id'sini al (detay route + temizlik için).
    supplierId = await page.evaluate(async (nm) => {
      const sb = (window as any).supabase;
      const { data } = await sb
        .from("suppliers")
        .select("id")
        .eq("name", nm)
        .order("created_at", { ascending: false })
        .limit(1);
      return data?.[0]?.id ?? null;
    }, name);
    expect(supplierId, "oluşan tedarikçi id'si bulunamadı").toBeTruthy();

    // DETAY route → ÖDEME EKLE (CRUD write)
    await navHash(page, `/suppliers/${supplierId}`);
    await expect(page.getByRole("button", { name: /Ödeme Ekle/ })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Ödeme Ekle/ }).click();
    await page.getByPlaceholder("0.00").fill("250");
    await page.getByRole("button", { name: /Ödemeyi Kaydet/ }).click();
    // Ödeme sonrası cari hareket TABLOSUNDA görünmeli. NOT: body'de "250" aramak
    // güvenilmez — tedarikçi adındaki zaman damgası (Date.now) de "250" içerebilir.
    // Bu yüzden ödeme satırının tablonun ödeme sütununda (₺250,00) belirmesini bekle.
    await expect(page.locator("table tbody tr")).toContainText("₺250,00", { timeout: 10_000 });

    // EXCEL (download event)
    const downloadPromise = page.waitForEvent("download", { timeout: 15_000 });
    await page.getByRole("button", { name: /Döküm Al/ }).click();
    await page.getByRole("button", { name: /Excel İndir/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename().toLowerCase()).toContain("cari");

    // PDF (popup)
    const popupPromise = page.waitForEvent("popup", { timeout: 15_000 });
    await page.getByRole("button", { name: /Döküm Al/ }).click();
    await page.getByRole("button", { name: /PDF İndir/ }).click();
    const popup = await popupPromise;
    expect(popup, "PDF popup açılmadı").toBeTruthy();
    await popup.close();

    // FILTER (tarih aralığı inputları — çökmeden uygulanır)
    await page.locator('input[type="date"]').first().fill("2020-01-01");
    await page.locator('input[type="date"]').nth(1).fill("2030-12-31");
    await page.waitForTimeout(500);
    await expect(page.locator("body")).not.toContainText(/Bir şeyler ters gitti/i);

    // CLEANUP — yalnızca bu testin oluşturduğu kaydı sil (prod veri silinmez).
    if (supplierId) {
      await page.evaluate(async (sid) => {
        const sb = (window as any).supabase;
        await sb.from("supplier_transactions").delete().eq("supplier_id", sid);
        await sb.from("supplier_payments").delete().eq("supplier_id", sid);
        await sb.from("expenses").delete().eq("supplier_id", sid);
        await sb.from("suppliers").delete().eq("id", sid);
      }, supplierId);
    }

    // Hata kontrolleri
    expect(pageErrors, `pageerror: ${pageErrors.join(" | ")}`).toHaveLength(0);
    expect(consoleErrors, `console.error: ${consoleErrors.join(" | ")}`).toHaveLength(0);
    expect(netErrors, `network: ${netErrors.join(" | ")}`).toHaveLength(0);

    expect(company.name).toMatch(/test/i);
  });
});
