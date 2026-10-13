// Suresi BITMIS denemede ARAYUZ davranisi (QA firmasi; yalnizca okuma/disa aktarma + engel denemeleri).
//
//   (QA firmasinin trial_ends_at'i gecmise alinmis olmali; once `verify-subscription-gate.mjs --expect active`
//    ile probe musteri/tedarikci/Storage nesnesi olusturulmus olmali.)
//   node scripts/qa-expired-view-flow.mjs [temelUrl] [--user B]
//
// Yerel gelistirme sunucusuna (varsayilan http://localhost:5173) karsi calistirilirsa bu bir YEREL testtir;
// yayindaki alias'a karsi calistirilirsa canli testtir (rapora hangisi oldugu yazilmalidir).
// Gosterilen/kontrol edilenler: salt-okunur bilgi, musteri/tedarikci gorunumu, cari rapor, fotograf imzali adresi,
// Excel yedegi indirme (dosya) ve istemci tarafi yazma engeli.
import { chromium } from '@playwright/test';
import { loadQaAccounts } from './lib/qaAccounts.mjs';

const args = process.argv.slice(2);
const BASE = (args.find((a) => /^https?:/.test(a)) || 'http://localhost:5173').replace(/\/$/, '');
const userKey = String((args[args.indexOf('--user') + 1] || 'B')).toUpperCase();
const { url, accounts } = loadQaAccounts();
const acc = accounts[userKey];

let fail = 0;
const seen = async (locator, ms = 15000) => locator.first().waitFor({ state: 'visible', timeout: ms }).then(() => true).catch(() => false);
const rec = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
await ctx.addInitScript((id) => { localStorage.setItem('curtain_saas_device_id', id); }, acc.deviceId);
const page = await ctx.newPage();
const dialogs = [];
page.on('dialog', async (d) => { dialogs.push(`${d.type()}:${String(d.message()).slice(0, 60)}`); await d.dismiss(); });
let pageErrors = 0;
page.on('pageerror', () => { pageErrors++; });

try {
  console.log(`Temel URL: ${BASE}  (kullanici ${userKey}, cihaz ${acc.deviceId})`);
  await page.goto(`${BASE}/#/login`);
  await page.locator('input[type="email"]').first().fill(acc.email);
  await page.locator('input[type="password"]').first().fill(acc.password);
  await page.getByRole('button', { name: /^Giriş Yap$/ }).click();
  await page.waitForURL(/#\/(dashboard|app\/dashboard|field|locked)/, { timeout: 40000 }).catch(() => {});
  await page.waitForTimeout(3500);
  rec('giris yapildi, uygulama KILITLENMEDI (/locked degil)', !/#\/locked|#\/login/.test(page.url()), page.url().split('#')[1]);
  const body0 = await page.locator('body').innerText();
  rec('salt-okunur/sure bitti bilgisi gosteriliyor', /DENEME SÜRENİZ DOLMUŞTUR|salt okunur|süre.*dol/i.test(body0));

  // Musteri listesi: kayit gorunur
  await page.goto(`${BASE}/#/customers`); await page.waitForTimeout(3000);
  rec('musteri listesi gorunuyor (probe kayit)', await seen(page.getByText(/QA Subscription Gate Probe/i)));

  // Tedarikci: liste + cari ekstre sayfasi
  await page.goto(`${BASE}/#/suppliers`); await page.waitForTimeout(3000);
  rec('tedarikci listesi gorunuyor', await seen(page.getByText(/QA Gate Supplier/i)));
  await page.getByText(/QA Gate Supplier/i).first().click().catch(() => {});
  await page.waitForTimeout(3500);
  const ledgerText = await page.locator('body').innerText();
  rec('tedarikci cari sayfasi acildi, salt-okunur hatasi yok', /QA Gate Supplier/i.test(ledgerText) && !/salt okunur modda/i.test(ledgerText), page.url().split('#')[1]);

  // Istemci tarafi korumanin gercek davranisi (uygulamanin kendi supabase istemcisi)
  const probe = await page.evaluate(async ({ supplierName }) => {
    const sb = window.supabase;
    const out = {};
    const { data: { user } } = await sb.auth.getUser();
    const { data: cm } = await sb.from('company_members').select('company_id').eq('user_id', user.id).eq('is_active', true);
    const companyId = cm?.[0]?.company_id;
    const path = `${companyId}/__gate_probe__/probe.png`;
    const signed = await sb.storage.from('measurement-photos').createSignedUrl(path, 60);
    out.signed = !signed.error && !!signed.data?.signedUrl;
    if (out.signed) { const r = await fetch(signed.data.signedUrl); out.download = r.status; }
    const { data: sup } = await sb.from('suppliers').select('id').eq('name', supplierName).eq('company_id', companyId).maybeSingle();
    const led = await sb.rpc('get_supplier_ledger', { p_supplier_id: sup?.id, p_company_id: companyId, p_limit: 20 });
    out.ledgerOk = !led.error;
    const ins = await sb.from('customers').insert({ company_id: companyId, name: 'QA ENGEL', phone: '5550000004' });
    out.insertBlocked = !!ins.error; out.insertMsg = String(ins.error?.message || '').slice(0, 70);
    const up = await sb.storage.from('measurement-photos').upload(`${companyId}/__gate_probe__/ui-blocked.png`, new Blob(['x'], { type: 'image/png' }));
    out.uploadBlocked = !!up.error; out.uploadMsg = String(up.error?.message || '').slice(0, 70);
    return out;
  }, { supplierName: 'QA Gate Supplier' });
  rec('fotograf imzali adresi alinir (goruntuleme)', probe.signed, `indirme HTTP ${probe.download}`);
  rec('fotograf indirilir', probe.download === 200);
  rec('cari rapor (get_supplier_ledger) istemciden calisir', probe.ledgerOk);
  rec('istemci: yeni kayit engellendi', probe.insertBlocked, probe.insertMsg);
  rec('istemci: dosya yukleme engellendi', probe.uploadBlocked, probe.uploadMsg);

  // Disa aktarma: Excel yedegi dosyasi inmeli
  await page.goto(`${BASE}/#/settings`); await page.waitForTimeout(3000);
  const btn = page.getByRole('button', { name: /Excel Yedeği/ }).first();
  if (await seen(btn)) {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 45000 }).catch(() => null), btn.click()]);
    rec('Excel yedegi (disa aktarma) indirildi', !!dl, dl ? dl.suggestedFilename() : 'indirme olusmadi');
  } else {
    rec('Excel yedegi dugmesi gorunur', false, 'Ayarlar sayfasinda dugme bulunamadi (rol/modul?)');
  }
  rec('sayfa hatasi yok', pageErrors === 0, `pageerror=${pageErrors}`);
} catch (e) {
  console.log('HATA', String(e).slice(0, 240));
  fail++;
} finally {
  await browser.close();
}
console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nGECTI');
process.exit(fail ? 1 : 0);
