// Canli (uretim Supabase) QA akislari — gercek arayuzde, ayrilmis QA hesaplariyla.
//
//   node scripts/qa-live-flows.mjs [temelUrl]          (varsayilan http://localhost:5173)
//   node scripts/qa-live-flows.mjs https://oslem1903-curtain-saas.vercel.app
//
// Gereken (.env.e2e): E2E_A_EMAIL/E2E_A_PASSWORD (Test Company 1, staff modulu acik), E2E_B_EMAIL/E2E_B_PASSWORD.
// Kapsam: A ve B girisi (kendi sabit cihaz id'leriyle), panel yuklenmesi, A'da musteri olusturma/silme (yazma izni),
// A'da personel karti olustur -> rol/davet kodu -> sil, e-posta/edge-function istegi OLMADIGININ kontrolu.
// Yalnizca testin kendi olusturdugu kayitlar silinir; QA firmalari/kullanicilari birakilir.
import { chromium } from '@playwright/test';
import { loadQaAccounts, passwordLogin } from './lib/qaAccounts.mjs';

const BASE = (process.argv[2] || 'http://localhost:5173').replace(/\/$/, '');
const { url, anon, accounts } = loadQaAccounts();
let fail = 0;
const rec = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };
const NOT_DEPLOYED = /company_subscription_access_(allowed|snapshot)/;

async function uiLogin(browser, acc) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.addInitScript((id) => { localStorage.setItem('curtain_saas_device_id', id); }, acc.deviceId);
  const page = await ctx.newPage();
  const seen = { fn: 0, httpErr: [], pageErr: 0, dialogs: [] };
  page.on('pageerror', () => { seen.pageErr++; });
  page.on('request', (r) => { if (/send-email|functions\/v1/.test(r.url())) seen.fn++; });
  page.on('response', (r) => {
    if (r.status() >= 400 && r.url().includes('supabase.co')) {
      const p = new URL(r.url()).pathname;
      if (!NOT_DEPLOYED.test(p) && !/auth\/v1\/(token|user)/.test(p)) seen.httpErr.push(`${r.status()} ${p.replace('/rest/v1/', '')}`);
    }
  });
  page.on('dialog', async (d) => { seen.dialogs.push(`${d.type()}`); if (d.type() === 'confirm') await d.accept(); else await d.dismiss(); });
  await page.goto(`${BASE}/#/login`);
  await page.locator('input[type="email"]').first().fill(acc.email);
  await page.locator('input[type="password"]').first().fill(acc.password);
  await page.getByRole('button', { name: /^Giriş Yap$/ }).click();
  await page.waitForURL(/#\/(dashboard|app\/dashboard|field|staff|locked)/, { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(2500);
  return { ctx, page, seen };
}

const browser = await chromium.launch();
try {
  console.log(`Temel URL: ${BASE}`);
  console.log(`Cihaz id'leri sabit ve farkli: A=${accounts.A.deviceId} B=${accounts.B.deviceId}`);

  // ---- B: giris + panel (staff modulu olmayan firma)
  const b = await uiLogin(browser, accounts.B);
  rec('B (Test Company 2) uygulamaya girdi', /#\/(dashboard|app\/dashboard|field)/.test(b.page.url()), b.page.url().split('#')[1]);
  rec('B panelinde sayfa hatasi yok', b.seen.pageErr === 0, `pageerror=${b.seen.pageErr}`);
  await b.page.goto(`${BASE}/#/staff`); await b.page.waitForTimeout(2500);
  const bStaff = await b.page.getByRole('button', { name: /Yeni Personel Kartı/ }).first().isVisible().catch(() => false);
  rec('B: staff modulu kapali firmada Personel sayfasi acilmiyor', !bStaff);
  await b.ctx.close();

  // ---- A: giris, musteri yazma, personel karti
  const a = await uiLogin(browser, accounts.A);
  rec('A (Test Company 1) uygulamaya girdi', /#\/(dashboard|app\/dashboard|field)/.test(a.page.url()), a.page.url().split('#')[1]);

  const { token } = await passwordLogin({ url, anon }, accounts.A);
  const H = { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
  const me = await (await fetch(`${url}/rest/v1/company_members?select=company_id&is_active=eq.true`, { headers: H })).json();
  const companyId = me?.[0]?.company_id;
  const cust = await fetch(`${url}/rest/v1/customers`, { method: 'POST', headers: H, body: JSON.stringify({ company_id: companyId, name: 'QA Canli Akis Musteri', phone: '5550000009' }) });
  const custRow = (await cust.json().catch(() => []))?.[0];
  rec('A: aktif denemede musteri olusturabiliyor (yazma izni)', cust.ok && !!custRow?.id, `HTTP ${cust.status}`);
  if (custRow?.id) {
    const del = await fetch(`${url}/rest/v1/customers?id=eq.${custRow.id}`, { method: 'DELETE', headers: H });
    rec('A: kendi test musterisini silebiliyor (temizlik)', del.ok, `HTTP ${del.status}`);
  }

  const NAME = 'QA Personel Karti';
  const emps = async () => (await (await fetch(`${url}/rest/v1/employees?select=id,email,target_role,invite_code&full_name=eq.${encodeURIComponent(NAME)}`, { headers: H })).json());
  await a.page.goto(`${BASE}/#/staff`); await a.page.waitForTimeout(3000);
  const addBtn = a.page.getByRole('button', { name: /Yeni Personel Kartı/ }).first();
  rec('A: Personel sayfasi acik', await addBtn.isVisible().catch(() => false));
  if ((await emps()).length === 0) {
    await addBtn.click();
    await a.page.getByPlaceholder('Örn: Mehmet Perdeci').fill(NAME);
    await a.page.getByPlaceholder('iletisim@mail.com').fill(accounts.A.email);
    await a.page.getByRole('button', { name: /Personeli Kaydet/ }).click();
    await a.page.waitForTimeout(3000);
  }
  rec('A: personel karti kaydedildi', (await emps()).length === 1);
  await a.page.goto(`${BASE}/#/staff`); await a.page.waitForTimeout(3000);
  await a.page.locator('button[title="Yetki Tanımla"]:visible').first().click();
  await a.page.waitForTimeout(800);
  await a.page.getByRole('button', { name: /Montaj Personeli/ }).click();
  await a.page.waitForTimeout(2500);
  const row = (await emps())[0];
  rec("A: rol atandi, MON- davet kodu uretildi", row?.target_role === 'installer' && /^MON-[A-Z0-9]{6}$/.test(row?.invite_code || ''));
  await a.page.getByRole('button', { name: /Vazgeç/ }).click().catch(() => {});
  await a.page.locator('button[title="Sil"]:visible').first().click().catch(() => {});
  await a.page.waitForTimeout(2500);
  let left = await emps();
  if (left.length) { await fetch(`${url}/rest/v1/employees?id=eq.${left[0].id}`, { method: 'DELETE', headers: H }); left = await emps(); }
  rec('A: test personel karti temizlendi', left.length === 0);
  rec('A: e-posta/edge-function istegi yok', a.seen.fn === 0, `fn=${a.seen.fn}`);
  rec('A: beklenmeyen HTTP>=400 yok', a.seen.httpErr.length === 0, a.seen.httpErr.slice(0, 3).join(' | '));
  await a.ctx.close();
} catch (e) {
  console.log('HATA', String(e).slice(0, 240));
  fail++;
} finally {
  await browser.close();
}
console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nTUM CANLI AKIS KONTROLLERI GECTI');
process.exit(fail ? 1 : 0);
