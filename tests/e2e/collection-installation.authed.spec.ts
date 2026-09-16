import { test, expect, Page } from "@playwright/test";
import { hasAuthState, allowWrites, actAsTestCompanyAdmin, navHash } from "./helpers/auth";

// ============================================================================
// TAHSİLAT (customer collection) + MONTAJ (installation completion / hakediş)
// canlı UI E2E — 2026-09-10 QA oturumu.
//
// Model: curtain-flow.authed.spec.ts. Süper admin storageState ile açılır,
// actAsTestCompanyAdmin() ile Test Company 1'e (yazma-açık demo) geçer, GERÇEK
// arayüzden tıklar/yazar, sonucu window.supabase ile DB'de doğrular ve YALNIZCA
// kendi oluşturduğu kayıtları temizler. Gerçek firmalara dokunmaz.
//
// - Tahsilat: OrderDetail "+ Ödeme Ekle" → tutar → Kaydet (customer_record_collection).
//   Doğrulama: customer_collections cari kaydı + orders.paid_amount / kalan bakiye.
// - Montaj: OrderDetail'de montajcı ekle+ata → "Montaja Hazır" → "Montajı Tamamla"
//   (update_installation_completion). Doğrulama: installer_earnings/installer_transactions
//   HAKEDİŞ oluştu mu + iş "completed" + sipariş "montaj_tamamlandi".
// ============================================================================

// "Test Company 1" production'da artik yok (15.09.2026 tespiti) — "oss"
// firmasi gecici test firmasi olarak kullaniliyor (bkz. helpers/auth.ts).
const TC1_NAME_RE = /^oss$/i;

// Ölçü→Teklif→Sipariş: tek tül kalemli bir sipariş oluşturur (curtain-flow ile aynı formül).
// Döndürür: { orderId, customerId, apptIds[], total }
async function createTulOrder(page: Page, companyId: string, step: (s: string) => void) {
  const customerName = `E2E QA Müşteri ${Date.now()}`;
  const widthCm = 200, heightCm = 250, pile = 3, unitPrice = 420, qty = 1;
  const expectedTotal = ((widthCm * pile + 15) / 100) * qty * unitPrice; // 6.15 * 420 = 2583

  step("ölçü formu (/measurements/new)");
  await navHash(page, "/measurements/new");
  await page.waitForTimeout(800);
  await page.getByPlaceholder("Müşteri adı soyadı").fill(customerName);
  await page.getByLabel("Ürün Tipi").selectOption("tul");
  await page.getByLabel("En (cm)").fill(String(widthCm));
  await page.getByLabel("Boy (cm)").fill(String(heightCm));
  await page.getByLabel("Adet").fill(String(qty));
  // "tul" pricingUnit()'e gore metre (m) bazli fiyatlanir, m2 degil (bkz. MeasurementEntry.tsx:66)
  await page.getByLabel("Satış Fiyatı (₺/m)").fill(String(unitPrice));
  await page.getByLabel("Pile Tipi").selectOption(String(pile));
  await page.getByRole("button", { name: "Kaydet" }).click();
  await page.waitForURL(/#\/quotes/, { timeout: 15_000 });
  await page.waitForTimeout(1500);
  step("ölçü kaydedildi, teklifte");

  // Termin tarihi + Siparişe Çevir
  const dateInput = page.locator('input[type="date"]').first();
  await dateInput.fill(new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: /Siparişe Çevir/i }).first().click();
  await page.waitForTimeout(2500);
  step("siparişe çevrildi");

  // DB'den oluşan müşteri + sipariş + randevu id'lerini al
  const ids = await page.evaluate(async ({ name, companyId }) => {
    const sb = (window as any).supabase;
    const { data: cust } = await sb.from("customers").select("id").eq("company_id", companyId).eq("name", name).order("created_at", { ascending: false }).limit(1);
    const customerId = cust?.[0]?.id ?? null;
    if (!customerId) return { customerId: null };
    const { data: appts } = await sb.from("appointments").select("id").eq("company_id", companyId).eq("customer_id", customerId);
    const { data: orders } = await sb.from("orders").select("id,total_amount,paid_amount").eq("company_id", companyId).eq("customer_id", customerId).order("created_at", { ascending: false }).limit(1);
    return { customerId, apptIds: (appts || []).map((a: any) => a.id), orderId: orders?.[0]?.id ?? null, total: orders?.[0]?.total_amount ?? null };
  }, { name: customerName, companyId });

  expect(ids.customerId, "müşteri oluşmadı").toBeTruthy();
  expect(ids.orderId, "sipariş oluşmadı").toBeTruthy();
  return { customerName, orderId: ids.orderId as string, customerId: ids.customerId as string, apptIds: (ids.apptIds || []) as string[], total: Number(ids.total ?? expectedTotal), expectedTotal };
}

