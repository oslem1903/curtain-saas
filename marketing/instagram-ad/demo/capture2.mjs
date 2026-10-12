// Gerçek PerdePRO arayüzünden (yerel Vite + sahte Supabase yanıtları) etkileşimli ekran kaydı.
// Çıktı: frames/<sahne>/fNNNN.jpg + times.json (sn) + marks.json (kamera kadrajları, CSS px)
import { chromium } from '../../../node_modules/playwright/index.mjs';
import fs from 'node:fs';
import { setup, BASE } from './harness.mjs';
import { db, rpc } from './data.mjs';

const only = process.argv.slice(2);
const b = await chromium.launch({ args: ['--force-device-scale-factor=3'] });
const ctx = await b.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'tr-TR', timezoneId: 'Europe/Istanbul' });
const page = await ctx.newPage();
const log = []; await setup(page, db, rpc, log);
const d0 = new Date(); d0.setHours(9, 30, 0, 0); await page.clock.setFixedTime(d0);
page.on('pageerror', e => log.push('PAGEERROR ' + e.message.slice(0, 160)));
page.on('dialog', async dlg => { log.push('DIALOG ' + dlg.message().slice(0, 160)); await dlg.dismiss(); });
const cdp = await ctx.newCDPSession(page);
const wait = ms => page.waitForTimeout(ms);
const FULL = [0, 0, 430, 932];

// ---- yardımcılar ----
const scrollEl = () => page.evaluate(() => {
  const c = [document.scrollingElement, ...document.querySelectorAll('*')].filter(e => e && e.scrollHeight > e.clientHeight + 50 && (e === document.scrollingElement || /(auto|scroll)/.test(getComputedStyle(e).overflowY))).sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
  window.__sc = c; return c.scrollTop;
});
const scrollTo = async (y, ms = 900) => { await scrollEl(); await page.evaluate(([y, ms]) => new Promise(res => {
  const el = window.__sc, y0 = el.scrollTop, t0 = performance.now();
  const ease = x => x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
  (function step(now) { const k = Math.min(1, (now - t0) / ms); el.scrollTop = y0 + (y - y0) * ease(k); k < 1 ? requestAnimationFrame(step) : res(); })(t0);
}), [y, ms]); };
const scrollBy = async (dy, ms) => scrollTo((await scrollEl()) + dy, ms);
const scrollToEl = async (loc, offset = 120, ms = 900) => {
  const dy = await loc.evaluate((e, off) => e.getBoundingClientRect().top - off, offset);
  await scrollBy(dy, ms);
};
async function tap(loc) { // dokunma halkası + gerçek tıklama
  const bb = await loc.boundingBox(); const x = bb.x + bb.width / 2, y = bb.y + bb.height / 2;
  await page.evaluate(([x, y]) => {
    const r = document.createElement('div');
    r.style.cssText = `position:fixed;left:${x - 22}px;top:${y - 22}px;width:44px;height:44px;border-radius:50%;border:4px solid #0ea5e9;background:rgba(14,165,233,.25);z-index:99999;pointer-events:none;transition:transform .45s ease-out,opacity .45s ease-out`;
    document.body.appendChild(r); requestAnimationFrame(() => { r.style.transform = 'scale(1.6)'; r.style.opacity = '0'; }); setTimeout(() => r.remove(), 600);
  }, [x, y]);
  await wait(160); await loc.click();
}
const unionBox = async (locs, pad = 14) => {
  const bs = []; for (const l of locs) { const bb = await l.boundingBox(); if (bb) bs.push(bb); }
  const x0 = Math.min(...bs.map(b => b.x)), y0 = Math.min(...bs.map(b => b.y));
  const x1 = Math.max(...bs.map(b => b.x + b.width)), y1 = Math.max(...bs.map(b => b.y + b.height));
  return [Math.max(0, x0 - pad), Math.max(0, y0 - pad), Math.min(430, x1 + pad) - Math.max(0, x0 - pad), y1 - y0 + 2 * pad];
};

