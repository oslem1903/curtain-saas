// Uygulamadaki "Ödemeye geç" akisini (aylik + yillik) KART GIRMEDEN kontrol eder; tahsilat yapmaz.
//   node scripts/verify-pay-button-flow.mjs real     # yuklu gercek Chrome (headed, temiz profil)
//   node scripts/verify-pay-button-flow.mjs bundled  # Playwright'in kendi Chromium'u (headless) — ayri rapor
// Kart formu = PayTR sayfasinda (kendi veya iframe icinde) kart alani/input var VE "Sistem Bakimi" yok.
import { chromium } from '@playwright/test';
import { loadQaAccounts } from './lib/qaAccounts.mjs';

const kind = process.argv[2] || 'real';
const BASE = 'https://oslem1903-curtain-saas.vercel.app';
const { accounts } = loadQaAccounts({ requireBoth: false });
const acc = accounts.B;
const out = [];
const rec = (n, ok, d = '') => { out.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  [${kind}] ${n}${d ? '  -> ' + d : ''}`); };
console.log('kontrol saati (Europe/Istanbul):', new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }));

const browser = kind === 'real'
  ? await chromium.launch({ channel: 'chrome', headless: false })
  : await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript((id) => localStorage.setItem('curtain_saas_device_id', id), acc.deviceId);
const page = await ctx.newPage();
await page.goto(`${BASE}/#/login`);
await page.locator('input[type="email"]').first().fill(acc.email);
await page.locator('input[type="password"]').first().fill(acc.password);
await page.getByRole('button', { name: /^Giriş Yap$/ }).click();
await page.waitForURL(/#\/(dashboard|app\/dashboard|field)/, { timeout: 60000 });

for (const [label, idx] of [['1 aylik', 0], ['1 yillik', 1]]) {
  await page.goto(`${BASE}/#/subscription`);
  await page.waitForTimeout(3500);
  await page.getByRole('checkbox').first().check();
  const btn = page.getByRole('button', { name: /(Test ödemesine|Ödemeye) geç/ }).nth(idx);
  rec(`${label}: ödeme düğmesi (Ödemeye geç / Test ödemesine geç) etkin`, await btn.isEnabled());
  const [pop] = await Promise.all([
    ctx.waitForEvent('page', { timeout: 30000 }).catch(() => null),
    btn.click(),
  ]);
  if (!pop) { rec(`${label}: ödeme sayfası yeni sekmede açıldı`, false); continue; }
  await pop.waitForLoadState('networkidle').catch(() => {});
  await pop.waitForTimeout(4000);
  const host = new URL(pop.url()).host;
  const title = await pop.title();
  const text = (await pop.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  let inputs = await pop.locator('input').count();
  for (const f of pop.frames()) { try { inputs += await f.locator('input').count(); } catch { /* */ } }
  const maint = /Sistem Bak/i.test(title + ' ' + text);
  rec(`${label}: PayTR alan adi`, host === 'www.paytr.com', host);
  rec(`${label}: "Sistem Bakımı" yok`, !maint, `baslik="${title}"`);
  rec(`${label}: kart formu (input alanlari) var`, inputs > 0 && !maint, `${inputs} input`);
  await pop.close();
}
await browser.close();
console.log('\nNOT: kart girilmedi, odeme tamamlanmadi, gercek tahsilat DENENMEDI.');
console.log(out.every(Boolean) ? 'TUM KONTROLLER GECTI' : 'BAZI KONTROLLER BASARISIZ');
process.exit(out.every(Boolean) ? 0 : 1);
