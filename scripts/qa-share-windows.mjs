// Windows (Electron) üzerinde "Tedarikçiye WhatsApp'tan Gönder" doğrulaması.
// Repo kökünden `electron .` ile (dist/ derlemesi, file://) çalışır; üretim Supabase'deki QA firması A.
// shell.openExternal ana süreçte YAKALANIR (gerçek WhatsApp/tarayıcı açılmaz, mesaj gönderilmez).
// Yalnız betiğin oluşturduğu kayıtları siler.   node scripts/qa-share-windows.mjs
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadQaAccounts } from './lib/qaAccounts.mjs';

const acc = loadQaAccounts({ requireBoth: false }).accounts.A;
let fail = 0;
const rec = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };
const TS = Date.now();
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'perdepro-qa-share-'));
const EXE = process.argv[2];
const app = await electron.launch({ executablePath: EXE, args: [`--user-data-dir=${userData}`], env: { ...process.env, NODE_ENV: 'production' } });
const created = { sup: [], cust: null, order: null };
let page;
try {
  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate((id) => localStorage.setItem('curtain_saas_device_id', id), acc.deviceId);
  await page.reload();
  await page.waitForTimeout(2500);
  rec('Uygulama file:// altında açıldı (Electron)', page.url().startsWith('file:'));
  await page.locator('input[type="email"]').first().fill(acc.email);
  await page.locator('input[type="password"]').first().fill(acc.password);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL(/#\/(dashboard|app\/dashboard|field)/, { timeout: 60000 });

  // Ana süreçte openExternal'ı yakala
  const REAL = process.env.QA_REAL_OPEN === '1';
  if (!REAL) await app.evaluate(({ shell }) => {
    globalThis.__opened = [];
    shell.openExternal = async (u) => { globalThis.__opened.push(String(u)); };
  });

  const seed = await page.evaluate(async ({ ts, phoneA }) => {
    const sb = window.supabase;
    const { data: { user } } = await sb.auth.getUser();
    const pr = await sb.from('profiles').select('company_id').eq('id', user.id).maybeSingle();
    let cid = pr.data?.company_id;
    if (!cid) { const m = await sb.from('company_members').select('company_id').eq('user_id', user.id).limit(1); cid = m.data?.[0]?.company_id; }
    const { data: c } = await sb.from('customers').insert([{ company_id: cid, name: `QA-SHARE Win ${ts}` }]).select('id').single();
    const mk = async (name, phone) => { const ex = (await sb.from('suppliers').select('id').eq('company_id', cid).eq('name', name).limit(1)).data?.[0]; if (ex) { await sb.from('suppliers').update({ phone }).eq('id', ex.id); return ex.id; } return (await sb.from('suppliers').insert([{ company_id: cid, name, phone }]).select('id').single()).data.id; };
    const sA = await mk('QA-SHARE Win A (sabit)', phoneA);
    const sB = await mk('QA-SHARE Win B (sabit)', null);
    const { data: o } = await sb.from('orders').insert([{ company_id: cid, customer_id: c.id, status: 'new_order', total_amount: 1000, deposit_amount: 0, paid_amount: 0, remaining_amount: 1000 }]).select('id').single();
    const items = [
      { order_id: o.id, company_id: cid, product_type: 'stor', width_cm: 180, height_cm: 210, qty: 1, unit_price: 500, line_total: 1000, area_m2: 3.78, supplier_id: sA, product_options: { model_name: 'Lina', color_name: 'Krem', supplier_note: 'Zincir sağ', width_segments: { total_cm: 400, covered_cm: 180, parts: [{ name: 'Pencere', cm: 180 }] } } },
      { order_id: o.id, company_id: cid, product_type: 'zebra', width_cm: 90, height_cm: 150, qty: 2, unit_price: 300, line_total: 600, area_m2: 1.35, supplier_id: sB, product_options: { model_name: 'Z1', color_name: 'Gri' } },
    ];
    const ins = await sb.from('order_items').insert(items);
    if (ins.error) throw new Error(ins.error.message);
    return { cust: c.id, sups: [sA, sB], order: o.id };
  }, { ts: TS, phoneA: process.env.QA_TEST_PHONE || '0555 000 00 01' });
  created.cust = seed.cust; created.sup = seed.sups; created.order = seed.order;

  await page.evaluate((id) => { window.location.hash = `#/orders/${id}`; }, seed.order);
  await page.getByText(/Sipariş No:/).first().waitFor({ timeout: 45000 });
  await page.getByTestId('supplier-whatsapp-btn').click();
  await page.getByTestId('share-supplier-select').selectOption(seed.sups[0]);
  const msg = await page.getByTestId('share-message').innerText();
  rec('Windows: A önizlemesi yalnız kendi kalemi', /Stor - Lina/.test(msg) && !/Zebra|Z1/.test(msg));
  const href = await page.getByTestId('share-open-whatsapp').getAttribute('href');
  await page.getByTestId('share-open-whatsapp').click();
  await page.waitForTimeout(1500);
  if (REAL) {
    console.log('REAL_OPEN_CLICKED', new Date().toISOString());
    if (process.stdin.isTTY) {
      console.log('>>> WhatsApp açıldıysa sohbeti ve hazır metni kontrol edin. MESAJI GÖNDERMEYİN. Bitince burada Enter tuşuna basın...');
      await new Promise((res) => { process.stdin.resume(); process.stdin.once('data', res); });
    } else await page.waitForTimeout(Number(process.env.QA_HOLD_MS || 20000));
    await page.getByTestId('share-supplier-select').selectOption(seed.sups[1]);
    rec('Windows (gerçek açılış): tıklama gerçekleşti, uygulamada ek pencere yok', app.windows().length === 1);
    throw new Error('REAL_MODE_DONE');
  }
  const opened = await app.evaluate(() => globalThis.__opened);
  rec('Windows: WhatsApp Aç → işletim sistemine doğru numara ve hazır mesaj verildi', opened.length >= 1 && opened[0] === href && opened[0].startsWith('https://wa.me/905550000001?text=') && decodeURIComponent(opened[0].split('?text=')[1]) === msg, opened[0]?.slice(0, 45));
  rec('Windows: uygulama içinde yeni pencere/sayfa açılmadı', app.windows().length === 1);
  await page.getByTestId('share-supplier-select').selectOption(seed.sups[1]);
  rec('Windows: telefonsuz tedarikçide uyarı + kopyala, WhatsApp düğmesi yok', (await page.getByTestId('share-phone-warning').count()) === 1 && (await page.getByTestId('share-open-whatsapp').count()) === 0);
  await page.getByTestId('share-copy').click();
  await page.waitForTimeout(600);
  const copied = /Kopyalandı/.test(await page.getByTestId('share-copy').innerText());
  const dialogShown = await page.getByRole('dialog').count();
  rec('Windows: Mesajı Kopyala çalıştı', copied, copied ? '' : 'pano yazılamadı');
  void dialogShown;
} catch (e) {
  if (e.message !== 'REAL_MODE_DONE') { fail++; console.log('HATA:', e.message); }
} finally {
  try {
    await page?.evaluate(async (c) => {
      const sb = window.supabase;
      if (c.order) { await sb.from('supplier_transactions').delete().in('supplier_id', c.sup); await sb.from('order_items').delete().eq('order_id', c.order); const d = await sb.from('orders').delete().eq('id', c.order); if (d.error) await sb.from('orders').update({ status: 'cancelled' }).eq('id', c.order); }
      if (c.cust) await sb.from('customers').delete().eq('id', c.cust);
      if (c.sup?.[0]) await sb.from('suppliers').update({ phone: '0555 000 00 01' }).eq('id', c.sup[0]);
    }, created);
  } catch { /* */ }
  await app.close().catch(() => {});
}
console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nTUM KONTROLLER GECTI');
process.exit(fail ? 1 : 0);
