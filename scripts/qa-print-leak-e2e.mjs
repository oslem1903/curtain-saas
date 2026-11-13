// Parçalı En işaretinin Randevu → "Siparişe Dönüştür" (NewOrder) akışında ve yazdırma (PDF) çıktısında sızmadığını doğrular.
// Yalnız bu betiğin oluşturduğu müşteri/randevuyu siler.   node scripts/qa-print-leak-e2e.mjs [temelUrl]
import { chromium } from '@playwright/test';
import { loadQaAccounts } from './lib/qaAccounts.mjs';

const BASE = (process.argv[2] || 'http://localhost:5199').replace(/\/$/, '');
const A = loadQaAccounts({ requireBoth: false }).accounts.A;
const TS = Date.now();
let fail = 0;
const rec = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };
const browser = await chromium.launch({ channel: process.env.QA_BROWSER_CHANNEL || undefined });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 1000 } });
await ctx.addInitScript((id) => localStorage.setItem('curtain_saas_device_id', id), A.deviceId);
const page = await ctx.newPage();
const created = {};
try {
  await page.goto(`${BASE}/#/login`);
  await page.locator('input[type="email"]').first().fill(A.email);
  await page.locator('input[type="password"]').first().fill(A.password);
  await page.locator('form button[type="submit"]').first().click();
  await page.waitForURL(/#\/(dashboard|app\/dashboard|field)/, { timeout: 60000 });

  const marker = '[Parcalar: {"v":1,"p":[{"n":"Sol duvar","c":40},{"n":"Pencere","c":180},{"n":"Sag duvar","c":30}],"s":[1]}]';
  const normal = `NORMAL-NOT-${TS} pencere onune dikilecek`;
  const seed = await page.evaluate(async ({ marker, normal, TS }) => {
    const sb = window.supabase;
    const { data: { user } } = await sb.auth.getUser();
    let cid = (await sb.from('profiles').select('company_id').eq('id', user.id).maybeSingle()).data?.company_id;
    if (!cid) cid = (await sb.from('company_members').select('company_id').eq('user_id', user.id).limit(1)).data?.[0]?.company_id;
    const { data: c } = await sb.from('customers').insert([{ company_id: cid, name: `QA-SHARE Print ${TS}` }]).select('id').single();
    const note = `${normal}\n[Grup: g-${TS}]\n${marker}`;
    const { data: a, error } = await sb.from('appointments').insert([{ company_id: cid, customer_id: c.id, type: 'measurement', title: 'Stor ölçüsü', status: 'measured', start_at: new Date().toISOString(), room_name: 'Salon', width_cm: 180, height_cm: 210, quantity: 1, product_type: 'stor', unit_price: 500, note, measurement_notes: note }]).select('id').single();
    if (error) throw new Error(error.message);
    return { cust: c.id, appt: a.id };
  }, { marker, normal, TS });
  Object.assign(created, seed);

  await page.goto(`${BASE}/#/appointments/${seed.appt}`);
  await page.reload();
  await page.getByText(normal.slice(0, 20)).first().waitFor({ timeout: 45000 });
  const apptBody = await page.locator('body').innerText();
  const apptTextareas = await page.locator('textarea').evaluateAll((els) => els.map((e) => e.value));
  rec('Randevu detayı: normal not görünüyor', apptBody.includes(normal) || apptTextareas.some((v) => v.includes(normal)));
  rec('Randevu detayı: [Parcalar] görünmüyor (metin + alanlar)', !/Parcalar/.test(apptBody) && !apptTextareas.some((v) => /Parcalar/.test(v)));

  await page.getByRole('button', { name: /Siparişe Dönüştür/ }).click();
  await page.waitForURL(/#\/orders\/new/, { timeout: 20000 });
  await page.getByText(/Teklif \/ Sipariş Oluştur/).first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(4000);
  const values = await page.locator('textarea, input').evaluateAll((els) => els.map((e) => e.value || ''));
  const all = values.join('\n');
  rec('Teklif/Sipariş formu: normal not korunuyor', all.includes(normal), all.includes(normal) ? '' : 'bulunamadı');
  rec('Teklif/Sipariş formu alanlarında [Parcalar] yok', !/Parcalar/.test(all));

  // Yazdırma çıktısı (PDF Oluştur = window.print): print medyasında DOM + alan değerleri
  await page.emulateMedia({ media: 'print' });
  const printText = await page.evaluate(() => document.body.innerText + '\n' + [...document.querySelectorAll('textarea,input')].map((e) => e.value).join('\n') + '\n' + document.documentElement.outerHTML.includes('Parcalar'));
  rec('Yazdırma (print medyası): normal not var, [Parcalar] yok', printText.includes(normal) && !/Parcalar/.test(printText.replace(/\ntrue$|\nfalse$/, '')) && !/\ntrue$/.test(printText));
  const pdf = await page.pdf({ format: 'A4' }).catch((e) => { console.log('pdf:', e.message.slice(0, 80)); return null; });
  if (pdf) {
    const raw = Buffer.from(pdf).toString('latin1');
    rec('PDF üretildi (baytlar)', raw.startsWith('%PDF'), `${pdf.length} bayt`);
  }
  await page.emulateMedia({ media: 'screen' });
} catch (e) { fail++; console.log('HATA:', e.message); }
finally {
  await page.evaluate(async (c) => {
    const sb = window.supabase;
    if (c.appt) await sb.from('appointments').delete().eq('id', c.appt);
    if (c.cust) await sb.from('customers').delete().eq('id', c.cust);
  }, created).catch(() => {});
  await browser.close();
}
console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nTUM KONTROLLER GECTI');
process.exit(fail ? 1 : 0);
