import { Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

// Authed testler storageState kullanır (scripts/e2e-record-auth.mjs ile kaydedilir).
// Testler arası login YOK — tek seferlik kaydedilen oturum tekrar kullanılır.
export const STATE_PATH = path.resolve(process.cwd(), "tests/e2e/.auth/state.json");

export const hasAuthState = () => fs.existsSync(STATE_PATH);

// Yazma (kayıt/düzenle/sil) testleri yalnızca açıkça izin verildiğinde çalışır.
export const allowWrites = () => process.env.E2E_ALLOW_WRITES === "1";

// super_admin oturumunu, bir TEST firması üzerinden "admin" demo görünümüne geçirir.
// (openDemo akışının test eşdeğeri: demo_company_id + yazma açık + header'dan admin rolü.)
// Döndürür: seçilen test firması. Reload yapıldığı için bu çağrıdan SONRA sayfa
// gezintisi navHash() ile (reload'suz) yapılmalı; aksi halde rol super_admin'e döner.
// Supabase realtime websocket açık kaldığı için "networkidle" asla oturmaz ve
// 30s timeout'u boşa yer. Bunun yerine window.supabase hazır olana kadar bekle.
async function waitSupabaseReady(page: Page) {
  await page.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForFunction(() => !!(window as any).supabase, null, { timeout: 15_000 }).catch(() => {});
}

export async function actAsTestCompanyAdmin(page: Page): Promise<{ id: string; name: string }> {
  await page.goto("/#/super-admin/companies", { waitUntil: "domcontentloaded" });
  await waitSupabaseReady(page);

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

  // Yazma-etkin demo bağlamı.
  await page.evaluate((cid) => {
    localStorage.setItem("demo_company_id", cid);
    localStorage.setItem("demo_read_only", "false");
  }, company.id);
  await page.reload();
  await waitSupabaseReady(page);

  // Header rol seçicisinden admin'e geç (React state güncellenir, reload yok).
  const roleSelect = page.locator("select", { has: page.locator("option", { hasText: "Süper Admin" }) }).first();
  await roleSelect.selectOption("admin");
  await page.waitForTimeout(1200);
  return company;
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
