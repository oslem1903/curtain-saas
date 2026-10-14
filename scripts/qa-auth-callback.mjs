// Kayit dogrulama donus sayfasi (#/auth/callback) davranisi — Supabase ag cagrilari SAHTE (yerel dogrulama).
// GERCEK e-posta/Android testi DEGILDIR.
//   node scripts/qa-auth-callback.mjs [temelUrl]
import { chromium } from '@playwright/test';

const BASE = (process.argv[2] || 'http://localhost:5199').replace(/\/$/, '');
let fail = 0;
const rec = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'qa@example.test', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const user = { id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated', email: 'qa@example.test', email_confirmed_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };

async function run(label, { pending, type }) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  if (pending) await ctx.addInitScript(() => localStorage.setItem('perdepro_pending_signup_at', String(Date.now())));
  let logouts = 0;
  await ctx.route('**/auth/v1/user*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) }));
  await ctx.route('**/auth/v1/logout*', (r) => { logouts++; r.fulfill({ status: 204, body: '' }); });
  await ctx.route('**/auth/v1/token*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, user }) }));
  await ctx.route('**/rest/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await ctx.route('**/rpc/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: 'null' }));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/#/auth/callback#access_token=${jwt}&refresh_token=r&expires_in=3600&token_type=bearer&type=${type}`);
  await page.waitForTimeout(3500);
  const body = await page.locator('body').innerText();
  const deep = await page.locator('a[href^="com.curtainsaas.app://"]').count();
  const hasSession = await page.evaluate(() => Object.keys(localStorage).some((k) => /^sb-.*-auth-token$/.test(k) && localStorage.getItem(k)));
  console.log(`--- ${label}`);
  await browser.close();
  return { body, deep, hasSession, logouts, url: page.url() };
}

let r = await run('signup, bu tarayicida baslatilmadi (bilgisayarda Gmail)', { pending: false, type: 'signup' });
rec('"E-posta doğrulandı" sayfasi bos ekran degil', /E-posta doğrulandı/.test(r.body));
rec('"Uygulamayı aç" (ozel sema) baglantisi var', r.deep === 1);
rec('"Bu tarayicida giris yap" secenegi var', /Bu tarayıcıda giriş yap/.test(r.body));
rec('bu tarayicida oturum BIRAKILMADI', !r.hasSession);
rec('otomatik panele/firma olusturmaya yonlenmedi', /auth\/callback/.test(r.url));

r = await run('signup, bu tarayicida baslatildi (ayni cihazda dogrulama)', { pending: true, type: 'signup' });
rec('ayni cihazda eski akis: "Kaydı başlattığınız uygulamaya dönüp" sayfasi GOSTERILMEZ', !/Kaydı başlattığınız uygulamaya dönüp/.test(r.body));

r = await run('recovery (sifre sifirlama) akisi etkilenmez', { pending: false, type: 'recovery' });
rec('recovery -> /reset-password', /reset-password/.test(r.url), r.url.split('#')[1]?.slice(0, 30));

// --- Sifre sifirlama: telefondaki uygulamadan istenen baglanti bilgisayarda acilir (sifirlama bu tarayicida baslatilmadi)
async function resetRun(pending) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  if (pending) await ctx.addInitScript(() => localStorage.setItem('perdepro_pending_reset_at', String(Date.now())));
  await ctx.route('**/auth/v1/user*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) }));
  await ctx.route('**/auth/v1/logout*', (r) => r.fulfill({ status: 204, body: '' }));
  await ctx.route('**/auth/v1/token*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ access_token: jwt, refresh_token: 'r', token_type: 'bearer', expires_in: 3600, user }) }));
  const page = await ctx.newPage();
  await page.goto(`${BASE}/#/reset-password#access_token=${jwt}&refresh_token=r&expires_in=3600&token_type=bearer&type=recovery`);
  await page.waitForTimeout(2500);
  await page.locator('input[autocomplete="new-password"]').nth(0).fill('Yeni-Parola-123');
  await page.locator('input[autocomplete="new-password"]').nth(1).fill('Yeni-Parola-123');
  await page.getByRole('button', { name: /Şifreyi Güncelle/ }).click();
  await page.waitForTimeout(3500);
  const body = await page.locator('body').innerText();
  const deep = await page.locator('a[href^="com.curtainsaas.app://"]').count();
  const out = { body, deep, url: page.url() };
  await browser.close();
  return out;
}
console.log('--- sifre sifirlama, baska cihazda acildi');
r = await resetRun(false);
rec('sifre guncellendi sayfasi bos ekran degil, "Uygulamayi ac" var', /Şifreniz güncellendi/.test(r.body) && r.deep === 1);
rec('otomatik girise atilmadi (secenekler gorunuyor)', /reset-password/.test(r.url) && /Bu tarayıcıda giriş yap/.test(r.body));
console.log('--- sifre sifirlama, ayni tarayicida baslatildi');
r = await resetRun(true);
rec('ayni tarayicida eski akis: girise yonlenir', /login/.test(r.url));

console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nTUM KONTROLLER GECTI');
process.exit(fail ? 1 : 0);