async function cleanupOrder(page: Page, companyId: string, o: { orderId?: string; customerId?: string; apptIds?: string[]; installerId?: string }) {
  if (page.isClosed()) return;
  await page.evaluate(async ({ companyId, o }) => {
    const sb = (window as any).supabase;
    try {
      if (o.orderId) {
        // Montaj hakediş/cari (installer_transactions'ta order_id kolonu yok,
        // temizligi asagida installerId ile yapiliyor)
        await sb.from("installer_earnings").delete().eq("order_id", o.orderId);
        await sb.from("installation_jobs").delete().eq("order_id", o.orderId);
        // Tahsilat cari + gelir (customer_record_collection RPC'sinin gercekte
        // yazdigi tablolar: payments + income — customer_collections/income_transactions
        // hic var olmayan tablolardi)
        await sb.from("payments").delete().eq("order_id", o.orderId);
        await sb.from("income").delete().eq("order_id", o.orderId);
        await sb.from("order_items").delete().eq("order_id", o.orderId);
        await sb.from("orders").delete().eq("id", o.orderId);
      }
      for (const aid of (o.apptIds || [])) await sb.from("appointments").delete().eq("id", aid);
      if (o.customerId) await sb.from("customers").delete().eq("id", o.customerId);
      if (o.installerId) {
        await sb.from("installer_transactions").delete().eq("installer_id", o.installerId);
        await sb.from("installer_earnings").delete().eq("installer_id", o.installerId);
        await sb.from("employees").delete().eq("id", o.installerId);
      }
    } catch (e) { /* temizlik asıl sonucu maskelemesin */ }
  }, { companyId, o });
}

