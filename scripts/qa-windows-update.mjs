// Windows guncelleme testi (oturum korunuyor mu) + Abonelik ekrani yerlesimi (kart/dugme hizasi, onay, fiyat).
//   node scripts/qa-windows-update.mjs login   <PerdePRO.exe> <userDataDir>   # QA hesabiyla giris yapip kapat
//   node scripts/qa-windows-update.mjs session <PerdePRO.exe> <userDataDir>   # giris EKRANI GELMEDEN dashboard acilmali
//   node scripts/qa-windows-update.mjs layout  <PerdePRO.exe> <userDataDir>   # Abonelik ekrani olcumleri + ekran goruntusu
// Kart girilmez, odeme baslatilmaz.
import { _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import { loadQaAccounts } from './lib/qaAccounts.mjs';

const [mode, exe, dir] = process.argv.slice(2);
if (!mode || !exe || !dir) { console.error('kullanim: login|session|layout <exe> <userDataDir>'); process.exit(2); }
const { accounts } = loadQaAccounts({ requireBoth: false });
const acc = accounts.A;
let fail = 0;
const rec = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };

const app = await electron.launch({ executablePath: exe, args: [`--user-data-dir=${dir}`] });
try {
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(3500);

  if (mode === 'login') {
    await page.evaluate((id) => localStorage.setItem('curtain_saas_device_id', id), acc.deviceId);
    await page.reload();
    await page.waitForTimeout(2000);
    await page.locator('input[type="email"]').first().fill(acc.email);
    await page.locator('input[type="password"]').first().fill(acc.password);
    await page.getByRole('button', { name: /^Giriş Yap$/ }).click();
    await page.waitForURL(/#\/(dashboard|app\/dashboard|field)/, { timeout: 60000 });
    rec('giris yapildi, oturum kullanici veri dizinine yazildi', true, page.url().split('#')[1]);
  } else {
    const onLogin = /#\/login/.test(page.url()) || await page.locator('input[type="password"]').first().isVisible().catch(() => false);
    rec('oturum KORUNDU (giris ekrani gelmedi)', !onLogin, page.url().split('#')[1]);
    rec('dashboard/uygulama icerigi yuklendi', /#\/(dashboard|app\/dashboard|field)/.test(page.url()));
    const ver = await app.evaluate(({ app: a }) => a.getVersion());
    console.log('uygulama surumu:', ver);
    if (mode === 'layout') {
      await page.evaluate(() => { window.location.hash = '#/subscription'; });
      await page.waitForTimeout(4000);
      const cards = page.locator('section[aria-labelledby="launch-prices"] .rounded-3xl');
      rec('iki paket karti', (await cards.count()) === 2);
      const b0 = await cards.nth(0).boundingBox(), b1 = await cards.nth(1).boundingBox();
      rec('kartlar AYNI yukseklikte, yan yana', Math.abs(b0.y - b1.y) < 1 && Math.abs(b0.height - b1.height) < 1, `${b0.height.toFixed(0)} / ${b1.height.toFixed(0)}`);
      const btns = page.getByRole('button', { name: /(Test ödemesine|Ödemeye) geç/ });
      const d0 = await btns.nth(0).boundingBox(), d1 = await btns.nth(1).boundingBox();
      rec('odeme dugmeleri AYNI hizada', Math.abs(d0.y - d1.y) < 1 && Math.abs(d0.height - d1.height) < 1, `${d0.y.toFixed(0)} / ${d1.y.toFixed(0)}`);
      const txt = await page.locator('main').innerText();
      rec('fiyatlar "499 TL" ve "4.990 TL"', /\b499 TL\b/.test(txt) && /\b4\.990 TL\b/.test(txt));
      rec('"2 ay avantajli" etiketi', /Aylık ödemeye göre 2 ay avantajlı/.test(txt));
      rec('onay isaretsizken dugmeler pasif + aciklama', (await btns.nth(0).isDisabled()) && /işaretleyene kadar pasif/.test(txt) && /Önce yukarıdaki onay kutusunu işaretleyin/.test(txt));
      fs.mkdirSync('test-results/windows', { recursive: true });
      await page.screenshot({ path: 'test-results/windows/abonelik-onaysiz.png', fullPage: true });
      await page.getByRole('checkbox').first().check();
      rec('onay sonrasi dugmeler etkin', (await btns.nth(0).isEnabled()) && (await btns.nth(1).isEnabled()));
      await page.screenshot({ path: 'test-results/windows/abonelik-onayli.png', fullPage: true });
      rec('odeme dugmesine TIKLANMADI', true);
    }
  }
} finally {
  await app.close().catch(() => {});
}
console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nTUM KONTROLLER GECTI');
process.exit(fail ? 1 : 0);
