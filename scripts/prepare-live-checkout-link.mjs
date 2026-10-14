// QA B ile YENI gercek mod PayTR odeme baglantisi uretir (kart girilmez, tahsilat yapilmaz).
//   node scripts/prepare-live-checkout-link.mjs [solo_monthly|solo_yearly]
// Cikti: kontrol saati, plan, merchant_oid (destek icin; gizli degil). Odeme sayfasi adresi (token iceren) ekrana
// YAZILMAZ; .qa-paytr-live-link.txt dosyasina (Git disi) yazilir.
import fs from 'node:fs';
import { loadQaAccounts, passwordLogin } from './lib/qaAccounts.mjs';

const plan = process.argv[2] || 'solo_monthly';
const { url, anon, accounts } = loadQaAccounts({ requireBoth: false });
const { token } = await passwordLogin({ url, anon }, accounts.B);
const H = { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const mem = await (await fetch(`${url}/rest/v1/company_members?select=company_id&is_active=eq.true`, { headers: H })).json();
const at = new Date();
const r = await fetch(`${url}/functions/v1/billing-checkout`, {
  method: 'POST', headers: H, body: JSON.stringify({ company_id: mem[0].company_id, plan_code: plan, accepted_terms: true }),
});
const j = await r.json().catch(() => ({}));
if (!r.ok || !j.paymentPageUrl) { console.error('baglanti uretilemedi', r.status, j.error || ''); process.exit(1); }
fs.writeFileSync('.qa-paytr-live-link.txt', j.paymentPageUrl);
console.log(JSON.stringify({
  kontrol_saati_istanbul: at.toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' }),
  kontrol_saati_utc: at.toISOString(),
  plan, test_mode: j.test_mode,
  merchant_oid: 'PRD' + String(j.intent_id).replace(/-/g, ''),
  intent_id: j.intent_id,
  baglanti_dosyasi: '.qa-paytr-live-link.txt (Git disi)',
}, null, 2));
