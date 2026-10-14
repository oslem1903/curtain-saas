// Silme dogrulamasi (QA firmasi, kendi olusturdugu kayitlar): basarili silme, 0 satir etkilenme (RLS benzeri),
// salt okunur engeli. Basarisiz silmede kayit listeden kaybolmamali, basari bildirimi cikmamali.
//   node scripts/qa-strict-delete.mjs [temelUrl]
import { chromium } from '@playwright/test';
import { loadQaAccounts } from './lib/qaAccounts.mjs';

const BASE = (process.argv[2] || 'http://localhost:5199').replace(/\/$/, '');
const acc = loadQaAccounts({ requireBoth: false }).accounts.A;
let fail = 0;
const rec = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript((id) => localStorage.setItem('curtain_saas_device_id', id), acc.deviceId);
const page = await ctx.newPage();
const dialogs = [];
page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept().catch(() => {}); });
let supplierId = null;
let cidForClean = null;
try {
  await page.goto(`${BASE}/#/login`);
  await page.locator('input[type="email"]').first().fill(acc.email);
  await page.locator('input[type="password"]').first().fill(acc.password);
  await page.getByRole('button', { name: /^Giriş Yap$/ }).click();
  await page.waitForURL(/#\/(dashboard|app\/dashboard|field)/, { timeout: 60000 });

  const name = `QA-DEL Tedarikci ${Date.now()}`;
  const seed = await page.evaluate(async (n) => {
    const sb = window.supabase;
    const { data: u } = await sb.auth.getUser();
    const { data: m } = await sb.from('company_members').select('company_id').eq('user_id', u.user.id).limit(1);
    const cid = m[0].company_id;
    const { data: s, error } = await sb.from('suppliers').insert([{ company_id: cid, name: n }]).select('id').single();
    if (error) return { error: error.message };
    const rows = [1, 2, 3].map((i) => ({ company_id: cid, supplier_id: s.id, transaction_type: 'payment', amount: i, description: `QA-DEL islem ${i}`, transaction_date: new Date().toISOString(), payment_method: 'cash' }));
    const { error: e2 } = await sb.from('supplier_transactions').insert(rows);
    return { cid, sid: s.id, e2: e2?.message };
  }, name);
  supplierId = seed.sid; cidForClean = seed.cid;
  rec('QA tedarikci + 3 islem olusturuldu', !seed.error && !seed.e2, JSON.stringify(seed));

  const countTx = () => page.evaluate(async (sid) => { const { count } = await window.supabase.from('supplier_transactions').select('id', { count: 'exact', head: true }).eq('supplier_id', sid); return count; }, supplierId);

  const openCari = async () => {
    await page.goto(`${BASE}/#/suppliers`);
    await page.waitForTimeout(2500);
    await page.getByText(name).first().locator('xpath=ancestor::div[.//button[normalize-space()="Ürünler"]][1]').getByRole('button', { name: 'Ürünler', exact: true }).first().click();
    await page.waitForTimeout(1200);
    await page.locator('div.border-b').filter({ has: page.getByRole('button', { name: 'Ödemeler', exact: true }) }).getByRole('button', { name: 'Cari', exact: true }).first().click();
    await page.waitForTimeout(1500);
  };

  // --- 1) 0 satir etkilenme (RLS DELETE filtresi ile ayni tel davranisi: 200 + [])
  await openCari();
  await page.route('**/rest/v1/supplier_transactions*', async (route) => {
    if (route.request().method() === 'DELETE') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    return route.continue();
  });
  dialogs.length = 0;
  console.log('URL:', page.url());
  await page.screenshot({ path: 'test-results/strict-del-debug.png', fullPage: true });
  await page.getByTitle('İşlemi Sil').first().waitFor({ timeout: 15000 }).catch(() => {});
  const before = await page.getByTitle('İşlemi Sil').count();
  await page.getByTitle('İşlemi Sil').first().click();
  await page.waitForTimeout(2500);
  const afterZero = await page.getByTitle('İşlemi Sil').count();
  const bodyZero = await page.locator('body').innerText();
  rec('0 satir: hata bildirimi gosterildi', dialogs.some((m) => /silinemedi/i.test(m)), dialogs.join(' | ').slice(0, 160));
  rec('0 satir: "Cari işlemi silindi" basari bildirimi YOK', !/Cari işlemi silindi/.test(bodyZero));
  rec('0 satir: kayit listeden KAYBOLMADI', afterZero === before && (await countTx()) === 3, `${before}->${afterZero}, db=${await countTx()}`);
  await page.unroute('**/rest/v1/supplier_transactions*');

  // --- 2) gercek basarili silme
  dialogs.length = 0;
  await page.getByTitle('İşlemi Sil').first().click();
  await page.waitForTimeout(3000);
  const dbAfter = await countTx();
  const bodyOk = await page.locator('body').innerText();
  rec('basarili silme: DB 3 -> 2', dbAfter === 2, String(dbAfter));
  rec('basarili silme: basari bildirimi var, hata yok', /Cari işlemi silindi/.test(bodyOk) && !dialogs.some((m) => /silinemedi/i.test(m)));
  rec('basarili silme: liste 3 -> 2', (await page.getByTitle('İşlemi Sil').count()) === 2);

  // --- 3) salt okunur: sunucu lisans yoklamasi false -> istemci yazmayi engeller
  // Taze tarayici baglami: sunucu lisans yoklamasi false -> AuthContext istemciyi salt okunura alir
  const roCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await roCtx.addInitScript((id) => localStorage.setItem('curtain_saas_device_id', id), acc.deviceId);
  const ro = await roCtx.newPage();
  ro.on('dialog', async (d) => { dialogs.push('RO:' + d.message()); await d.accept().catch(() => {}); });
  await ro.route('**/rpc/company_subscription_access_allowed*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: 'false' }));
  await ro.route('**/rpc/company_subscription_access_snapshot*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_allowed: false, access_expires_at: null, server_time: new Date().toISOString() }) }));
  await ro.goto(`${BASE}/#/login`);
  await ro.locator('input[type="email"]').first().fill(acc.email);
  await ro.locator('input[type="password"]').first().fill(acc.password);
  await ro.getByRole('button', { name: /^Giriş Yap$/ }).click();
  await ro.waitForTimeout(9000);
  await ro.goto(`${BASE}/#/suppliers`);
  await ro.waitForTimeout(6000);
  const roBtns = 0;
  console.log('RO banner:', /Read-only mod aktif/i.test(await ro.locator('body').innerText()), 'url', ro.url());
  const roDel = await ro.evaluate(async (sid) => {
    const r = await window.supabase.from('supplier_transactions').delete().eq('supplier_id', sid).select('id');
    return { code: r.error?.code ?? null, msg: r.error?.message ?? null, n: r.data?.length ?? 0 };
  }, supplierId);
  rec('salt okunur: istemci DELETE istegini reddeder (READ_ONLY_MODE), 0 silindi', roDel.code === 'READ_ONLY_MODE' && roDel.n === 0, JSON.stringify(roDel).slice(0, 140));
  const dbRo = await countTx();
  rec('salt okunur: silme DB\'ye ulasmadi (2 kayit duruyor)', dbRo === 2, `db=${dbRo}, silme butonu=${roBtns}`);
  const roBody = await ro.locator('body').innerText();
  rec('salt okunur: "Cari işlemi silindi" basari bildirimi YOK', !/Cari işlemi silindi/.test(roBody));
  await ro.close();
  await roCtx.close();
} catch (e) {
  fail++; console.log('HATA:', e.message);
} finally {
  // yalniz bu betigin olusturdugu kayitlar
  if (supplierId) {
    await page.unroute('**/rest/v1/supplier_transactions*').catch(() => {});
    const res = await page.evaluate(async ({ sid, cidForClean }) => {
      const sb = window.supabase;
      const a = await sb.from('supplier_transactions').delete().eq('supplier_id', sid).select('id');
      const b = await sb.rpc('soft_delete_supplier', { p_company_id: cidForClean, p_supplier_id: sid });
      return { tx: a.data?.length, sup: JSON.stringify(b.data), e: a.error?.message || b.error?.message };
    }, { sid: supplierId, cidForClean }).catch((e) => ({ e: String(e) }));
    console.log('temizlik:', JSON.stringify(res));
  }
  await browser.close();
}
console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nTUM KONTROLLER GECTI');
process.exit(fail ? 1 : 0);
