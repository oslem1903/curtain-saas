// Destek talebi + ekran goruntusu eki — ARAYUZ dogrulamasi (QA hesabi, aktif veya suresi bitmis firma).
//
//   node scripts/qa-support-ui.mjs [temelUrl] [--user A|B]
//
// Akis: "Sorun Bildir" -> baslik/aciklama + PNG eki -> gonder -> talep satirinda screenshot_url DOLU olmali
// -> Ayarlar > "Destek Taleplerim" listesinde "Ekran goruntusunu ac" baglantisi imzali adrese cevrilmeli ve
// gercekten bir gorsel indirmeli. Talep satirlarini kullanici silemez: "SUPPORT_TICKET_ID=" ciktisi SQL ile temizlenir.
import { chromium } from '@playwright/test';
import { loadQaAccounts } from './lib/qaAccounts.mjs';

const args = process.argv.slice(2);
const BASE = (args.find((a) => /^https?:/.test(a)) || 'http://localhost:5173').replace(/\/$/, '');
const userKey = String(args[args.indexOf('--user') + 1] || 'B').toUpperCase();
const { accounts } = loadQaAccounts();
const acc = accounts[userKey];

let fail = 0;
const rec = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };
const seen = (loc, ms = 20000) => loc.first().waitFor({ state: 'visible', timeout: ms }).then(() => true).catch(() => false);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
await ctx.addInitScript((id) => { localStorage.setItem('curtain_saas_device_id', id); }, acc.deviceId);
const page = await ctx.newPage();
try {
  console.log(`Temel URL: ${BASE} (kullanici ${userKey}, cihaz ${acc.deviceId})`);
  await page.goto(`${BASE}/#/login`);
  await page.locator('input[type="email"]').first().fill(acc.email);
  await page.locator('input[type="password"]').first().fill(acc.password);
  await page.getByRole('button', { name: /^Giriş Yap$/ }).click();
  await page.waitForURL(/#\/(dashboard|app\/dashboard|field|locked)/, { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(3500);
  rec('giris yapildi (kilitli degil)', !/#\/locked|#\/login/.test(page.url()), page.url().split('#')[1]);

  // Aboneligin durumu (bilgi amacli)
  const allowed = await page.evaluate(async () => {
    const sb = window.supabase;
    const { data: { user } } = await sb.auth.getUser();
    const { data: cm } = await sb.from('company_members').select('company_id').eq('user_id', user.id).eq('is_active', true);
    const r = await sb.rpc('company_subscription_access_allowed', { p_company_id: cm?.[0]?.company_id });
    return r.data;
  });
  console.log(`Firma aboneligi aktif: ${allowed}`);

  const supportBtn = page.getByRole('button', { name: /Sorun Bildir/ }).first();
  rec('"Sorun Bildir" gorunur', await seen(supportBtn));
  await supportBtn.click({ force: true });
  const title = 'QA Ek UI ' + Date.now().toString(36);
  await page.getByPlaceholder('Kısaca sorunu özetleyin...').fill(title);
  await page.getByPlaceholder('Neler olduğunu detaylıca anlatın...').fill('Otomatik QA: ek baglama arayuz testi.');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'qa-ek.png', mimeType: 'image/png', buffer: png });
  await page.getByRole('button', { name: /Talebi Gönder/ }).click();
  rec('talep gonderildi', await seen(page.getByText(/Talep Gönderildi/), 25000));
  rec('ek yukleme/baglama uyarisi YOK', !/ekran görüntüsü yüklenemedi/i.test(await page.locator('body').innerText()));

  const row = await page.evaluate(async (t) => {
    const { data } = await window.supabase.from('support_tickets').select('id,company_id,screenshot_url').eq('title', t).limit(1);
    return data?.[0] || null;
  }, title);
  rec('talep olustu', !!row?.id);
  console.log('SUPPORT_TICKET_ID=' + (row?.id || ''));
  rec('screenshot_url talebe BAGLANDI', !!row?.screenshot_url && row.screenshot_url === `${row.company_id}/${row.id}/screenshot.png`, row?.screenshot_url ? 'dolu' : 'bos');

  // Destek ekranindan (Ayarlar > Destek Taleplerim) acma
  await page.goto(`${BASE}/#/settings`); await page.waitForTimeout(2500);
  const link = page.locator('[data-testid="ticket-attachment-link"]').first();
  rec('"Ekran goruntusunu ac" baglantisi listede gorunur', await seen(link, 20000));
  let href = null;
  for (let i = 0; i < 20 && !href; i++) { href = await link.getAttribute('href').catch(() => null); if (!href) await page.waitForTimeout(500); }
  rec('baglanti imzali adrese cevrildi', !!href && /\/storage\/v1\/object\/sign\/support-attachments\//.test(href));
  if (href) {
    const r = await fetch(href);
    rec('ek gercekten aciliyor (HTTP 200, gorsel)', r.status === 200 && /image\//.test(r.headers.get('content-type') || ''), `HTTP ${r.status} ${r.headers.get('content-type')}`);
  }
} catch (e) {
  console.log('HATA', String(e).slice(0, 240));
  fail++;
} finally {
  await browser.close();
}
console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nGECTI');
process.exit(fail ? 1 : 0);
