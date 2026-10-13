// Kurulu Windows (Electron) uygulamasini gercek exe ile calistirip uretim Supabase'e karsi dogrular.
//
//   node scripts/qa-windows-app.mjs "<PerdePRO.exe yolu>"
//
// Gereken (.env.e2e, Git disi): E2E_B_EMAIL/E2E_B_PASSWORD (Test Company 2 — staff modulu kapali).
// Her calistirma TEMIZ bir userData dizini kullanir (ilk acilis gibi). Cihaz id'si QA hesabinin sabit id'sidir;
// firmanin cihaz limiti tuketilmez. Veri yazmaz (yalniz giris + okuma + sayfa gezintisi).
// Yeni kayit (signup) BILEREK gonderilmez: gercek e-posta dogrulamasi gerektirir.
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadQaAccounts } from './lib/qaAccounts.mjs';

const exe = process.argv[2];
if (!exe || !fs.existsSync(exe)) { console.error('PerdePRO.exe yolu verilmedi/yok'); process.exit(2); }
const { accounts } = loadQaAccounts({ requireBoth: false });
const acc = accounts.B;
if (!acc) { console.error('E2E_B hesabi tanimli degil'); process.exit(2); }

let fail = 0;
const rec = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'perdepro-qa-'));

const app = await electron.launch({ executablePath: exe, args: [`--user-data-dir=${userData}`] });
try {
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate((id) => localStorage.setItem('curtain_saas_device_id', id), acc.deviceId);
  await page.reload();
  await page.waitForTimeout(2500);

  rec('Uygulama file:// altinda acildi', page.url().startsWith('file:'), page.url().split('#')[0].slice(-30));
  rec('Giris ekrani gorunuyor', await page.locator('input[type="password"]').first().isVisible().catch(() => false));

  // Kayit ekrani metinleri (gonderilmez)
  await page.evaluate(() => { window.location.hash = '#/signup'; });
  await page.waitForTimeout(1500);
  const signupText = await page.locator('body').innerText();
  rec('Kayit ekrani: 7 gun ucretsiz', /7 gün ücretsiz/i.test(signupText));
  rec('Kayit ekrani: 14/30 gun ifadesi yok', !/\b(14|30) g[üu]n/i.test(signupText));
  rec('Kayit ekrani: davet kodu istemiyor', !/davet kodu\s*\*/i.test(signupText));

  // Giris
  await page.evaluate(() => { window.location.hash = '#/login'; });
  await page.waitForTimeout(1000);
  await page.locator('input[type="email"]').first().fill(acc.email);
  await page.locator('input[type="password"]').first().fill(acc.password);
  await page.getByRole('button', { name: /^Giriş Yap$/ }).click();
  await page.waitForURL(/#\/(dashboard|app\/dashboard|field|locked)/, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(3000);
  rec('E-posta/parola ile giris yapildi', /#\/(dashboard|app\/dashboard|field)/.test(page.url()), page.url().split('#')[1]);

  const nav = (await page.locator('aside a, aside button').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
  console.log('Menu:', JSON.stringify(nav));
  const body = await page.locator('body').innerText();
  for (const bad of ['Süper Admin', 'Süper Admin\'e Dön', 'Firma Olarak Giriş', 'İşlem Moduna Al', 'Müşteri Firmalar', 'Demo Yönetici', 'Deployment Wizard']) {
    rec(`Normal kullanicida "${bad}" yok`, !body.includes(bad) && !nav.some((n) => n.includes(bad)));
  }
  rec('Sorun Bildir menude', nav.some((n) => /Sorun Bildir/.test(n)));
  rec('Ayarlar menude', nav.some((n) => /^Ayarlar$/.test(n)));
  rec('Solo disi menu yok: Finans/Faturalar/Kartela/Personel/Raporlar',
    !nav.some((n) => /^(Finans|Faturalar|Kartela Yönetimi|Personel|Raporlar|Şube)/.test(n)));

  // Dogrudan rota: pakette olmayan modul
  for (const route of ['accounting', 'invoices', 'catalogs', 'staff', 'branches']) {
    await page.evaluate((r) => { window.location.hash = `#/${r}`; }, route);
    await page.waitForTimeout(1500);
    const t = await page.locator('main').innerText().catch(() => '');
    rec(`Dogrudan #/${route}: modul ekrani acilmiyor`, /Paketinizde Yok|bu modül paketinize dahil değil/i.test(t) || !page.url().includes(`#/${route}`), page.url().split('#')[1]);
  }

  // Abonelik ekrani (Windows'ta satin alma sunulabilir)
  await page.evaluate(() => { window.location.hash = '#/subscription'; });
  await page.waitForTimeout(3000);
  const sub = await page.locator('main').innerText().catch(() => '');
  rec('Abonelik ekrani acildi', /Abonelik/.test(sub), sub.slice(0, 60).replace(/\s+/g, ' '));
  rec('Abonelik ekrani: otomatik yenileme yok bilgisi', /Otomatik yenileme yok|henüz etkin değil/i.test(sub));

  rec('Sayfa hatasi (pageerror) yok', errors.length === 0, errors.join(' | '));
} finally {
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
}
console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nTUM KONTROLLER GECTI');
process.exit(fail ? 1 : 0);
