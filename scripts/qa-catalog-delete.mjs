// Kartela (katalog) silme akisi — GERCEK sayfa kodu, SAHTE REST verisi (QA firmasinda "catalogs" modulu kapali;
// uretim verisi/yapilandirmasina dokunulmaz). Senaryolar: basarili, 0 satir (RLS), cascade kismi basari.
//   node scripts/qa-catalog-delete.mjs [temelUrl]
import { chromium } from '@playwright/test';
import { loadQaAccounts } from './lib/qaAccounts.mjs';

const BASE = (process.argv[2] || 'http://localhost:5199').replace(/\/$/, '');
const acc = loadQaAccounts({ requireBoth: false }).accounts.A;
let fail = 0;
const rec = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };

const patchModules = (x) => {
  if (Array.isArray(x)) return x.map(patchModules);
  if (x && typeof x === 'object') {
    const o = {};
    for (const [k, v] of Object.entries(x)) o[k] = k === 'enabled_modules' && Array.isArray(v) ? [...new Set([...v, 'catalogs'])] : patchModules(v);
    return o;
  }
  return x;
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript((id) => localStorage.setItem('curtain_saas_device_id', id), acc.deviceId);
const page = await ctx.newPage();
const dialogs = [];
page.on('dialog', async (d) => { dialogs.push(d.message()); await d.accept().catch(() => {}); });

// "catalogs" modulunu YALNIZ istemci yanitinda ekle (sunucu verisi degismez)
await page.route(/\/rest\/v1\/(companies|company_members)|\/rpc\/get_current_auth_context/, async (route) => {
  const resp = await route.fetch();
  let body = await resp.text();
  try { body = JSON.stringify(patchModules(JSON.parse(body))); } catch { /* */ }
  await route.fulfill({ response: resp, body });
});

let state, mode;
const reset = (m) => {
  mode = m;
  state = {
    series: [{ id: 's-1', company_id: 'c', product_type: 'tul', code: 'QA-K1', series_code: 'QA-K1', model_name: 'QA Model', is_active: true }],
    variants: [1, 2, 3].map((i) => ({ id: `v-${i}`, company_id: 'c', series_id: 's-1', variant_code: `QA-V${i}`, variant_image_url: null, price_per_m2: 100, is_active: true })),
  };
};
const json = (r, body, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
await page.route('**/rest/v1/catalog_series*', (r) => {
  const m = r.request().method();
  if (m === 'DELETE') {
    if (mode === 'rls') return json(r, []);                       // RLS filtresi: 200 + []
    const removed = state.series; state.series = [];
    if (mode === 'ok') state.variants = [];                        // cascade tam
    return json(r, removed.map((s) => ({ id: s.id })));           // 'partial': seri gitti, varyantlar KALDI
  }
  if (m === 'GET') return json(r, state.series);
  return r.continue();
});
await page.route('**/rest/v1/catalog_variants*', (r) => {
  const m = r.request().method();
  if (m === 'DELETE') return json(r, []);
  if (m === 'HEAD') return r.fulfill({ status: 200, headers: { 'content-range': `*/${state.variants.length}`, 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' }, body: '' });
  if (m === 'GET') {
    // head+count istekleri (kalan varyant sayisi)
    const head = r.request().headers()['prefer']?.includes('count=exact') || r.request().method() === 'HEAD';
    if (head) return r.fulfill({ status: 200, headers: { 'content-range': `*/${state.variants.length}`, 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' }, body: '[]' });
    return json(r, state.variants);
  }
  return r.continue();
});

await page.goto(`${BASE}/#/login`);
await page.locator('input[type="email"]').first().fill(acc.email);
await page.locator('input[type="password"]').first().fill(acc.password);
await page.getByRole('button', { name: /^Giriş Yap$/ }).click();
await page.waitForURL(/#\/(dashboard|app\/dashboard|field)/, { timeout: 60000 });

const open = async (m) => {
  reset(m);
  dialogs.length = 0;
  await page.goto(`${BASE}/#/catalogs`);
  await page.waitForTimeout(500);
  await page.reload();
  await seriesDelete().waitFor({ timeout: 30000 });
};
const clickDelete = async () => {
  await page.getByRole('button', { name: /^\s*Sil\s*$/ }).first().evaluate((b) => b.click()).catch(() => {});
};
const seriesDelete = () => page.locator('button', { hasText: 'Sil' }).filter({ has: page.locator('svg') }).first();

// ---- 1) basarili (cascade tam)
await open('ok');
rec('kartela sayfasi acildi (QA-K1 + 3 varyant)', (await page.getByText('QA-V3').count()) > 0);
await seriesDelete().click();
await page.waitForTimeout(2000);
let body = await page.locator('body').innerText();
rec('basarili: seri listeden kalkti, hata yok', !/QA-K1/.test(body) && !/silinemedi|silinemedi/i.test(body) && !dialogs.some((m) => /silinemedi/.test(m)));

// ---- 2) 0 satir (RLS)
await open('rls');
await seriesDelete().click();
await page.waitForTimeout(2000);
body = await page.locator('body').innerText();
rec('0 satir: hata bildirimi gorunur', /silinemedi: işlem veritabanında uygulanmadı/.test(body), body.match(/Kod\/model[^\n]{0,60}/)?.[0] ?? '');
rec('0 satir: kayit listeden KAYBOLMADI', /QA-K1/.test(body) && /QA-V1/.test(body));

// ---- 3) cascade kismi: seri silindi ama varyantlar kaldi -> tam basari sayilmaz
await open('partial');
await seriesDelete().click();
await page.waitForTimeout(2500);
body = await page.locator('body').innerText();
console.log('KISMI:', body.split(String.fromCharCode(10)).filter((l) => /varyant|silin/i.test(l)).join(' || ').slice(0, 600), '| DIALOGS:', dialogs.join(' / '));
rec('kismi: "alt varyant silinemedi" uyarisi gorunur', /alt varyant silinemedi/.test(body), body.match(/Kod\/model silindi[^\n]{0,90}/)?.[0] ?? '');

await browser.close();
console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nTUM KONTROLLER GECTI');
process.exit(fail ? 1 : 0);
