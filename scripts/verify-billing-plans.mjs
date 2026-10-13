// Uretimde Solo planlarini QA hesabiyla (RLS'li) okur ve satin alma KAPALI mi dogrular; odeme baslatmaz.
//   node scripts/verify-billing-plans.mjs
import { loadQaAccounts, passwordLogin } from './lib/qaAccounts.mjs';

const { url, anon, accounts } = loadQaAccounts({ requireBoth: false });
const acc = accounts.B;
const { token } = await passwordLogin({ url, anon }, acc);
const H = { apikey: anon, Authorization: `Bearer ${token}` };
let fail = 0;
const rec = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };

const r = await fetch(`${url}/rest/v1/billing_plans?select=code,period,price_minor,currency,package_code,is_purchasable&order=sort_order`, { headers: H });
const plans = await r.json();
rec('planlar okunuyor', r.ok && Array.isArray(plans), `HTTP ${r.status}`);
const m = plans.find((p) => p.code === 'solo_monthly');
const y = plans.find((p) => p.code === 'solo_yearly');
rec('1 aylik = 499 TL (49900 kurus, TRY, month, solo)', m?.price_minor === 49900 && m.currency === 'TRY' && m.period === 'month' && m.package_code === 'solo');
rec('1 yillik = 4.990 TL (499000 kurus, TRY, year, solo)', y?.price_minor === 499000 && y.currency === 'TRY' && y.period === 'year' && y.package_code === 'solo');
rec('yillik = 12 aylik - 2 ay (10 x aylik)', y?.price_minor === m?.price_minor * 10);
rec('satin alma KAPALI (is_purchasable=false)', plans.length === 2 && plans.every((p) => p.is_purchasable === false));

// Istemci tablolara yazamaz
const w = await fetch(`${url}/rest/v1/billing_plans?code=eq.solo_monthly`, {
  method: 'PATCH', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ is_purchasable: true }),
});
rec('istemci plani acamaz (PATCH reddedilir)', !w.ok, `HTTP ${w.status}`);
const after = await (await fetch(`${url}/rest/v1/billing_plans?select=is_purchasable&code=eq.solo_monthly`, { headers: H })).json();
rec('is_purchasable hala false', after?.[0]?.is_purchasable === false);
for (const t of ['billing_events', 'billing_intents']) {
  const x = await fetch(`${url}/rest/v1/${t}?select=*&limit=1`, { headers: H });
  rec(`${t} istemciye kapali`, !x.ok || (await x.json()).length === 0, `HTTP ${x.status}`);
}
const rpc = await fetch(`${url}/rest/v1/rpc/billing_apply_charge`, {
  method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
  body: JSON.stringify({ p_channel: 'paytr', p_event_id: 'x', p_company_id: '00000000-0000-0000-0000-000000000000', p_plan_code: 'solo_monthly', p_provider_payment_id: 'x', p_amount_minor: 49900, p_currency: 'TRY' }),
});
rec('istemci billing_apply_charge cagiramaz', !rpc.ok, `HTTP ${rpc.status}`);
console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nTUM KONTROLLER GECTI');
process.exit(fail ? 1 : 0);
