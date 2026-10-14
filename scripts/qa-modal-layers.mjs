// Pencere (modal) katmani: yan menu pencerenin ustunde kalmamali; mobil menu pencere acilinca kapanmali;
// arka plan etkilesimi kapali; form ve alt dugmeler kaydirilarak erisilebilir. Veri KAYDETMEZ.
//   node scripts/qa-modal-layers.mjs [temelUrl]
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import { loadQaAccounts } from './lib/qaAccounts.mjs';

const BASE = (process.argv[2] || 'http://localhost:5199').replace(/\/$/, '');
const { accounts } = loadQaAccounts({ requireBoth: false });
const acc = accounts.A;
fs.mkdirSync('test-results/modal', { recursive: true });
let fail = 0;
const rec = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };

const VIEWPORTS = [
  { name: 'bluestacks-yatay-1280x720', w: 1280, h: 720 },
  { name: 'telefon-yatay-844x390', w: 844, h: 390 },
  { name: 'dar-telefon-360x640', w: 360, h: 640 },
];

const browser = await chromium.launch();
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h } });
  await ctx.addInitScript((id) => localStorage.setItem('curtain_saas_device_id', id), acc.deviceId);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/#/login`);
  await page.locator('input[type="email"]').first().fill(acc.email);
  await page.locator('input[type="password"]').first().fill(acc.password);
  await page.getByRole('button', { name: /^Giriş Yap$/ }).click();
  await page.waitForURL(/#\/(dashboard|app\/dashboard|field)/, { timeout: 60000 });
  await page.goto(`${BASE}/#/suppliers`);
  await page.waitForTimeout(3500);

  // dar ekranda menuyu once ACIK birak: modal acilinca kapanmali
  if (vp.w < 1024) {
    const burger = page.locator('header button').first();
    await burger.click().catch(() => {});
    await page.waitForTimeout(500);
  }
  // Menu acikken pencere acilmasi (ornegin arka plandaki bir islem): DOM uzerinden tetiklenir
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('button')).find((x) => /Tedarikçi Ekle/.test(x.textContent || ''));
    b?.click();
  });
  await page.waitForTimeout(900);

  const panel = page.locator('div.fixed.inset-0 >> div').filter({ hasText: 'Yeni Tedarikçi Ekle' }).first();
  rec(`[${vp.name}] "Yeni Tedarikçi Ekle" penceresi acildi`, await panel.isVisible());
  const box = await panel.boundingBox();
  if (box) {
    rec(`[${vp.name}] pencere ekran icinde (sol/ust kesilmiyor)`, box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.w + 1, `x=${box.x.toFixed(0)} y=${box.y.toFixed(0)} w=${box.width.toFixed(0)} h=${box.height.toFixed(0)}`);
    // pencerenin sol ust ve sol orta noktasinda ust katman pencerenin kendisi mi (yan menu degil)?
    const probe = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return { inAside: Boolean(el?.closest('aside')), inHeader: Boolean(el?.closest('header')), inNav: Boolean(el?.closest('nav.fixed')) };
    }, { x: Math.max(box.x + 8, 8), y: Math.max(box.y + 40, 40) });
    rec(`[${vp.name}] yan menu/ust cubuk/alt gezinme pencerenin ustunde DEGIL`, !probe.inAside && !probe.inHeader && !probe.inNav, JSON.stringify(probe));
  }
  const state = await page.evaluate(() => ({
    asideInert: document.querySelector('aside')?.hasAttribute('inert') ?? false,
    bodyLocked: document.body.style.overflow === 'hidden',
    drawerClosed: (() => { const a = document.querySelector('aside'); if (!a) return true; const r = a.getBoundingClientRect(); return window.innerWidth >= 1024 || r.right <= 1; })(),
  }));
  rec(`[${vp.name}] yan menu etkilesime kapali (inert)`, state.asideInert);
  rec(`[${vp.name}] arka plan kaydirmasi kilitli`, state.bodyLocked);
  if (vp.w < 1024) rec(`[${vp.name}] mobil menu pencere acilinca KAPANDI`, state.drawerClosed);

  // form + alt dugme erisilebilir: pencere ici kaydirilarak "Tedarikçi Ekle" dugmesi gorunur olmali
  const submit = page.getByRole('button', { name: /^Tedarikçi Ekle$/ }).last();
  await submit.scrollIntoViewIfNeeded().catch(() => {});
  const sb = await submit.boundingBox();
  rec(`[${vp.name}] alt dugme (Tedarikçi Ekle) kaydirinca ekranda`, !!sb && sb.y >= 0 && sb.y + sb.height <= vp.h + 1, sb ? `y=${sb.y.toFixed(0)}..${(sb.y + sb.height).toFixed(0)} / ${vp.h}` : 'yok');
  await page.screenshot({ path: `test-results/modal/${vp.name}.png` });

  // kapat: iptal/kapat ile geri donus
  await page.keyboard.press('Escape');
  const closeBtn = page.getByRole('button', { name: /İptal|Kapat|Vazgeç/ }).first();
  if (await closeBtn.isVisible().catch(() => false)) await closeBtn.click().catch(() => {});
  await page.waitForTimeout(800);
  const after = await page.evaluate(() => ({ asideInert: document.querySelector('aside')?.hasAttribute('inert') ?? false, bodyLocked: document.body.style.overflow === 'hidden' }));
  rec(`[${vp.name}] pencere kapaninca menu/kaydirma eski haline dondu`, !after.asideInert && !after.bodyLocked);
  await ctx.close();
}
await browser.close();
console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nTUM KONTROLLER GECTI');
process.exit(fail ? 1 : 0);
