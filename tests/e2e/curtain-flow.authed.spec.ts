import { test, expect } from "@playwright/test";
import { hasAuthState, allowWrites, actAsTestCompanyAdmin, navHash } from "./helpers/auth";

// NOT: localStorage'a demo_company_id'yi doğrudan yazıp yalnızca reload etmek YETMEZ — /dashboard,
// /measurements/new gibi rotalardaki RoleGate, effectiveRole'ün (RoleContext) gerçekten "admin"
// olmasını ister; SuperAdminCompanies.tsx::openDemo() ise yalnızca (hiçbir yerde okunmayan, ölü)
// "demo_viewing_role" anahtarını yazıyor, React state'i GÜNCELLEMİYOR. Rolün gerçekten "admin"
// olması yalnızca GERÇEK "İşlem Modu" tıklamasıyla (SPA nav() sonrası, reload OLMADAN) oluyor —
// bu yüzden burada da actAsTestCompanyAdmin() (gerçek buton tıklaması) kullanılıyor, kısayol değil.

// Ölçü -> Teklif -> Sipariş zincirini GERÇEKTEN tıklayarak/yazarak test eder ve tül/fon ürünlerinin
// alan hesabının (pile çarpanı + dikiş payı) ölçüden siparişe kadar KORUNDUĞUNU doğrular — bkz.
// 2026-09-09 QA oturumunda bulunan ve düzeltilen bug: Quotes.tsx hem teklif ekranında (calcEstimate)
// hem sipariş dönüşümünde (handleConvertGroup) width_cm*height_cm ile YENİDEN (ve YANLIŞ) hesaplıyordu,
// ölçü aşamasında doğru hesaplanmış (appointments.estimated_area_m2) değeri YOK SAYIYORDU.
test.describe("Ölçü → Teklif → Sipariş (Test Company 1, tül ürün alan hesabı)", () => {
  test.skip(!hasAuthState(), "storageState yok — önce: node scripts/e2e-record-auth.mjs");
  test.skip(!allowWrites(), "Yazma testi kapalı (E2E_ALLOW_WRITES=1 gerekir).");

  test("tül ölçüsü doğru alanla (pile*genişlik+15) sipariş kalemine kadar korunuyor", async ({ page }) => {
    // Bu akış (demo moda giriş + 37+ firmalı süper admin listesinin yüklenmesi + ölçü formu +
    // teklif + sipariş dönüşümü) varsayılan 40s test timeout'undan fazla sürüyor — uzatıldı.
    test.setTimeout(180_000);

    // TANI: hangi adımda takıldığını KESİN olarak görmek için — her adımdan sonra bir "breadcrumb"
    // yazdırılır (--reporter=list zaman damgalı gösterir), TÜM console/network olayları loglanır.
    const step = (s: string) => console.log(`[STEP ${new Date().toISOString()}] ${s}`);
    page.on("console", (m) => console.log(`[CONSOLE ${m.type()}] ${m.text()}`));
    page.on("pageerror", (e) => console.log(`[PAGEERROR] ${String(e)}`));
    page.on("requestfailed", (r) => console.log(`[REQFAILED] ${r.method()} ${r.url()} — ${r.failure()?.errorText}`));
    page.on("response", (r) => {
      if (r.status() >= 400) console.log(`[HTTP ${r.status()}] ${r.request().method()} ${r.url()}`);
    });

    step("actAsTestCompanyAdmin başlıyor");
    const company = await actAsTestCompanyAdmin(page);
    step(`actAsTestCompanyAdmin bitti, firma=${company.name} url=${page.url()}`);
    const sb = page;
    const customerName = `E2E TEST Müşteri ${Date.now()}`;
    const widthCm = 200;
    const heightCm = 250;
    const pile = 3;
    const unitPrice = 420;
    const qty = 1;
    // calculate() (MeasurementEntry.tsx / measurementConstants.ts) ile AYNI formül, testin
    // kendisi tarafından BAĞIMSIZ hesaplanır (test edilen koddan kopyalanmaz):
    const expectedFabricWidthCm = widthCm * pile + 15; // 200*3+15 = 615
    const expectedAreaM2 = expectedFabricWidthCm / 100; // 6.15
    const expectedTotal = expectedAreaM2 * qty * unitPrice; // 2583

    const cleanupIds: { appointments: string[]; customers: string[]; orders: string[] } = {
      appointments: [], customers: [], orders: [],
    };

    try {
      // ---- 1) ÖLÇÜ: yeni tül ölçüsü gir ----
      step("navHash /measurements/new");
      await navHash(page, "/measurements/new");
      await page.waitForTimeout(1000);
      step(`measurements/new sonrası url=${page.url()}`);

      await page.getByPlaceholder("Müşteri adı soyadı").fill(customerName);
      step("müşteri adı dolduruldu");

      // Ürün Tipi -> Tül
      await page.getByLabel("Ürün Tipi").selectOption("tul");
      step("ürün tipi = tül seçildi");
      await page.getByLabel("En (cm)").fill(String(widthCm));
      await page.getByLabel("Boy (cm)").fill(String(heightCm));
      await page.getByLabel("Adet").fill(String(qty));
      await page.getByLabel("Satış Fiyatı (₺/m²)").fill(String(unitPrice));
      step("boyut/fiyat/adet dolduruldu");
      await page.getByLabel("Pile Tipi").selectOption(String(pile));
      step("pile tipi seçildi, kaydet'e tıklanacak");

      await page.getByRole("button", { name: "Kaydet" }).click();
      step("kaydet tıklandı, /quotes bekleniyor");
      // Kayıt sonrası /quotes'a yönlendiriliyor (bkz. MeasurementEntry.tsx saveMeasurementGroup).
      await page.waitForURL(/#\/quotes/, { timeout: 15_000 });
      step(`/quotes'a ulaşıldı, url=${page.url()}`);
      await page.waitForTimeout(1500);

      // ---- 2) DB'den doğrula: appointments.estimated_area_m2 / estimated_total doğru mu ----
      const apptCheck = await sb.evaluate(async ({ name, companyId }) => {
        const client = (window as any).supabase;
        const { data: cust } = await client.from("customers").select("id").eq("company_id", companyId).eq("name", name).order("created_at", { ascending: false }).limit(1);
        const customerId = cust?.[0]?.id ?? null;
        if (!customerId) return { customerId: null };
        const { data: appts } = await client.from("appointments").select("id,estimated_area_m2,estimated_total,product_type").eq("company_id", companyId).eq("customer_id", customerId).eq("type", "measurement");
        return { customerId, appts };
      }, { name: customerName, companyId: company.id });

      expect(apptCheck.customerId, "müşteri oluşmadı").toBeTruthy();
      if (apptCheck.customerId) cleanupIds.customers.push(apptCheck.customerId);
      const appts = (apptCheck as any).appts ?? [];
      expect(appts.length, "ölçü kaydı oluşmadı").toBeGreaterThan(0);
      for (const a of appts) cleanupIds.appointments.push(a.id);

      const tulAppt = appts.find((a: any) => a.product_type === "tul");
      expect(tulAppt, "tül ölçü satırı bulunamadı").toBeTruthy();
      expect(tulAppt.estimated_area_m2, "estimated_area_m2 yanlış").toBeCloseTo(expectedAreaM2, 2);
      expect(tulAppt.estimated_total, "estimated_total yanlış").toBeCloseTo(expectedTotal, 1);
      step("DB doğrulaması (appointments.estimated_*) PASS");

      // ---- 3) TEKLİF ekranında gösterilen toplam da aynı mı ----
      // NOT: burada page.reload() YAPILMAZ — tam sayfa reload, RoleContext'in demo rolünü
      // (viewingRole) sıfırlayıp süper admini /super-admin/companies'e geri düşürür (2026-09-09
      // QA oturumunda canlı doğrulandı). saveMeasurementGroup zaten /quotes'a navigate ETMİŞTİ,
      // reload'a hiç gerek yok — sayfa hâlâ /quotes'ta ve veri zaten yüklü.
      await page.waitForTimeout(1500);
      const bodyText = await page.evaluate(() => document.body.innerText);
      expect(bodyText, "teklif ekranında beklenen müşteri adı yok").toContain(customerName);
      step("müşteri adı teklif ekranında görüldü");

      // Termin tarihi gir (siparişe çevirmek için zorunlu) ve siparişe çevir.
      const dateInput = page.locator('input[type="date"]').first();
      await dateInput.fill(new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
      step("termin tarihi dolduruldu, siparişe çevir'e tıklanacak");
      await page.getByRole("button", { name: /Siparişe Çevir/i }).first().click();
      step("siparişe çevir tıklandı");
      await page.waitForTimeout(2500);
      step("dönüşüm sonrası bekleme tamamlandı");

      // ---- 4) DB'den doğrula: order_items.line_total doğru mu (BUG buradaydı) ----
      const orderCheck = await sb.evaluate(async ({ companyId, customerId }) => {
        const client = (window as any).supabase;
        const { data: orders } = await client.from("orders").select("id,total_amount").eq("company_id", companyId).eq("customer_id", customerId).order("created_at", { ascending: false }).limit(1);
        const orderId = orders?.[0]?.id ?? null;
        if (!orderId) return { orderId: null };
        const { data: itemsForOrder } = await client.from("order_items").select("id,product_type,line_total,width_cm,height_cm").eq("order_id", orderId);
        return { orderId, orderTotal: orders?.[0]?.total_amount, items: itemsForOrder };
      }, { companyId: company.id, customerId: apptCheck.customerId });

      expect(orderCheck.orderId, "sipariş oluşmadı").toBeTruthy();
      if (orderCheck.orderId) cleanupIds.orders.push(orderCheck.orderId);
      const items = (orderCheck as any).items ?? [];
      const tulItem = items.find((i: any) => i.product_type === "tul");
      expect(tulItem, "sipariş kaleminde tül ürünü bulunamadı").toBeTruthy();
      // ASIL REGRESYON KONTROLÜ: line_total artık width*height (2*2.5=5*420=2100) DEĞİL,
      // pile+dikiş-payı formülüyle (6.15*420=2583) eşleşmeli.
      expect(tulItem.line_total, "sipariş kalemi tutarı yanlış (eski width*height hatası geri gelmiş olabilir)").toBeCloseTo(expectedTotal, 1);
      expect(orderCheck.orderTotal, "sipariş toplamı yanlış").toBeCloseTo(expectedTotal, 1);
    } finally {
      // ---- Temizlik: yalnızca bu testin oluşturduğu kayıtlar (id'leri tutuldu) ----
      // page zaten kapanmışsa (timeout sonrası) temizlik atlanır — asıl hatayı MASKELEMEMESİ için
      // try/catch'e alındı (aksi halde gerçek başarısızlık yerine "page kapalı" hatası görünürdü).
      try {
        if (!page.isClosed()) {
          await page.evaluate(async (ids) => {
            const client = (window as any).supabase;
            for (const orderId of ids.orders) {
              await client.from("order_items").delete().eq("order_id", orderId);
              await client.from("orders").delete().eq("id", orderId);
            }
            for (const apptId of ids.appointments) {
              await client.from("appointments").delete().eq("id", apptId);
            }
            for (const custId of ids.customers) {
              await client.from("customers").delete().eq("id", custId);
            }
          }, cleanupIds);
          step("temizlik tamamlandı");
        } else {
          step(`page zaten kapalıydı, temizlik ATLANDI — kalıntı id'ler: ${JSON.stringify(cleanupIds)}`);
        }
      } catch (cleanupErr) {
        step(`temizlik hatası (asıl test sonucunu etkilemez): ${cleanupErr}`);
      }
    }
  });
});
