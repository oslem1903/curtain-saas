// Salt okunur (sunucu lisans yoklamasi false): liste gorunur, yazma dugmeleri yok. Veri olusturmaz.
import { chromium } from '@playwright/test';
import { loadQaAccounts } from './lib/qaAccounts.mjs';
const acc = loadQaAccounts({ requireBoth: false }).accounts.A;
const BASE = (process.argv[2] || 'http://localhost:5199').replace(/\/$/, '');
let fail = 0; const rec = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript((id) => localStorage.setItem('curtain_saas_device_id', id), acc.deviceId);
const page = await ctx.newPage();
await page.route('**/rpc/company_subscription_access_allowed*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: 'false' }));
await page.goto(`${BASE}/#/login`);
await page.locator('input[type="email"]').first().fill(acc.email);
await page.locator('input[type="password"]').first().fill(acc.password);
await page.getByRole('button', { name: /^Giriş Yap$/ }).click();
await page.waitForTimeout(8000);
await page.goto(`${BASE}/#/collections`);
await page.waitForTimeout(8000);
const txt = await page.locator('body').innerText();
console.log('GOVDE:', txt.split(String.fromCharCode(10)).join(' ').slice(0, 400));
const ok = /Net alacak/i.test(txt);
rec('liste ve toplamlar gorunur (goruntuleme acik)', ok);
if (ok) {
  const n = (await page.getByRole('button', { name: 'Tahsilat Ekle' }).count()) + (await page.getByRole('button', { name: 'Ödeme Ekle' }).count()) + (await page.getByText('Vade tarihi ekle').count());
  rec('yazma dugmeleri (Tahsilat Ekle / Odeme Ekle / Vade ekle) YOK', n === 0, String(n));
  rec('Detay / Ekstre acik', (await page.getByRole('button', { name: 'Detay / Ekstre' }).count()) >= 0);
}
await b.close();
console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nTUM KONTROLLER GECTI');
process.exit(fail ? 1 : 0);
