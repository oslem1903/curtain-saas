// Tedarikçiye WhatsApp paylaşımı + Parçalı En: ekranlardan uçtan uca doğrulama (QA firması A, B ile izolasyon).
// Yalnız bu betiğin oluşturduğu kayıtları siler. WhatsApp mesajı GÖNDERİLMEZ (wa.me isteği engellenir).
//   node scripts/qa-share-segments-e2e.mjs [temelUrl]
import { chromium } from '@playwright/test';
import { loadQaAccounts } from './lib/qaAccounts.mjs';

const BASE = (process.argv[2] || 'http://localhost:5199').replace(/\/$/, '');
const { accounts } = loadQaAccounts({ requireBoth: false });
const A = accounts.A; const B = accounts.B;
const TS = Date.now();
let fail = 0;
const rec = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };
const created = { suppliers: [], prices: [], customers: [], orders: [], appts: [] };

const browser = await chromium.launch({ channel: process.env.QA_BROWSER_CHANNEL || undefined });
async function mkCtx(acc) {
  const c = await browser.newContext({ viewport: { width: 1360, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await c.addInitScript((id) => localStorage.setItem('curtain_saas_device_id', id), acc.deviceId);
  const p = await c.newPage();
  p.on('dialog', (d) => d.accept().catch(() => {}));
  return { c, p };
}
const nav = async (page, hash) => {
  const same = page.url().endsWith('#' + hash);
  await page.goto(`${BASE}/#${hash}`); if (same || /^\/(orders|appointments)\//.test(hash)) await page.reload();
  await page.waitForTimeout(1200);
  await page.getByText(/Yükleniyor/).first().waitFor({ state: 'detached', timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(800);
};
async function login(page, acc) {
  await page.goto(`${BASE}/#/login`);
  await page.locator('input[type="email"]').first().fill(acc.email);
  await page.locator('input[type="password"]').first().fill(acc.password);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL(/#\/(dashboard|app\/dashboard|field)/, { timeout: 60000 });
}
const body = async (page) => (await page.locator('body').innerText()).split(String.fromCharCode(160)).join(' ');

const { c: ctxA, p: page } = await mkCtx(A);
const ev = (fn, arg) => page.evaluate(fn, arg);
page.on('pageerror', (e) => console.log('PAGEERR', String(e).slice(0, 300)));
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });
const cards = () => page.locator('div[class*="bg-slate-50/80"]');

// wa.me isteğini yakala ve ENGELLE (mesaj gönderilmez)
const waRequests = [];
await ctxA.route(/https:\/\/(api\.)?wa\.me\/.*/, (r) => { waRequests.push(r.request().url()); r.abort(); });

async function snapshotMoney(supplierIds, orderId) {
  return ev(async ({ supplierIds, orderId }) => {
    const sb = window.supabase;
    const { data: tx } = await sb.from('supplier_transactions').select('id,supplier_id,transaction_type,amount').in('supplier_id', supplierIds);
    const { data: oi } = await sb.from('order_items').select('id').eq('order_id', orderId);
    const { data: ord } = await sb.from('orders').select('id');
    const { data: ex } = await sb.from('expenses').select('id').eq('order_id', orderId);
    const sum = (t) => (tx || []).filter((x) => x.transaction_type === t).reduce((s, x) => s + Number(x.amount), 0);
    return { txCount: (tx || []).length, debt: sum('debt'), payment: sum('payment'), items: (oi || []).length, orders: (ord || []).length, expenses: (ex || []).length };
  }, { supplierIds, orderId });
}

try {
  await login(page, A);
  const cid = await ev(async () => {
    const sb = window.supabase;
    const { data: { user } } = await sb.auth.getUser();
    const r = await sb.from('profiles').select('company_id').eq('id', user.id).maybeSingle();
    if (r.data?.company_id) return r.data.company_id;
    const m = await sb.from('company_members').select('company_id').eq('user_id', user.id).limit(1);
    return m.data?.[0]?.company_id ?? null;
  });
  rec('A firması belirlendi', !!cid);

  // ---- tedarikçiler (+fiyat listesi, UI listesinde görünsün diye) ----
  const supA = `QA-SHARE Tedarikci A ${TS}`; const supB = `QA-SHARE Tedarikci B ${TS}`;
  const sup = await ev(async ({ cid, supA, supB }) => {
    const sb = window.supabase; const out = {};
    for (const [k, name, phone] of [['A', supA, '0555 000 00 01'], ['B', supB, null]]) {
      const { data, error } = await sb.from('suppliers').insert([{ company_id: cid, name, phone }]).select('id').single();
      if (error) throw new Error('supplier: ' + error.message);
      out[k] = data.id;
      for (const cat of ['stor', 'zebra', 'tul']) {
        let r = await sb.from('supplier_product_prices').insert([{ company_id: cid, supplier_id: data.id, product_name: `QA ${cat}`, product_category: cat, unit_cost: 100, currency: 'TRY' }]).select('id').single();
        if (r.error) r = await sb.from('supplier_product_prices').insert([{ company_id: cid, supplier_id: data.id, product_name: `QA ${cat}`, unit_cost: 100 }]).select('id').single();
        if (r.data?.id) (out.prices ||= []).push(r.data.id);
      }
    }
    return out;
  }, { cid, supA, supB });
  created.suppliers.push(sup.A, sup.B); created.prices.push(...(sup.prices || []));

  // ================= PARÇALI EN: ölçü girişi =================
  const custName = `QA-SHARE Musteri ${TS}`;
  await nav(page, '/measurements/new');
  await page.getByPlaceholder('Müşteri adı soyadı').fill(custName);
  let c0 = cards().nth(0);
  await c0.getByLabel(/^Ürün Tipi/).selectOption('stor');
  await c0.getByLabel(/^Tedarikçi/).selectOption({ label: supA });
  await c0.getByLabel('Oda / Alan Adı').fill('Salon');
  await c0.getByRole('checkbox', { name: /Parçalı En/ }).check();
  const names = ['Sol duvar', 'Pencere', 'Sağ duvar', 'Sürgülü kapı sol', 'Sürgülü kapı sağ'];
  const cms = ['40', '180', '30', '75', '75'];
  for (let i = 0; i < 5; i++) {
    if (i > 0) await c0.getByRole('button', { name: /Parça Ekle/ }).click();
    await c0.getByLabel(`Parça ${i + 1} bölüm adı`).fill(names[i]);
    await c0.getByLabel(`Parça ${i + 1} en (cm)`).fill(cms[i]);
  }
  rec('6. parça eklenemez (5/5 sonrası düğme yok)', (await c0.getByRole('button', { name: /Parça Ekle/ }).count()) === 0);
  let tot = await c0.getByTestId('segment-totals').innerText();
  rec('5 parça = Toplam En 400 cm', /Toplam En:\s*400 cm/.test(tot), tot.replace(/\n/g, ' | '));
  rec('Seçim yokken hesaba toplam en girdiği ekranda açık', /Ürün Eni \(hesaba giren\):\s*400 cm \(tüm parçalar\)/.test(tot));
  await c0.getByLabel('Ürün burayı kaplasın').nth(1).check();
  tot = await c0.getByTestId('segment-totals').innerText();
  rec('Yalnız pencere seçilince ürün eni 180, toplam 400', /Toplam En:\s*400 cm/.test(tot) && /Ürün Eni \(hesaba giren\):\s*180 cm/.test(tot) && !/tüm parçalar/.test(tot));
  await c0.getByLabel('Boy (cm)').fill('210');
  await c0.getByLabel('Adet', { exact: true }).fill('1');
  await c0.getByLabel(/Satış Fiyatı/).fill('500');
  await c0.getByLabel('Model Adı').first().fill('Lina');
  await c0.getByLabel('Renk', { exact: true }).first().fill('Krem');
  await c0.getByLabel('Not', { exact: true }).fill('IC-NOT-QA normal not');
  const unitTxt = await c0.locator('text=/Yuvarlanan:/').first().innerText().catch(() => '');
  rec('Hesap 180x210 üzerinden (ceil10 kuralı)', /180x210/.test(unitTxt), unitTxt);

  await page.getByRole('button', { name: 'Satır Ekle' }).click();
  const c1 = cards().nth(1);
  await c1.getByLabel(/^Ürün Tipi/).selectOption('zebra');
  await c1.getByLabel(/^Tedarikçi/).selectOption({ label: supB });
  await c1.getByLabel('Oda / Alan Adı').fill('Yatak odası');
  await c1.getByLabel('En (cm)', { exact: true }).fill('90');
  await c1.getByLabel('Boy (cm)').fill('150');
  await c1.getByLabel('Adet', { exact: true }).fill('2');
  await c1.getByLabel(/Satış Fiyatı/).fill('300');
  await c1.getByLabel('Model Adı').first().fill('Z1');
  await c1.getByLabel('Renk', { exact: true }).first().fill('Gri');
  rec('2. ürün parçasız normal en×boy', (await c1.getByRole('checkbox', { name: /Parçalı En/ }).isChecked()) === false);

  // geçersiz değer kaydedilmez
  await c1.getByLabel('Boy (cm)').fill('0');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await page.waitForTimeout(800);
  rec('Boy=0 kaydedilmez (hata gösterilir)', /boy 0'dan büyük/.test(await body(page)) && /#\/measurements/.test(page.url()));
  await c1.getByLabel('Boy (cm)').fill('150');

  await page.getByRole('button', { name: 'Kaydet' }).click();
  await page.waitForURL(/#\/quotes/, { timeout: 25000 });
  await page.waitForTimeout(1800);
  const grp = () => page.locator('div').filter({ hasText: custName }).filter({ has: page.getByRole('button', { name: /Siparişe Çevir/ }) }).last();
  let qt = await grp().innerText();
  rec('Teklif ekranında toplam en 400 ve parçalar sıralı', /Toplam en 400 cm: Sol duvar 40 cm \+ Pencere 180 cm \+ Sağ duvar 30 cm \+ Sürgülü kapı sol 75 cm \+ Sürgülü kapı sağ 75 cm/.test(qt));
  rec('Teklif ekranında teknik işaret görünmüyor', !/Parcalar|\[Grup|\[Photos/.test(await body(page).then((t) => t.slice(t.indexOf(custName) - 10, t.indexOf(custName) + 1500))));

  // ---- yeniden aç (Düzenle) ----
  await grp().getByRole('button', { name: /Düzenle/ }).click();
  await page.waitForURL(/#\/measurements/, { timeout: 15000 });
  await page.waitForTimeout(2500);
  c0 = cards().nth(0); const c1b = cards().nth(1);
  await c0.getByTestId('segment-row').first().waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(500);
  const rows = await c0.getByTestId('segment-row').count();
  const vals = []; for (let i = 0; i < rows; i++) vals.push([await c0.getByLabel(`Parça ${i + 1} bölüm adı`).inputValue(), await c0.getByLabel(`Parça ${i + 1} en (cm)`).inputValue()]);
  rec('Yeniden açınca 5 parça adı/sırası/ölçüsü aynen', rows === 5 && JSON.stringify(vals) === JSON.stringify(names.map((n, i) => [n, cms[i]])), JSON.stringify(vals));
  const checked = []; for (let i = 0; i < 5; i++) checked.push(await c0.getByLabel('Ürün burayı kaplasın').nth(i).isChecked());
  rec('Seçim (yalnız Pencere) korunuyor', JSON.stringify(checked) === '[false,true,false,false,false]', JSON.stringify(checked));
  tot = await c0.getByTestId('segment-totals').innerText();
  rec('Yeniden açınca 400 / 180', /Toplam En:\s*400 cm/.test(tot) && /\(hesaba giren\):\s*180 cm/.test(tot));
  rec('İki ürün birbirine karışmadı (2. ürün: parçasız, 90x150, adet 2)', (await c1b.getByTestId('segment-row').count()) === 0 && (await c1b.getByLabel('En (cm)', { exact: true }).inputValue()) === '90' && (await c1b.getByLabel('Boy (cm)').inputValue()) === '150' && (await c1b.getByLabel('Adet', { exact: true }).inputValue()) === '2');
  const noteVal = await c0.locator('textarea').first().inputValue();
  rec('Normal not korunuyor, teknik işaret not alanında yok', noteVal === 'IC-NOT-QA normal not', JSON.stringify(noteVal));
  rec('Ölçü düzenleme ekranında işaret metni yok', !/\[Parcalar/.test(await body(page)));
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await page.waitForURL(/#\/quotes/, { timeout: 25000 });
  await page.waitForTimeout(1800);

  const dbAppts = await ev(async (n) => {
    const sb = window.supabase;
    const { data: c } = await sb.from('customers').select('id').eq('name', n).order('created_at', { ascending: false }).limit(1);
    const { data: a } = await sb.from('appointments').select('id,product_type,width_cm,height_cm,quantity,note').eq('customer_id', c[0].id);
    return { cust: c[0].id, a };
  }, custName);
  created.customers.push(dbAppts.cust); created.appts.push(...dbAppts.a.map((x) => x.id));
  const aStor = dbAppts.a.find((x) => x.product_type === 'stor'); const aZeb = dbAppts.a.find((x) => x.product_type === 'zebra');
  rec('Tekrar kaydedince DB: stor width=180 (kaplanan), zebra 90x150', aStor?.width_cm === 180 && aZeb?.width_cm === 90 && aZeb?.height_cm === 150 && dbAppts.a.length === 2);
  rec('Zebra kaydında parça işareti yok, stor kaydında 1 işaret', !/Parcalar/.test(aZeb.note) && (aStor.note.match(/\[Parcalar:/g) || []).length === 1);

  // ---- teklif → sipariş ----
  await page.locator('input[type="date"]').first().waitFor({ timeout: 10000 });
  await grp().locator('input[type="date"]').fill(new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
  await grp().getByRole('button', { name: /Siparişe Çevir/ }).click();
  await page.waitForTimeout(4000);
  const ord = await ev(async (cust) => {
    const sb = window.supabase;
    const { data: o } = await sb.from('orders').select('id,total_amount').eq('customer_id', cust).order('created_at', { ascending: false }).limit(1);
    const { data: it } = await sb.from('order_items').select('id,product_type,width_cm,height_cm,area_m2,note,supplier_id,product_options').eq('order_id', o[0].id);
    return { id: o[0].id, items: it };
  }, dbAppts.cust);
  created.orders.push(ord.id);
  const oStor = ord.items.find((x) => x.product_type === 'stor'); const oZeb = ord.items.find((x) => x.product_type === 'zebra');
  const ws = oStor?.product_options?.width_segments;
  rec('Siparişte stor eni 180 (hesaba giren), alan 1.8×2.1=3.78', oStor?.width_cm === 180 && Math.abs(Number(oStor.area_m2) - 3.78) < 0.01, `w=${oStor?.width_cm} a=${oStor?.area_m2}`);
  rec('Siparişte toplam duvar eni 400, kaplanan 180', ws?.total_cm === 400 && ws?.covered_cm === 180);
  rec('Sipariş parçaları sıra/ad/değer aynen', JSON.stringify((ws?.parts || []).map((p) => [p.name, String(p.cm)])) === JSON.stringify(names.map((n, i) => [n, cms[i]])));
  rec('Sipariş kalemi notunda teknik işaret yok', !ord.items.some((x) => /Parcalar/.test(x.note || '')));
  rec('Zebra kalemi 90x150, parçasız', oZeb?.width_cm === 90 && oZeb?.height_cm === 150 && !oZeb?.product_options?.width_segments);
  rec('Her kalem kendi tedarikçisine bağlı', oStor?.supplier_id === sup.A && oZeb?.supplier_id === sup.B);

  // ================= sipariş detayı =================
  await nav(page, `/orders/${ord.id}`); await page.getByText(/Sipariş No:/).first().waitFor({ timeout: 45000 }).catch(() => {});
  await page.locator('tr', { hasText: /STOR/i }).first().locator('td').first().click();
  await page.waitForTimeout(600);
  if (process.env.QA_SHOT_DIR) await page.screenshot({ path: process.env.QA_SHOT_DIR + '/order.png', fullPage: true });
  let ob = await body(page);
  rec('Sipariş detayında Toplam En 400 + parçalar listeleniyor', /Toplam En \/ Parçalar/.test(ob) && /400 cm — Sol duvar 40 cm \+ Pencere 180 cm/.test(ob));
  rec('Sipariş detayında [Parcalar] işareti yok', !/Parcalar/.test(ob));
  console.log('INFO  sipariş detayında [Grup:] işareti görünüyor mu (önceden var olan davranış):', /\[Grup:/.test(ob));

  // ---- kalemi düzenle: field_info + width_segments korunmalı ----
  const poBefore = oStor.product_options;
  await page.getByTitle('Düzenle').first().click();
  await page.waitForTimeout(800);
  await page.getByPlaceholder('Tedarikçi notu (mesaja girer)').fill('Zincir sağ');
  await page.getByRole('button', { name: /SATIRI GÜNCELLE/ }).click();
  await page.waitForTimeout(3000);
  const after = await ev(async (id) => { const { data } = await window.supabase.from('order_items').select('product_type,width_cm,product_options,supplier_id').eq('order_id', id); return data; }, ord.id);
  const aS = after.find((x) => x.product_type === 'stor');
  rec('Düzenleme sonrası width_segments korunuyor', JSON.stringify(aS?.product_options?.width_segments) === JSON.stringify(poBefore.width_segments), JSON.stringify(aS?.product_options?.width_segments)?.slice(0, 80));
  rec('Düzenleme sonrası field_info korunuyor', !!poBefore.field_info && JSON.stringify(aS?.product_options?.field_info) === JSON.stringify(poBefore.field_info), JSON.stringify(poBefore.field_info));
  rec('Tedarikçi notu kaydedildi', aS?.product_options?.supplier_note === 'Zincir sağ');

  // ================= WhatsApp paylaşımı =================
  const before = await snapshotMoney([sup.A, sup.B], ord.id);
  await nav(page, `/orders/${ord.id}`); await page.getByText(/Sipariş No:/).first().waitFor({ timeout: 45000 }).catch(() => {});
  const open = async () => { await page.getByTestId('supplier-whatsapp-btn').click(); await page.getByRole('dialog').waitFor(); };
  await open();
  await page.getByTestId('share-supplier-select').selectOption(sup.A);
  let msgA = await page.getByTestId('share-message').innerText();
  const refNo = ord.id.slice(0, 8).toUpperCase();
  rec('A mesajı: sipariş no, ürün, renk, ölçü, adet, tedarikçi notu', msgA.includes(`Sipariş No: #${refNo}`) && /Stor - Lina/.test(msgA) && /Renk: Krem/.test(msgA) && /Ölçü: 180 × 210 cm/.test(msgA) && /Adet: 1/.test(msgA) && /Not: Zincir sağ/.test(msgA), msgA.replace(/\n/g, ' | '));
  rec('A mesajında yalnız A kalemleri (zebra/Z1 yok)', !/Zebra|Z1|Gri|90 ×/.test(msgA));
  rec('Mesajda müşteri adı, fiyat, iç not yok', !msgA.includes(custName) && !/IC-NOT|500|300|100/.test(msgA) && !/QA-SHARE Musteri/.test(msgA));
  const href = await page.getByTestId('share-open-whatsapp').getAttribute('href');
  rec('A için WhatsApp bağlantısı doğru numara + aynı mesaj', href?.startsWith('https://wa.me/905550000001?text=') && decodeURIComponent(href.split('?text=')[1]) === msgA, href?.slice(0, 40));
  await page.getByTestId('share-open-whatsapp').click({ trial: false }).catch(() => {});
  await page.waitForTimeout(1200);
  rec('Tarayıcıda wa.me isteği tetiklendi ve engellendi (gönderilmedi)', waRequests.some((u) => u.startsWith('https://wa.me/905550000001?text=')), `${waRequests.length} istek`);
  await page.getByTestId('share-supplier-select').selectOption(sup.B);
  let msgB = await page.getByTestId('share-message').innerText();
  rec('B mesajı: Zebra, Z1, Gri, 90 × 150, adet 2; A kalemi yok', /Zebra - Z1/.test(msgB) && /Renk: Gri/.test(msgB) && /Ölçü: 90 × 150 cm/.test(msgB) && /Adet: 2/.test(msgB) && !/Stor|Lina|Krem|180/.test(msgB), msgB.replace(/\n/g, ' | '));
  rec('Telefonu eksik B: uyarı görünür, WhatsApp düğmesi yok', (await page.getByTestId('share-phone-warning').innerText()).includes('telefonu yok') && (await page.getByTestId('share-open-whatsapp').count()) === 0);
  await page.getByTestId('share-copy').click();
  await page.waitForTimeout(500);
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  rec('Mesajı Kopyala panoya B mesajını yazdı', clip.split(String.fromCharCode(13)).join('') === msgB && /Kopyalandı/.test(await page.getByTestId('share-copy').innerText()), `clipLen=${clip.length} msgLen=${msgB.length} btn=${await page.getByTestId('share-copy').innerText()}`);
  await page.getByRole('button', { name: 'Kapat' }).click();
  await ev(async (id) => { await window.supabase.from('suppliers').update({ phone: '123' }).eq('id', id); }, sup.B);
  await nav(page, `/orders/${ord.id}`); await page.getByText(/Sipariş No:/).first().waitFor({ timeout: 45000 }).catch(() => {});
  await open();
  await page.getByTestId('share-supplier-select').selectOption(sup.B);
  rec('Geçersiz telefonlu B: "geçersiz" uyarısı + kopyalama seçeneği', /geçersiz/.test(await page.getByTestId('share-phone-warning').innerText()) && (await page.getByTestId('share-copy').count()) === 1 && (await page.getByTestId('share-open-whatsapp').count()) === 0);
  await page.getByRole('button', { name: 'Kapat' }).click();
  for (let i = 0; i < 2; i++) { await open(); await page.getByTestId('share-supplier-select').selectOption(sup.A); await page.getByTestId('share-copy').click(); await page.getByRole('button', { name: 'Kapat' }).click(); }
  const afterSnap = await snapshotMoney([sup.A, sup.B], ord.id);
  rec('Tekrarlı paylaşım: tedarikçi hareketi/borç bakiyesi/kalem/sipariş/gider değişmedi', JSON.stringify(before) === JSON.stringify(afterSnap), JSON.stringify(before) + ' vs ' + JSON.stringify(afterSnap));
  rec('Tedarikçi borcu gerçekten var (sıfır değil, test anlamlı)', before.debt > 0, `debt=${before.debt}`);

  // ================= Eski tek en×boy kayıt =================
  const legacyName = `QA-SHARE Eski ${TS}`;
  await nav(page, '/measurements/new');
  await page.getByPlaceholder('Müşteri adı soyadı').fill(legacyName);
  c0 = cards().nth(0);
  await c0.getByLabel(/^Ürün Tipi/).selectOption('tul');
  await c0.getByLabel('En (cm)', { exact: true }).fill('200');
  await c0.getByLabel('Boy (cm)').fill('250');
  await c0.getByLabel(/Satış Fiyatı/).fill('420');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await page.waitForURL(/#\/quotes/, { timeout: 25000 });
  await page.waitForTimeout(1800);
  const lgrp = () => page.locator('div').filter({ hasText: legacyName }).filter({ has: page.getByRole('button', { name: /Siparişe Çevir/ }) }).last();
  rec('Parçasız kayıtta parça satırı çıkmıyor', (await lgrp().getByTestId('quote-segments').count()) === 0);
  await lgrp().locator('input[type="date"]').fill(new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10));
  await lgrp().getByRole('button', { name: /Siparişe Çevir/ }).click();
  await page.waitForTimeout(4000);
  const lg = await ev(async (n) => {
    const sb = window.supabase;
    const { data: c } = await sb.from('customers').select('id').eq('name', n).limit(1);
    const { data: ap } = await sb.from('appointments').select('id').eq('customer_id', c[0].id);
    const { data: o } = await sb.from('orders').select('id').eq('customer_id', c[0].id).limit(1);
    const { data: it } = await sb.from('order_items').select('width_cm,height_cm,product_options').eq('order_id', o[0].id);
    return { c: c[0].id, ap: ap.map((x) => x.id), o: o[0].id, it };
  }, legacyName);
  created.customers.push(lg.c); created.appts.push(...lg.ap); created.orders.push(lg.o);
  rec('Eski tek-ölçülü kayıt teklif→siparişe çevrildi (200x250, parça yok)', lg.it.length === 1 && lg.it[0].width_cm === 200 && lg.it[0].height_cm === 250 && !lg.it[0].product_options?.width_segments);

  // ================= Seçimsiz parçalı en =================
  const nsName = `QA-SHARE Secimsiz ${TS}`;
  await nav(page, '/measurements/new');
  await page.getByPlaceholder('Müşteri adı soyadı').fill(nsName);
  c0 = cards().nth(0);
  await c0.getByLabel(/^Ürün Tipi/).selectOption('stor');
  await c0.getByRole('checkbox', { name: /Parçalı En/ }).check();
  await c0.getByLabel('Parça 1 bölüm adı').fill('Sol'); await c0.getByLabel('Parça 1 en (cm)').fill('130');
  await c0.getByRole('button', { name: /Parça Ekle/ }).click();
  await c0.getByLabel('Parça 2 bölüm adı').fill('Sağ'); await c0.getByLabel('Parça 2 en (cm)').fill('70');
  await c0.getByLabel('Boy (cm)').fill('220'); await c0.getByLabel(/Satış Fiyatı/).fill('500');
  tot = await c0.getByTestId('segment-totals').innerText();
  rec('Seçimsiz: toplam 200 kullanılıyor ve "(tüm parçalar)" yazıyor', /Toplam En:\s*200 cm/.test(tot) && /hesaba giren\):\s*200 cm \(tüm parçalar\)/.test(tot));
  await c0.getByLabel('Parça 2 en (cm)').fill('0');
  await page.getByRole('button', { name: 'Kaydet' }).click(); await page.waitForTimeout(800);
  rec('Parça eni 0 ise kaydedilmez', /geçerli bir sayı/.test(await body(page)) && /#\/measurements/.test(page.url()));
  await c0.getByLabel('Parça 2 en (cm)').fill('-5');
  rec('Negatif değer yazılamaz (alan boş kalır)', (await c0.getByLabel('Parça 2 en (cm)').inputValue()) !== '-5');
  await c0.getByLabel('Parça 2 en (cm)').fill('70');
  await page.getByRole('button', { name: 'Kaydet' }).click();
  await page.waitForURL(/#\/quotes/, { timeout: 25000 });
  const ns = await ev(async (n) => {
    const sb = window.supabase;
    const { data: c } = await sb.from('customers').select('id').eq('name', n).limit(1);
    const { data: ap } = await sb.from('appointments').select('id,width_cm').eq('customer_id', c[0].id);
    return { c: c[0].id, ap };
  }, nsName);
  created.customers.push(ns.c); created.appts.push(...ns.ap.map((x) => x.id));
  rec('Seçimsiz kayıt DB: width_cm=200 (toplam)', ns.ap.length === 1 && ns.ap[0].width_cm === 200);

  // ================= Sızıntı: diğer ekranlar =================
  const leaks = [];
  for (const h of ['/quotes', `/orders/${ord.id}`, '/orders', '/customers', '/dashboard']) {
    await nav(page, h); if (/Parcalar/.test(await body(page))) leaks.push(h);
  }
  const apId = dbAppts.a.find((x) => x.product_type === 'stor').id;
  await nav(page, `/appointments/${apId}`);
  const apBody = await body(page);
  rec('Randevu detayında teknik işaret görünmüyor', !/Parcalar/.test(apBody), apBody.slice(0, 0));
  rec('Diğer ekranlarda (teklif/sipariş/liste/müşteri/panel) işaret yok', leaks.length === 0, leaks.join(','));
  await nav(page, `/orders/${ord.id}`); await page.getByText(/Sipariş No:/).first().waitFor({ timeout: 45000 }).catch(() => {});
  const printable = await page.evaluate(() => document.documentElement.outerHTML.includes('[Parcalar'));
  rec('Sipariş sayfası DOM/yazdırma içeriğinde işaret yok', !printable);

  // ================= Firma izolasyonu (B) =================
  if (!B) { console.log('SKIP  B hesabı tanımlı değil: izolasyon DENENEMEDİ'); }
  else {
    const { c: ctxB, p: pb } = await mkCtx(B);
    await login(pb, B);
    const evB = (fn, arg) => pb.evaluate(fn, arg);
    const res = await evB(async ({ order, sups, cust }) => {
      const sb = window.supabase;
      const o = await sb.from('orders').select('id').eq('id', order);
      const oi = await sb.from('order_items').select('id').eq('order_id', order);
      const s = await sb.from('suppliers').select('id,phone').in('id', sups);
      const t = await sb.from('supplier_transactions').select('id').in('supplier_id', sups);
      const a = await sb.from('appointments').select('id').eq('customer_id', cust);
      const w = await sb.from('suppliers').update({ phone: '999' }).in('id', sups).select('id');
      return { o: o.data?.length, oi: oi.data?.length, s: s.data?.length, t: t.data?.length, a: a.data?.length, w: w.data?.length ?? 0 };
    }, { order: ord.id, sups: [sup.A, sup.B], cust: dbAppts.cust });
    rec('B firması A\'nın sipariş/kalem/tedarikçi/hareket/ölçü kayıtlarını okuyamıyor', Object.entries(res).filter(([k]) => k !== 'w').every(([, v]) => v === 0), JSON.stringify(res));
    rec('B firması A\'nın tedarikçisini güncelleyemiyor', res.w === 0);
    await nav(pb, `/orders/${ord.id}`);
    await pb.getByText(/bulunamadı|yüklenemedi|görüntüleme yetkiniz/i).first().waitFor({ timeout: 30000 }).catch(() => {});
    const bb = await body(pb);
    rec('B ekranında A siparişi açılmıyor (veri sızmıyor)', !bb.includes(custName) && !bb.includes('Tedarikçiye WhatsApp'), bb.slice(0, 80).replace(/\n/g, ' '));
    await ctxB.close();
  }
} catch (e) {
  fail++;
  console.log('HATA:', e.message);
} finally {
  await ev(async (c) => {
    const sb = window.supabase;
    try {
      for (const oid of c.orders) {
        await sb.from('expenses').delete().eq('order_id', oid);
        await sb.from('installation_jobs').delete().eq('order_id', oid);
        await sb.from('payments').delete().eq('order_id', oid);
        await sb.from('income').delete().eq('order_id', oid);
        await sb.from('order_items').delete().eq('order_id', oid);
        const d = await sb.from('orders').delete().eq('id', oid);
        if (d.error) await sb.from('orders').update({ status: 'cancelled' }).eq('id', oid);
      }
      for (const a of c.appts) await sb.from('appointments').delete().eq('id', a);
      for (const id of c.suppliers) await sb.from('supplier_transactions').delete().eq('supplier_id', id);
      for (const id of c.customers) await sb.from('customers').delete().eq('id', id);
      for (const id of c.prices) await sb.from('supplier_product_prices').delete().eq('id', id);
      for (const id of c.suppliers) await sb.from('suppliers').delete().eq('id', id);
    } catch { /* */ }
  }, created).catch(() => {});
  await browser.close();
}
console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nTUM KONTROLLER GECTI');
process.exit(fail ? 1 : 0);
