// PayTR TEST MODU odeme dogrulamasi (gercek para cekilmez). QA firmasi B (billing_test_companies'te) ile.
//
//   1) node scripts/verify-paytr-test-payment.mjs start
//        - once-durumu kaydeder (.qa-paytr-state.json, Git disi), billing-checkout'u cagirir, test odeme sayfasi
//          adresini yazar. Adresi tarayicida acip PayTR TEST kartiyla odemeyi tamamlayin.
//   2) node scripts/verify-paytr-test-payment.mjs check
//        - callback sonrasi: odeme kaydi TAM 1 adet, lisans bitisi TEK DONEM uzamis, intent 'paid'.
//   3) (istege bagli, kendi terminalinizde) PAYTR_MERCHANT_KEY / PAYTR_MERCHANT_SALT ortam degiskenleriyle:
//      node scripts/verify-paytr-test-payment.mjs replay
//        - AYNI basarili bildirimi Metraj360 callback'i uzerinden (yonlendirme yoluyla) yeniden gonderir;
//          lisans/odeme sayisi DEGISMEMELI. Anahtarlar cikti/log'a yazilmaz.
// Hicbir adim herkese acik satin almayi acmaz (is_purchasable false kalir).
import fs from 'node:fs';
import { createHmac } from 'node:crypto';
import { loadQaAccounts, passwordLogin } from './lib/qaAccounts.mjs';

const STATE = '.qa-paytr-state.json';
const METRAJ_CALLBACK = 'https://ijnfxovtochayjorlmrj.supabase.co/functions/v1/paytr-callback';
const mode = process.argv[2];
// PLAN=solo_yearly EXPECT_MINOR=249500 -> kampanyali yillik test (qa_preview=true, kampanya genel kapali). Varsayilan: aylik 49900.
const PLAN = process.env.PLAN || 'solo_monthly';
const EXPECT_MINOR = Number(process.env.EXPECT_MINOR || (PLAN === 'solo_yearly' ? 499000 : 49900));
const { url, anon, accounts } = loadQaAccounts({ requireBoth: false });
const acc = accounts.B;
const { token } = await passwordLogin({ url, anon }, acc);
const H = { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const get = async (path) => (await fetch(`${url}/rest/v1/${path}`, { headers: H })).json();
let fail = 0;
const rec = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };

const members = await get('company_members?select=company_id&is_active=eq.true');
const companyId = members?.[0]?.company_id;
const snapshot = async () => {
  const [co] = await get(`companies?select=plan_status,license_expires_at,trial_ends_at&id=eq.${companyId}`);
  const pays = await get(`billing_payments?select=id,amount_minor,status,channel&company_id=eq.${companyId}`);
  return { plan_status: co?.plan_status, license_expires_at: co?.license_expires_at, trial_ends_at: co?.trial_ends_at, payments: pays.length };
};

if (mode === 'start') {
  const test = await get(`billing_test_companies?select=company_id&company_id=eq.${companyId}`);
  rec('QA firmasi billing_test_companies icinde', test?.length === 1);
  const plans = await get('billing_plans?select=code,is_purchasable');
  // Not: canli sistemde plan satisi acik olabilir; QA firmasi yine de PayTR TEST modunda calisir (sunucu zorlar).
  const before = await snapshot();
  const r = await fetch(`${url}/functions/v1/billing-checkout`, {
    method: 'POST', headers: H, body: JSON.stringify({ company_id: companyId, plan_code: PLAN, accepted_terms: true, expected_amount_minor: EXPECT_MINOR }),
  });
  const j = await r.json().catch(() => ({}));
  rec('billing-checkout test odeme sayfasi dondu', r.ok && /^https:\/\/www\.paytr\.com\/odeme\/guvenli\//.test(j.paymentPageUrl || ''), `HTTP ${r.status} ${j.error || ''}`);
  rec('test_mode=true (QA firmasi icin zorunlu)', j.test_mode === true);
  rec(`sunucu tutari ${EXPECT_MINOR} kurus`, j.amount_minor === EXPECT_MINOR, String(j.amount_minor));
  if (r.ok) {
    fs.writeFileSync(STATE, JSON.stringify({ companyId, intent_id: j.intent_id, before, startedAt: new Date().toISOString() }));
    console.log('\nTEST odeme sayfasi (PayTR test karti ile, gercek para cekilmez):\n' + j.paymentPageUrl);
  }
} else if (mode === 'check') {
  const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const after = await snapshot();
  rec('lisans durumu active', after.plan_status === 'active', after.plan_status);
  rec('TAM 1 odeme kaydi eklendi', after.payments === st.before.payments + 1, `${st.before.payments} -> ${after.payments}`);
  const base = new Date(st.before.license_expires_at || st.before.trial_ends_at).getTime();
  const end = new Date(after.license_expires_at).getTime();
  const days = (end - Math.max(base, Date.parse(st.startedAt))) / 86400000;
  const [lo, hi] = PLAN === 'solo_yearly' ? [364.5, 366.5] : [27.5, 31.5];
  rec('bitis YALNIZ 1 dönem uzamis', days >= lo && days <= hi, `${days.toFixed(1)} gun`);
  const pay = (await get(`billing_payments?select=amount_minor&company_id=eq.${st.companyId}&order=created_at.desc&limit=1`))[0];
  rec(`odeme kaydi ${EXPECT_MINOR} kurus`, pay?.amount_minor === EXPECT_MINOR, String(pay?.amount_minor));
  fs.writeFileSync(STATE, JSON.stringify({ ...st, afterFirst: after }));
} else if (mode === 'replay') {
  const key = process.env.PAYTR_MERCHANT_KEY, salt = process.env.PAYTR_MERCHANT_SALT;
  if (!key || !salt) { console.error('PAYTR_MERCHANT_KEY / PAYTR_MERCHANT_SALT ortam degiskenleri gerekli (yazdirilmaz).'); process.exit(2); }
  const st = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const oid = 'PRD' + st.intent_id.replace(/-/g, '');
  const total = String(EXPECT_MINOR);
  const hash = createHmac('sha256', key).update(oid + salt + 'success' + total).digest('base64');
  const body = new URLSearchParams({ merchant_oid: oid, status: 'success', total_amount: total, hash, currency: 'TL', test_mode: '1', payment_type: 'card' });
  const before = await snapshot();
  const r = await fetch(METRAJ_CALLBACK, { method: 'POST', body });
  const t = await r.text();
  rec('yinelenen bildirim Metraj360 yonlendirmesiyle "OK" aldi', r.ok && t === 'OK', `HTTP ${r.status}`);
  const after = await snapshot();
  rec('odeme sayisi DEGISMEDI', after.payments === before.payments, `${before.payments} -> ${after.payments}`);
  rec('lisans bitisi DEGISMEDI (ikinci kez uzamadi)', after.license_expires_at === before.license_expires_at);
} else {
  console.error('kullanim: start | check | replay');
  process.exit(2);
}
console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nTAMAM');
process.exit(fail ? 1 : 0);
