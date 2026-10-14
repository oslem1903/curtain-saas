// Montajci detay ekrani yerlesimi: ust uste binme / sayfa tasmasi / tablo kendi alaninda kayar. Veri KAYDETMEZ.
//   node scripts/qa-installer-layout.mjs [temelUrl]
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import { loadQaAccounts } from './lib/qaAccounts.mjs';
const BASE = (process.argv[2] || 'http://localhost:5199').replace(/\/$/, '');
const acc = loadQaAccounts({ requireBoth: false }).accounts.A;
fs.mkdirSync('test-results/installer', { recursive: true });
let fail = 0;
const rec = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };
const VPS = [['telefon-360x640', 360, 640], ['telefon-yatay-844x390', 844, 390], ['tablet-yatay-1024x600', 1024, 600], ['bluestacks-1280x720', 1280, 720]];
const browser = await chromium.launch();
for (const [name, w, h] of VPS) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript((id) => localStorage.setItem('curtain_saas_device_id', id), acc.deviceId);
  const page = await ctx.newPage();
  // SAHTE veri (gercek kayda dokunmaz): buyuk tutarlar + uzun isim ile en kotu durum
  const EID = '11111111-1111-1111-1111-111111111111';
  const json = (b) => (r) => r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) }) : r.continue();
  await page.route('**/rest/v1/employees*', json([{ id: EID, user_id: EID, full_name: 'Mehmet Ali Yilmaz Montaj Ekibi', phone: '0555 123 45 67', target_role: 'installer' }]));
  await page.route('**/rest/v1/installer_earnings*', json(Array.from({ length: 6 }, (_, i) => ({ id: `e${i}`, installer_id: EID, installation_job_id: null, order_id: null, earning_type: 'manual', total_earning: 1234567.89 + i, job_completed_date: '2026-10-0' + (i + 1), created_at: '2026-10-0' + (i + 1) + 'T10:00:00Z', metadata: {} }))));
  await page.route('**/rest/v1/installer_transactions*', json(Array.from({ length: 4 }, (_, i) => ({ id: `t${i}`, installer_id: EID, transaction_date: '2026-10-1' + i, transaction_type: 'payment', amount: 987654.32, description: 'Nakit odeme uzun aciklama metni', payment_method: 'cash', period_start: null, period_end: null, expense_id: null }))));
  await page.route('**/rest/v1/installation_jobs*', json([]));
  await page.goto(`${BASE}/#/login`);
  await page.locator('input[type="email"]').first().fill(acc.email);
  await page.locator('input[type="password"]').first().fill(acc.password);
  await page.getByRole('button', { name: /^Giriş Yap$/ }).click();
  await page.waitForURL(/#\/(dashboard|app\/dashboard|field)/, { timeout: 60000 });
  await page.goto(`${BASE}/#/installations?tab=cari`);
  await page.getByText(/yükleniyor/i).first().waitFor({ state: 'detached', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const txt = await page.locator('body').innerText();
  console.log('icerik:', txt.replace(/\s+/g, ' ').slice(0, 160));
  console.log(`--- ${name}: ${page.url().split('#')[1]}`);
  // ilk montajci detayini ac
  const open = page.getByRole('button', { name: /Detay|Hareket|Ekstre|Geçmiş|Aç/i }).first();
  if (await open.isVisible().catch(() => false)) { await open.click().catch(() => {}); await page.waitForTimeout(800); }
  else await page.getByText('Mehmet Ali').first().click().catch(() => {});
  await page.waitForTimeout(800);
  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const pageOverflow = de.scrollWidth > window.innerWidth + 1;
    // metin kutularinin ust uste binmesi: sayi iceren yaprak elemanlar
    const leaves = [...document.querySelectorAll('main *')].filter((e) => e.children.length === 0 && /(₺\s?\d|\d\s?TL)/.test(e.textContent || '') && e.offsetParent);
    let overlaps = 0;
    for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
      const a = leaves[i].getBoundingClientRect(), b = leaves[j].getBoundingClientRect();
      if (a.width && b.width && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlaps++;
    }
    return { pageOverflow, overlaps, leaves: leaves.length, sw: de.scrollWidth, iw: window.innerWidth };
  });
  rec(`[${name}] sayfa yatay tasmiyor`, !m.pageOverflow, `${m.sw}/${m.iw}`);
  rec(`[${name}] tutarlar gorunuyor (veri yuklendi)`, m.leaves > 3, String(m.leaves));
  rec(`[${name}] tutarlar ust uste binmiyor`, m.overlaps === 0, `${m.overlaps} cakisma / ${m.leaves} tutar`);
  await page.screenshot({ path: `test-results/installer/${name}.png`, fullPage: false });
  await ctx.close();
}
await browser.close();
console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nTUM KONTROLLER GECTI');
process.exit(fail ? 1 : 0);
