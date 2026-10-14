// CANLI mod odeme hazirligi: fiyatlar, odeme dugmesi, gercek modda PayTR sayfasi acilir mi — TAHSILAT YAPMAZ.
//   node scripts/verify-live-checkout.mjs [uygulamaUrl]
// QA firmasi B ile calisir. Kart bilgisi GIRILMEZ, odeme dugmesine tiklanmaz; yalnizca sunucudan odeme
// sayfasi adresi uretilir ve sayfanin GET ile acildigi dogrulanir. Gercek tahsilat DENENMEZ.
import { chromium } from '@playwright/test';
import { loadQaAccounts, passwordLogin } from './lib/qaAccounts.mjs';

const BASE = (process.argv[2] || 'https://oslem1903-curtain-saas.vercel.app').replace(/\/$/, '');
const { url, anon, accounts } = loadQaAccounts({ requireBoth: false });
const acc = accounts.B;
let fail = 0;
const rec = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };

// 1) Canli fiyatlar (RLS'li okuma)
const { token } = await passwordLogin({ url, anon }, acc);
const H = { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const plans = await (await fetch(`${url}/rest/v1/billing_plans?select=code,price_minor,currency,period,is_purchasable&order=sort_order`, { headers: H })).json();
const m = plans.find((p) => p.code === 'solo_monthly'), y = plans.find((p) => p.code === 'solo_yearly');
rec('canli fiyat: 1 aylik 499 TL, 1 yillik 4.990 TL (TRY)', m?.price_minor === 49900 && y?.price_minor === 499000 && m.currency === 'TRY');
rec('planlar satin almaya ACIK (is_purchasable=true)', m?.is_purchasable === true && y?.is_purchasable === true);

// 2) Arayuz: Abonelik ekrani
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript((id) => localStorage.setItem('curtain_saas_device_id', id), acc.deviceId);
const page = await ctx.newPage();
let checkoutCalls = 0;
page.on('request', (r) => { if (/functions\/v1\/billing-checkout/.test(r.url()) && r.method() === 'POST') checkoutCalls++; });
await page.goto(`${BASE}/#/login`);
await page.locator('input[type="email"]').first().fill(acc.email);
await page.locator('input[type="password"]').first().fill(acc.password);
await page.getByRole('button', { name: /^Giriş Yap$/ }).click();
await page.waitForURL(/#\/(dashboard|app\/dashboard|field)/, { timeout: 60000 });
await page.goto(`${BASE}/#/subscription`);
await page.waitForTimeout(4000);
const body = await page.locator('main').innerText();
rec('"Açılışa Özel Fiyatlar" başlığı', /Açılışa Özel Fiyatlar/.test(body));
rec('499 TL ve 4.990 TL görünüyor', /499/.test(body) && /4\.990/.test(body));
rec('"Aylık ödemeye göre 2 ay avantajlı"', /Aylık ödemeye göre 2 ay avantajlı/.test(body));
rec('"Ödeme yakında açılacak" YOK', !/Ödeme yakında açılacak/.test(body));
await page.getByRole('checkbox').first().check();
const btns = page.getByRole('button', { name: /Ödemeye geç|Test ödemesine geç/ });
const n = await btns.count();
rec('ödeme düğmesi görünüyor ve etkin (2 paket)', n === 2 && (await btns.first().isEnabled()) && (await btns.nth(1).isEnabled()), `${n} düğme`);
rec('düğme etiketi "Ödemeye geç" (test etiketi değil)', /Ödemeye geç/.test(await btns.first().innerText()));
rec('düğmeye TIKLANMADI (billing-checkout çağrısı yok)', checkoutCalls === 0);
await browser.close();

// 3) Gercek modda odeme sayfasi uretimi (sunucu) ve acilisi — kart girilmez
const mem = await (await fetch(`${url}/rest/v1/company_members?select=company_id&is_active=eq.true`, { headers: H })).json();
const r = await fetch(`${url}/functions/v1/billing-checkout`, {
  method: 'POST', headers: H, body: JSON.stringify({ company_id: mem?.[0]?.company_id, plan_code: 'solo_monthly', accepted_terms: true }),
});
const j = await r.json().catch(() => ({}));
rec('billing-checkout GERCEK modda (test_mode=false) odeme sayfasi dondu', r.ok && j.test_mode === false && /^https:\/\/www\.paytr\.com\/odeme\/guvenli\//.test(j.paymentPageUrl || ''), `HTTP ${r.status} test_mode=${j.test_mode}`);
if (j.paymentPageUrl) {
  const g = await fetch(j.paymentPageUrl, { redirect: 'follow' });
  const html = await g.text();
  rec('PayTR odeme sayfasi aciliyor (HTTP 200, kart formu)', g.status === 200 && /paytr/i.test(html) && /(kart|card|iframe|payment)/i.test(html), `HTTP ${g.status}, ${html.length} bayt`);
  rec('sayfa giris/hata sayfasi degil', !/hata|error 4\d\d|geçersiz|gecersiz/i.test(html.slice(0, 4000)) || /kart/i.test(html));
}
console.log('\nNOT: gercek tahsilat DENENMEDI; kart girilmedi, odeme tamamlanmadi.');
console.log(fail ? `${fail} KONTROL BASARISIZ` : 'TUM KONTROLLER GECTI');
process.exit(fail ? 1 : 0);
