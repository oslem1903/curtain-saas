// Dagitilmis Edge Function'larin DURUMUNU dogrular (odeme baslatmaz, para cekmez).
//   node scripts/verify-paytr-functions.mjs
// Beklenen, PayTR anahtarlari TANIMLANMADAN: billing-checkout 503 (billing_disabled/provider_not_configured),
// paytr-callback 503 "not configured" (JWT dogrulamasi kapaliysa; aciksa gateway 401).
import { loadQaAccounts, passwordLogin } from './lib/qaAccounts.mjs';

const { url, anon, accounts } = loadQaAccounts({ requireBoth: false });
const { token } = await passwordLogin({ url, anon }, accounts.B);
let fail = 0;
const rec = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'INFO/FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };

const co = await (await fetch(`${url}/rest/v1/company_members?select=company_id&is_active=eq.true`, {
  headers: { apikey: anon, Authorization: `Bearer ${token}` },
})).json();
const companyId = co?.[0]?.company_id;

const c1 = await fetch(`${url}/functions/v1/billing-checkout`, {
  method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ company_id: companyId, plan_code: 'solo_monthly', accepted_terms: true }),
});
const b1 = await c1.text();
console.log('billing-checkout:', c1.status, b1.slice(0, 120));
rec('billing-checkout dagitilmis ve odeme baslatmiyor (503/4xx)', [400, 401, 403, 409, 503].includes(c1.status));
rec('billing-checkout paymentPageUrl DONMEDI', !/paymentPageUrl/.test(b1));

const c2 = await fetch(`${url}/functions/v1/paytr-callback`, {
  method: 'POST', headers: { apikey: anon, Authorization: `Bearer ${anon}` },
  body: new URLSearchParams({ merchant_oid: 'PRDx', status: 'success', total_amount: '49900', hash: 'x' }),
});
console.log('paytr-callback:', c2.status, (await c2.text()).slice(0, 80));
rec('paytr-callback sahte bildirimi islemiyor (OK DONMEDI)', c2.status !== 200);
console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nTAMAM');