async function scene(name, prep, act) {
  if (only.length && !only.includes(name)) return;
  await prep(); await wait(1200);
  const dir = `frames/${name}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  const abs = []; let n = 0; const marks = [];
  const onFrame = async f => {
    fs.writeFileSync(`${dir}/f${String(++n).padStart(4, '0')}.jpg`, Buffer.from(f.data, 'base64'));
    abs.push(f.metadata.timestamp);
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  };
  cdp.on('Page.screencastFrame', onFrame);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: 1290, maxHeight: 2796, everyNthFrame: 1 });
  await wait(150);
  const mark = (rect, label = '') => { marks.push({ ts: Date.now() / 1000, rect, label }); };
  await act(mark);
  await wait(500);
  await cdp.send('Page.stopScreencast'); cdp.off('Page.screencastFrame', onFrame);
  const t0 = abs[0];
  fs.writeFileSync(`${dir}/times.json`, JSON.stringify(abs.map(t => +(t - t0).toFixed(3))));
  fs.writeFileSync(`${dir}/marks.json`, JSON.stringify(marks.map(m => ({ t: +(m.ts - t0).toFixed(3), rect: m.rect, label: m.label }))));
  console.log(name, n, 'kare', +(abs.at(-1) - t0).toFixed(2), 'sn,', marks.length, 'kadraj');
}

const nums = () => page.locator('input[type=number]');

// ---- 1) ÖLÇÜ ----
await scene('olcu',
  async () => { await page.goto(BASE + '/#/measurements/new'); await wait(2500); },
  async mark => {
    mark(FULL, 'tam');
    await wait(500);
    await page.locator('select').first().selectOption({ index: 1 }); await wait(700);
    await scrollToEl(page.getByPlaceholder('Salon, Yatak Odası...'), 150, 900); await wait(250);
    const room = page.getByPlaceholder('Salon, Yatak Odası...');
    const en = page.getByPlaceholder('örn: 110.5');
    mark(await unionBox([room, en, nums().nth(0)]), 'en-boy');
    await wait(550);
    await tap(room); await page.keyboard.type('Salon', { delay: 80 }); await wait(200);
    await en.click({ clickCount: 3 }); await page.keyboard.type('240', { delay: 110 }); await wait(250);
    await nums().nth(0).click({ clickCount: 3 }); await page.keyboard.type('180', { delay: 110 }); await wait(350);
    await scrollBy(120, 500); await wait(150);
    const price = nums().nth(2);
    mark(await unionBox([nums().nth(1), price, page.getByText(/ürün •/).first()], 10), 'fiyat-toplam');
    await wait(500);
    await price.click(); await page.keyboard.type('520', { delay: 120 }); await wait(1300);
  });

// ---- 2) TEKLİF -> SİPARİŞ (aynı kayıt, iki başlık) ----
await scene('teklif',
  async () => { await page.goto(BASE + '/#/quotes'); await wait(2500); },
  async mark => {
    mark(FULL, 'tam'); await wait(600);
    const card = page.locator('div.rounded-2xl', { hasText: 'Örnek Müşteri A' }).filter({ has: page.getByRole('button', { name: /Siparişe Çevir/ }) }).first();
    await scrollToEl(card.getByText('Grup Toplamı'), 130, 1000); await wait(250);
    const btn = card.getByRole('button', { name: /Siparişe Çevir/ });
    mark(await unionBox([card.getByText('Grup Toplamı'), card.getByText('Salon').nth(1)], 14), 'toplam');
    await wait(900);
    await card.locator('input[type=date]').fill('2026-10-25'); await wait(500);
    mark(await unionBox([card.getByText('Tahmini Teslim Tarihi'), btn], 12), 'cevir');
    await wait(500);
    await tap(btn); await wait(1800);
    // --- sipariş listesi ---
    const chip1 = page.locator('span', { hasText: /^Yeni Sipariş$/ }).first();
    await chip1.waitFor({ timeout: 8000 });
    let bb = await chip1.boundingBox();
    await scrollBy(bb.y - 330, 800); await wait(250);
    bb = await chip1.boundingBox();
    mark([14, Math.max(0, bb.y - 62), 402, 170], 'siparis-yeni'); await wait(1100);
    await scrollBy(125, 600); await wait(200);
    bb = await page.locator('span', { hasText: /^Onaylandı$/ }).first().boundingBox();
    mark([14, Math.max(0, bb.y - 62), 402, 170], 'siparis-2'); await wait(1000);
    await scrollBy(115, 600); await wait(200);
    bb = await page.locator('span', { hasText: /^İmalatta$/ }).first().boundingBox();
    mark([14, Math.max(0, bb.y - 62), 402, 170], 'siparis-3'); await wait(1000);
  });

// ---- 3) RANDEVU ----
await scene('randevu',
  async () => { await page.goto(BASE + '/#/appointments/new'); await wait(2500); },
  async mark => {
    mark(FULL, 'tam'); await wait(500);
    await tap(page.getByRole('button', { name: /Yeni Randevu Oluştur/ })); await wait(900);
    await tap(page.getByRole('button', { name: /Örnek Müşteri B/ }).first()); await wait(500);
    const date = page.locator('input[type=date]').first(), time = page.locator('input[type=time]').first();
    await date.scrollIntoViewIfNeeded();
    const t = new Date();
    const iso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    mark(await unionBox([page.locator('select').first(), date, time], 14), 'tarih-saat'); await wait(500);
    await date.fill(iso); await wait(350); await time.fill('15:30'); await wait(900);
    await tap(page.getByRole('button', { name: /^Oluştur$/ })); await wait(1400);
    const stamp = `${String(t.getDate()).padStart(2, '0')}.${String(t.getMonth() + 1).padStart(2, '0')}.${t.getFullYear()} 15:30`;
    const when = page.getByText(stamp).first();
    await wait(600);
    mark(await unionBox([page.getByText('Randevu başarıyla oluşturuldu!')], 14), 'basari'); await wait(700);
    await scrollToEl(when, 330, 800); await wait(200);
    const wb = await when.boundingBox();
    mark([14, Math.max(0, wb.y - 62), 402, 170], 'yeni-randevu'); await wait(1300);
  });

// ---- 4) TAHSİLAT ----
await scene('tahsilat',
  async () => { await page.goto(BASE + '/#/collections'); await wait(2500); },
  async mark => {
    mark(FULL, 'tam'); await wait(500);
    const total = page.getByText(/toplam açık alacak/i).first();
    const ub = await unionBox([page.getByText('₺1.850,00').first(), total], 12); ub[3] += 70;
    mark(ub, 'acik-alacak');
    await wait(1100);
    await scrollBy(210, 600); await wait(200);
    const chips = page.getByRole('button', { name: /Geciken/ }).first();
    mark(await unionBox([chips, page.getByRole('button', { name: /Tüm Açık Alacaklar/ }).first()], 18), 'filtre');
    await wait(500);
    await tap(chips); await wait(900);
    const row = page.getByText('Örnek Müşteri C').first();
    const rb = await row.boundingBox();
    mark([14, Math.max(0, rb.y - 40), 402, 190], 'geciken-satir'); await wait(1200);
  });

console.log(log.filter(l => !/dicebear|app_devices/.test(l)).join('\n'));
await b.close();
