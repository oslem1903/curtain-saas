// Abonelik ekrani yerlesim kontrolu (masaustu + mobil): kart yuksekligi, dugme hizasi, tasma, fiyat bicimi,
// onay kutusu / pasif dugme aciklamasi. Veri yazmaz, odeme baslatmaz.
//   node scripts/qa-subscription-layout.mjs [temelUrl] [A|B]
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import { loadQaAccounts } from './lib/qaAccounts.mjs';

const BASE = (process.argv[2] || 'http://localhost:5199').replace(/\/$/, '');
const { accounts } = loadQaAccounts({ requireBoth: false });
const acc = accounts[(process.argv[3] || 'A').toUpperCase()];
fs.mkdirSync('test-results/subscription', { recursive: true });
let fail = 0;
const rec = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };

const browser = await chromium.launch();
for (const vp of [{ name: 'masaustu', w: 1280, h: 900 }, { name: 'mobil', w: 375, h: 812 }]) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
  await ctx.addInitScript((id) => localStorage.setItem('curtain_saas_device_id', id), acc.deviceId);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/#/login`);
  await page.locator('input[type="email"]').first().fill(acc.email);
  await page.locator('input[type="password"]').first().fill(acc.password);
  await page.getByRole('button', { name: /^Giriş Yap$/ }).click();
  await page.waitForURL(/#\/(dashboard|app\/dashboard|field)/, { timeout: 60000 });
  await page.goto(`${BASE}/#/subscription`);
  await page.waitForTimeout(3500);

  const cards = page.locator('section[aria-labelledby="launch-prices"] .rounded-3xl');
  const n = await cards.count();
  rec(`[${vp.name}] iki paket karti`, n === 2, `${n}`);
  const boxes = [];
  for (let i = 0; i < n; i++) boxes.push(await cards.nth(i).boundingBox());
  const btns = page.getByRole('button', { name: /(Test ödemesine|Ödemeye) geç/ });
  const bb = [await btns.nth(0).boundingBox(), await btns.nth(1).boundingBox()];
  if (vp.name === 'masaustu') {
    rec('kartlar yan yana ve AYNI yukseklik', Math.abs(boxes[0].y - boxes[1].y) < 1 && Math.abs(boxes[0].height - boxes[1].height) < 1, `${boxes[0].height.toFixed(0)} / ${boxes[1].height.toFixed(0)}`);
    rec('dugmeler AYNI hizada (ust ve alt)', Math.abs(bb[0].y - bb[1].y) < 1 && Math.abs(bb[0].height - bb[1].height) < 1, `${bb[0].y.toFixed(0)} / ${bb[1].y.toFixed(0)}`);
  } else {
    rec('kartlar alt alta', boxes[1].y > boxes[0].y + boxes[0].height - 1);
    rec('kartlar esit genislikte', Math.abs(boxes[0].width - boxes[1].width) < 1, `${boxes[0].width.toFixed(0)} / ${boxes[1].width.toFixed(0)}`);
  }
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  rec(`[${vp.name}] yatay tasma yok`, over <= 1, `${over}px`);
  const txt = await page.locator('main').innerText();
  rec(`[${vp.name}] fiyatlar "499 TL" ve "4.990 TL"`, /\b499 TL\b/.test(txt) && /\b4\.990 TL\b/.test(txt) && !/₺/.test(txt.split('Açılışa Özel')[1] || ''));
  rec(`[${vp.name}] onay isaretsizken dugmeler pasif ve neden yaziyor`, (await btns.nth(0).isDisabled()) && /işaretleyene kadar pasif/.test(txt) && /Önce yukarıdaki onay kutusunu işaretleyin/.test(txt));
  await page.screenshot({ path: `test-results/subscription/${vp.name}-onaysiz.png`, fullPage: true });
  await page.getByRole('checkbox').first().check();
  rec(`[${vp.name}] onay sonrasi dugmeler etkin`, (await btns.nth(0).isEnabled()) && (await btns.nth(1).isEnabled()));
  await page.screenshot({ path: `test-results/subscription/${vp.name}-onayli.png`, fullPage: true });
  await ctx.close();
}
await browser.close();
console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nTUM KONTROLLER GECTI');
process.exit(fail ? 1 : 0);
