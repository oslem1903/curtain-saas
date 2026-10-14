// Tahsilat ve Ödemeler: SAHTE veriyle toplamlar, filtreler, yerleşim (gercek kayda dokunmaz).
//   node scripts/qa-collections-layout.mjs [temelUrl]
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import { loadQaAccounts } from './lib/qaAccounts.mjs';
const BASE = (process.argv[2] || 'http://localhost:5199').replace(/\/$/, '');
const acc = loadQaAccounts({ requireBoth: false }).accounts.A;
fs.mkdirSync('test-results/collections', { recursive: true });
let fail = 0;
const rec = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };
const json = (b) => (r) => r.request().method() === 'GET' ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(b) }) : r.continue();
const EID = '22222222-2222-2222-2222-222222222222';
const MOCK = {
  orders: [
    { id: 'aaaaaaaa-0000-0000-0000-000000000001', customer_id: 'c1', total_amount: 7875, paid_amount: 875, remaining_amount: 7000, payment_due_date: null, status: 'confirmed', customer: { name: 'Ayşe Müşteri', phone: '0555' } },
    { id: 'aaaaaaaa-0000-0000-0000-000000000002', customer_id: 'c2', total_amount: 1000, paid_amount: 1000, remaining_amount: 0, payment_due_date: null, status: 'confirmed', customer: { name: 'Kapalı Müşteri', phone: '' } },
  ],
  supplier_transactions: [
    { id: 's1', supplier_id: 'sup1', transaction_type: 'debt', amount: 4875, transaction_date: '2026-10-01', due_date: '2026-10-20', description: 'Kumaş alımı', suppliers: { name: 'Uzun İsimli Kumaş Tedarik Anonim Şirketi' } },
    { id: 's2', supplier_id: 'sup1', transaction_type: 'payment', amount: 937.5, transaction_date: '2026-10-05', due_date: null, description: '', suppliers: { name: 'x' } },
  ],
  employees: [{ id: EID, user_id: EID, full_name: 'Mehmet Montajcı' }],
  installation_jobs: [{ id: 'j1', order_id: 'aaaaaaaa-0000-0000-0000-000000000001', assigned_staff_id: EID, status: 'completed', installer_fee: 350, is_internal_installation: false }],
  installer_earnings: [{ id: 'e1', installer_id: EID, installation_job_id: 'j1', order_id: 'aaaaaaaa-0000-0000-0000-000000000001', earning_type: 'auto', total_earning: 350, created_at: '2026-10-02T10:00:00Z' }],
  installer_transactions: [],
  order_payment_plans: [], payments: [], order_installments: [],
};
const browser = await chromium.launch();
for (const [name, w, h] of [['telefon-360x640', 360, 640], ['yatay-844x390', 844, 390], ['bluestacks-1280x720', 1280, 720]]) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addInitScript((id) => localStorage.setItem('curtain_saas_device_id', id), acc.deviceId);
  const page = await ctx.newPage();
  for (const [t, body] of Object.entries(MOCK)) await page.route(`**/rest/v1/${t}*`, json(body));
  await page.goto(`${BASE}/#/login`);
  await page.locator('input[type="email"]').first().fill(acc.email);
  await page.locator('input[type="password"]').first().fill(acc.password);
  await page.getByRole('button', { name: /^Giriş Yap$/ }).click();
  await page.waitForURL(/#\/(dashboard|app\/dashboard|field)/, { timeout: 60000 });
  await page.goto(`${BASE}/#/collections`);
  await page.getByText('Müşterilerden alınacak toplam').waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
  const txt = await page.locator('main').innerText();
  const tr = (n) => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(n).replace(/\s/g, ' ');
  const norm = txt.replace(/ /g, ' ');
  rec(`[${name}] başlık "Tahsilat ve Ödemeler"`, /Tahsilat ve Ödemeler/.test(norm));
  rec(`[${name}] alacak 7.000,00`, norm.includes(tr(7000)), tr(7000));
  rec(`[${name}] tedarikçi borcu 3.937,50 (kısmi ödeme sonrası)`, norm.includes(tr(3937.5)));
  rec(`[${name}] montajcı 350,00`, norm.includes(tr(350)));
  rec(`[${name}] net fark 2.712,50`, norm.includes(tr(2712.5)));
  rec(`[${name}] kapalı kayıt listede yok`, !/Kapalı Müşteri/.test(norm));
  rec(`[${name}] "Vade tarihi ekle" sadece vadesiz müşteri kaydında`, (await page.getByText('Vade tarihi ekle').count()) === 1);
  await page.getByRole('button', { name: 'Tedarikçi Borçları' }).click();
  await page.waitForTimeout(300);
  const t2 = (await page.locator('main').innerText()).replace(/ /g, ' ');
  rec(`[${name}] tedarikçi filtresi yalnız tedarikçi`, /Kumaş alımı/.test(t2) && !/Mehmet Montajcı/.test(t2) && !/Ayşe Müşteri/.test(t2));
  rec(`[${name}] "Ödeme Ekle" ve "Detay / Ekstre" var`, (await page.getByRole('button', { name: 'Ödeme Ekle' }).count()) >= 1 && (await page.getByRole('button', { name: 'Detay / Ekstre' }).count()) >= 1);
  await page.getByRole('button', { name: 'Montajcı Borçları' }).click();
  await page.waitForTimeout(300);
  const t3 = await page.locator('main').innerText();
  rec(`[${name}] montajcı filtresi + Vadesiz`, /Mehmet Montajcı/.test(t3) && /Vadesiz/.test(t3));
  await page.getByRole('button', { name: 'Müşteri Alacakları' }).click();
  await page.waitForTimeout(300);
  rec(`[${name}] "Tahsilat Ekle" müşteri satırında`, (await page.getByRole('button', { name: 'Tahsilat Ekle' }).count()) === 1);
  const ov = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  rec(`[${name}] sayfa yatay taşmıyor`, !ov);
  await page.screenshot({ path: `test-results/collections/${name}.png` });
  await ctx.close();
}
await browser.close();
console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nTUM KONTROLLER GECTI');
process.exit(fail ? 1 : 0);
