// Sunucu tarafi abonelik kapisi dogrulamasi (canli, QA hesabiyla; yalnizca REST — cihaz kaydi yapmaz).
//
//   node scripts/verify-subscription-gate.mjs --user B --expect active
//   node scripts/verify-subscription-gate.mjs --user B --expect expired
//   node scripts/verify-subscription-gate.mjs --user B --cleanup
//
// Sira (deneme tarihini SQL Editor'dan degistirirsiniz; eski deger KAYDEDILMELI ve geri yuklenmeli):
//   1) --expect active   : RPC'ler access_allowed=true; yazma (insert/update) calisir; "probe" musteri birakilir.
//   2) QA firmasinin trial_ends_at'i gecmise alinir.
//   3) --expect expired  : access_allowed=false; dogrudan REST insert/update/delete ENGELLENIR;
//                          okuma (SELECT) ACIK kalir; probe satiri degismeden durur.
//   4) trial_ends_at eski degerine geri alinir.
//   5) --cleanup         : probe silinir (yazma yeniden calisir).
import { loadQaAccounts, passwordLogin } from './lib/qaAccounts.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const USER = String(arg('--user', 'B')).toUpperCase();
const cleanup = process.argv.includes('--cleanup');
const expect = arg('--expect', cleanup ? 'active' : null);
if (!['active', 'expired'].includes(expect)) { console.error('--expect active|expired veya --cleanup gerekli'); process.exit(2); }

const ctx = loadQaAccounts();
const acc = ctx.accounts[USER];
const { token } = await passwordLogin(ctx, acc);
const H = { apikey: ctx.anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' };
const rest = (p, init = {}) => fetch(`${ctx.url}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
const rpc = async (name, body) => {
  const r = await rest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};

let fail = 0;
const check = (n, ok, d = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  -> ' + d : ''}`); };

const members = await (await rest('company_members?select=company_id&is_active=eq.true')).json();
const companyId = members?.[0]?.company_id;
check(`${USER}: tek aktif firmaya uye`, Array.isArray(members) && members.length === 1);
const PROBE = 'QA Subscription Gate Probe';
const getProbe = async () => (await (await rest(`customers?select=id,name,phone&name=eq.${encodeURIComponent(PROBE)}&company_id=eq.${companyId}`)).json());

console.log(`\n--- RPC'ler (beklenen: ${expect}) ---`);
const allowed = await rpc('company_subscription_access_allowed', { p_company_id: companyId });
check('company_subscription_access_allowed calisiyor', allowed.status === 200 && typeof allowed.body === 'boolean', `HTTP ${allowed.status}`);
check(`access_allowed === ${expect === 'active'}`, allowed.body === (expect === 'active'), String(allowed.body));
const snap = await rpc('company_subscription_access_snapshot', { p_company_id: companyId });
check('company_subscription_access_snapshot calisiyor', snap.status === 200 && !!snap.body && typeof snap.body.access_allowed === 'boolean', `HTTP ${snap.status}`);
check('snapshot.access_allowed ve server_time tutarli', snap.body?.access_allowed === (expect === 'active') && !!snap.body?.server_time, `kind=${snap.body?.access_kind}`);

if (expect === 'active') {
  console.log('\n--- Yazma (aktif deneme) ---');
  let probe = (await getProbe())[0];
  if (cleanup) {
    if (!probe) console.log('(silinecek probe yok)');
    else {
      const del = await rest(`customers?id=eq.${probe.id}`, { method: 'DELETE' });
      check('delete calisir (probe temizlendi)', del.ok && (await getProbe()).length === 0, `HTTP ${del.status}`);
    }
  } else {
    if (!probe) {
      const ins = await rest('customers', { method: 'POST', body: JSON.stringify({ company_id: companyId, name: PROBE, phone: '5550000001' }) });
      probe = (await ins.json().catch(() => []))?.[0];
      check('insert calisir', ins.status === 201 && !!probe?.id, `HTTP ${ins.status}`);
    }
    if (probe) {
      const up = await rest(`customers?id=eq.${probe.id}`, { method: 'PATCH', body: JSON.stringify({ phone: '5550000002' }) });
      const rows = await up.json().catch(() => []);
      check('update calisir', up.ok && Array.isArray(rows) && rows.length === 1, `HTTP ${up.status}`);
    }
  }
} else {
  console.log('\n--- Yazma ENGELI (suresi bitmis deneme) ---');
  const probe = (await getProbe())[0];
  check('probe satiri okunabiliyor (SELECT acik)', !!probe, probe ? 'gorunur' : 'yok — once --expect active calistirin');
  const ins = await rest('customers', { method: 'POST', body: JSON.stringify({ company_id: companyId, name: PROBE + ' ENGEL', phone: '5550000003' }) });
  const insBody = await ins.text();
  check('dogrudan INSERT engellendi', ins.status >= 400, `HTTP ${ins.status} ${insBody.slice(0, 90)}`);
  if (probe) {
    const up = await rest(`customers?id=eq.${probe.id}`, { method: 'PATCH', body: JSON.stringify({ phone: '5559999999' }) });
    const upBody = await up.text();
    const after = (await (await rest(`customers?select=phone&id=eq.${probe.id}`)).json())[0];
    check('dogrudan UPDATE engellendi (satir degismedi)', after?.phone !== '5559999999', `HTTP ${up.status} ${upBody.slice(0, 70)}`);
    const del = await rest(`customers?id=eq.${probe.id}`, { method: 'DELETE' });
    const delBody = await del.text();
    check('dogrudan DELETE engellendi (satir duruyor)', (await getProbe()).length === 1, `HTTP ${del.status} ${delBody.slice(0, 70)}`);
  }
}
console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nGECTI');
process.exit(fail ? 1 : 0);