test.describe("Tahsilat & Montaj (Test Company 1) — canlı UI E2E", () => {
  test.skip(!hasAuthState(), "storageState yok — önce: node scripts/e2e-record-auth.mjs");
  test.skip(!allowWrites(), "Yazma testi kapalı (E2E_ALLOW_WRITES=1 gerekir).");

  // -------------------------------------------------------------------------
  // 1) TAHSİLAT
  // -------------------------------------------------------------------------
  test("tahsilat: OrderDetail'den ödeme al → cari kaydı + bakiye doğru", async ({ page }) => {
    test.setTimeout(180_000);
    const step = (s: string) => console.log(`[STEP ${new Date().toISOString()}] ${s}`);
    page.on("pageerror", (e) => console.log(`[PAGEERROR] ${String(e)}`));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) console.log(`[CONSOLE.error] ${m.text()}`); });
    page.on("response", (r) => { const u = r.url(); if (r.status() >= 400 && !/\.(png|svg|ico|woff2?|map)(\?|$)/.test(u)) console.log(`[HTTP ${r.status()}] ${r.request().method()} ${u.replace(/apikey=[^&]*/, "apikey=***").replace(/localhost:5173/, "").slice(0, 200)}`); });

    const company = await actAsTestCompanyAdmin(page);
    expect(company.name).toMatch(TC1_NAME_RE);
    step(`firma = ${company.name}`);

    const created: any = {};
    try {
      const o = await createTulOrder(page, company.id, step);
      Object.assign(created, { orderId: o.orderId, customerId: o.customerId, apptIds: o.apptIds });
      const payAmount = 1000;

      step(`OrderDetail /orders/${o.orderId}`);
      await navHash(page, `/orders/${o.orderId}`);
      await page.waitForTimeout(2500);

      // DIAG: OrderDetail gerçekten ne render etti?
      const diag = await page.evaluate(() => ({
        url: location.hash,
        siparisBulunamadi: document.body.innerText.includes("Sipariş bulunamadı"),
        yukleniyor: document.body.innerText.includes("Yükleniyor"),
        odemeEkleVar: !!Array.from(document.querySelectorAll("button")).find((b) => /Ödeme Ekle/.test(b.textContent || "")),
        buttons: Array.from(document.querySelectorAll("button")).map((b) => (b.textContent || "").trim()).filter(Boolean).slice(0, 40),
      }));
      step(`DIAG OrderDetail: ${JSON.stringify(diag)}`);

      // "+ Ödeme Ekle" → form aç
      await page.getByRole("button", { name: /Ödeme Ekle/ }).click({ timeout: 25_000 });
      await page.getByPlaceholder("Tahsilat tutarı").fill(String(payAmount));
      // Ödeme yöntemi (varsayılan nakit) — açıklama:
      await page.getByPlaceholder("Açıklama").fill("E2E tahsilat testi");
      step("tahsilat formu dolduruldu, Kaydet");
      // Kaydet düğmesi bu formun içinde (Tahsilat tutarı inputunun kardeşi)
      await page.getByPlaceholder("Tahsilat tutarı").locator("xpath=..").getByRole("button", { name: "Kaydet" }).click();
      await page.waitForTimeout(2500);
      step("tahsilat kaydedildi, DB doğrulanıyor");

      // DB doğrulama: cari (payments — customer_record_collection RPC'sinin gerçekte
      // yazdığı tablo, "customer_collections" DEĞİL, bkz. supabase_customer_collection_finance_rpc.sql:205)
      // + bakiye (orders.paid_amount)
      const check = await page.evaluate(async ({ companyId, orderId }) => {
        const sb = (window as any).supabase;
        const { data: cols } = await sb.from("payments").select("id,amount,order_id").eq("company_id", companyId).eq("order_id", orderId);
        const { data: ord } = await sb.from("orders").select("id,total_amount,paid_amount").eq("id", orderId).single();
        return { cols, paid: ord?.paid_amount, total: ord?.total_amount };
      }, { companyId: company.id, orderId: o.orderId });

      const colSum = (check.cols || []).reduce((a: number, c: any) => a + Number(c.amount || 0), 0);
      expect((check.cols || []).length, "payments cari kaydı oluşmadı").toBeGreaterThan(0);
      expect(colSum, "cari toplamı yanlış").toBeCloseTo(payAmount, 1);
      expect(Number(check.paid), "orders.paid_amount (bakiye) güncellenmedi").toBeCloseTo(payAmount, 1);
      const remaining = Number(check.total) - Number(check.paid);
      expect(remaining, "kalan bakiye yanlış").toBeCloseTo(Number(o.total) - payAmount, 1);
      step(`TAHSİLAT PASS: cari=${colSum}, paid=${check.paid}, kalan=${remaining}`);
    } finally {
      await cleanupOrder(page, company.id, created);
      step("tahsilat temizlik tamam");
    }
  });

  // -------------------------------------------------------------------------
  // 2) MONTAJ (dış montajcı → hakediş)
  // -------------------------------------------------------------------------
  test("montaj: montajcı ata → Montaja Hazır → Tamamla → installer hakedişi oluşuyor", async ({ page }) => {
    test.setTimeout(240_000);
    const step = (s: string) => console.log(`[STEP ${new Date().toISOString()}] ${s}`);
    page.on("pageerror", (e) => console.log(`[PAGEERROR] ${String(e)}`));
    page.on("console", (m) => { if (m.type() === "error") console.log(`[CONSOLE.error] ${m.text()}`); });

    // --- Onaylı: Test Company 1'in montaj modülünü test için AÇ (önce mevcut ayarı kaydet) ---
    await page.goto("/#/super-admin/companies", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => !!(window as any).supabase, null, { timeout: 15_000 }).catch(() => {});
    const moduleState = await page.evaluate(async (nameRe) => {
      const sb = (window as any).supabase;
      const { data } = await sb.from("companies").select("id,name,enabled_modules").ilike("name", "oss");
      const row = (data || [])[0];
      if (!row) return { id: null };
      const prior: string[] = Array.isArray(row.enabled_modules) ? row.enabled_modules : [];
      const next = prior.includes("installation") ? prior : [...prior, "installation"];
      if (!prior.includes("installation")) {
        await sb.from("companies").update({ enabled_modules: next }).eq("id", row.id);
      }
      return { id: row.id as string, prior, changed: !prior.includes("installation") };
    }, TC1_NAME_RE.source);
    console.log(`[STEP] montaj modülü ayarı: ${JSON.stringify(moduleState)}`);

    const company = await actAsTestCompanyAdmin(page);
    expect(company.name).toMatch(TC1_NAME_RE);

    const created: any = {};
    try {
      const o = await createTulOrder(page, company.id, step);
      Object.assign(created, { orderId: o.orderId, customerId: o.customerId, apptIds: o.apptIds });

      step(`OrderDetail /orders/${o.orderId}`);
      await navHash(page, `/orders/${o.orderId}`);
      await page.waitForTimeout(1200);

      // Montajcı ekle (employees): "Yeni Montajcı Ekle" → ad → "Ekle"
      const installerName = `E2E Montajcı ${Date.now()}`;
      await page.getByRole("button", { name: /Yeni Montajcı Ekle/ }).click();
      await page.getByPlaceholder("Montajcı adı soyadı").fill(installerName);
      await page.getByRole("button", { name: "Ekle", exact: true }).click();
      await page.waitForTimeout(1200);
      step("montajcı eklendi");

      // Ata (handleAddInstaller assignedTo'yu zaten yeni montajcıya set etti)
      await page.getByRole("button", { name: /Montajcıyı (Ata|Değiştir)/ }).click();
      await page.waitForTimeout(1500);
      step("montajcı atandı");

      // Oluşan montajcı employees id'sini al (temizlik + doğrulama)
      const installerId = await page.evaluate(async ({ companyId, name }) => {
        const sb = (window as any).supabase;
        const { data } = await sb.from("employees").select("id").eq("company_id", companyId).eq("full_name", name).order("created_at", { ascending: false }).limit(1);
        return data?.[0]?.id ?? null;
      }, { companyId: company.id, name: installerName });
      expect(installerId, "montajcı employees kaydı bulunamadı").toBeTruthy();
      created.installerId = installerId;

      // Montaja Hazır (installation_jobs oluştur, atanan montajcıyla)
      await page.getByRole("button", { name: "Montaja Hazır", exact: true }).click();
      await page.waitForTimeout(2000);
      step("Montaja Hazır tıklandı");

      // İş oluştu ve montajcı atanmış mı?
      const jobBefore = await page.evaluate(async ({ orderId }) => {
        const sb = (window as any).supabase;
        const { data } = await sb.from("installation_jobs").select("id,status,assigned_staff_id,is_internal_installation").eq("order_id", orderId).order("created_at", { ascending: false }).limit(1);
        return data?.[0] ?? null;
      }, { orderId: o.orderId });
      expect(jobBefore, "installation_jobs oluşmadı").toBeTruthy();
      expect(jobBefore.assigned_staff_id, "işe montajcı atanmadı").toBe(installerId);
      step(`installation_job=${jobBefore.id}, atanan=${jobBefore.assigned_staff_id}`);

      // Montajı Tamamla → onay (gercek buton metni "✅ Montaj Tamamlandı")
      await page.getByRole("button", { name: /Montaj Tamamlandı/ }).click();
      await page.getByRole("button", { name: /Evet, Tamamla/ }).click();
      await page.waitForTimeout(3000);
      step("Montaj tamamlandı, hakediş doğrulanıyor");

      // DOĞRULAMA: iş completed + sipariş montaj_tamamlandi + installer_earnings/transactions oluştu
      const after = await page.evaluate(async ({ companyId, orderId, installerId }) => {
        const sb = (window as any).supabase;
        const { data: job } = await sb.from("installation_jobs").select("id,status").eq("order_id", orderId).limit(1);
        const { data: ord } = await sb.from("orders").select("id,status").eq("id", orderId).single();
        // GERCEK sema: installer_earnings.amount degil total_earning; installer_transactions'ta
        // hic order_id kolonu yok (yalnizca installer_id ile iliskili) — bkz.
        // supabase_fix_update_installation_completion_earnings.sql:324-375
        const { data: earnings } = await sb.from("installer_earnings").select("id,total_earning,installer_id,order_id").eq("order_id", orderId);
        const { data: txns } = await sb.from("installer_transactions").select("id,amount,installer_id,transaction_type").eq("installer_id", installerId).eq("transaction_type", "earning");
        return { jobStatus: job?.[0]?.status, orderStatus: ord?.status, earnings, txns };
      }, { companyId: company.id, orderId: o.orderId, installerId });

      expect(after.jobStatus, "iş 'completed' değil").toBe("completed");
      expect(after.orderStatus, "sipariş 'montaj_tamamlandi' değil").toBe("montaj_tamamlandi");
      // HAKEDİŞ: dış montajcıda installer_earnings VE/VEYA installer_transactions oluşmalı (§56 regresyonu)
      const earnCount = (after.earnings || []).length;
      const txnCount = (after.txns || []).length;
      expect(earnCount + txnCount, "montaj tamamlandı ama hiç hakediş/cari kaydı oluşmadı (§56 regresyonu)").toBeGreaterThan(0);
      step(`MONTAJ PASS: job=${after.jobStatus}, order=${after.orderStatus}, earnings=${earnCount}, txns=${txnCount}`);
    } finally {
      await cleanupOrder(page, company.id, created);
      // Modül ayarını ESKİ HÂLE döndür
      if (moduleState?.id && moduleState?.changed) {
        await page.evaluate(async ({ id, prior }) => {
          const sb = (window as any).supabase;
          await sb.from("companies").update({ enabled_modules: prior }).eq("id", id);
        }, { id: moduleState.id, prior: moduleState.prior }).catch(() => {});
      }
      step("montaj temizlik + modül geri alma tamam");
    }
  });
});
