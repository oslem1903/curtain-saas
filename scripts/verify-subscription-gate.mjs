// Sunucu tarafi abonelik kapisi dogrulamasi (canli, QA hesabiyla; yalnizca REST/Storage — cihaz kaydi yapmaz).
//
//   node scripts/verify-subscription-gate.mjs --user B --expect active
//   node scripts/verify-subscription-gate.mjs --user B --expect expired
//   node scripts/verify-subscription-gate.mjs --user B --cleanup
//
// Urun karari: sure bitince firma kendi verisini GORUNTULEYEBILIR ve DISA AKTARABILIR;
// yeni kayit, duzenleme, silme sunucuda ENGELLENIR.
//
// Sira (deneme tarihini SQL Editor'dan degistirirsiniz; ESKI DEGER KAYDEDILMELI ve geri yuklenmeli):
//   1) --expect active   : RPC'ler access_allowed=true; okuma+yazma calisir; probe musteri + Storage probe nesnesi birakilir.
//   2) QA firmasinin trial_ends_at'i gecmise alinir.
//   3) --expect expired  : access_allowed=false; okuma/imzali adres/indirme ACIK;
//                          dogrudan REST insert/update/delete ve Storage yukleme/silme ENGELLI.
//   4) trial_ends_at eski degerine geri alinir.
//   5) --cleanup         : probe musteri ve Storage nesnesi silinir (yazma yeniden calisir).
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

// ---- Storage yardimcilari (gercek kullanici token'i ile; kendi firmasinin klasoru)
const BUCKET = 'measurement-photos';
const OBJ = `${companyId}/__gate_probe__/probe.png`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const sHdr = { apikey: ctx.anon, Authorization: `Bearer ${token}` };
const signObj = async () => {
  const r = await fetch(`${ctx.url}/storage/v1/object/sign/${BUCKET}/${OBJ}`, { method: 'POST', headers: { ...sHdr, 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 60 }) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.status === 200 && !!j.signedURL, status: r.status, url: j.signedURL ? `${ctx.url}/storage/v1${j.signedURL}` : null };
};
const uploadObj = (path) => fetch(`${ctx.url}/storage/v1/object/${BUCKET}/${path}`, { method: 'POST', headers: { ...sHdr, 'Content-Type': 'image/png' }, body: PNG });
const removeObj = (path) => fetch(`${ctx.url}/storage/v1/object/${BUCKET}/${path}`, { method: 'DELETE', headers: sHdr });

console.log(`\n--- RPC'ler (beklenen: ${expect}) ---`);
const allowed = await rpc('company_subscription_access_allowed', { p_company_id: companyId });
check('company_subscription_access_allowed calisiyor', allowed.status === 200 && typeof allowed.body === 'boolean', `HTTP ${allowed.status}`);
check(`access_allowed === ${expect === 'active'}`, allowed.body === (expect === 'active'), String(allowed.body));
const snap = await rpc('company_subscription_access_snapshot', { p_company_id: companyId });
check('company_subscription_access_snapshot calisiyor', snap.status === 200 && !!snap.body && typeof snap.body.access_allowed === 'boolean', `HTTP ${snap.status}`);
check('snapshot.access_allowed ve server_time tutarli', snap.body?.access_allowed === (expect === 'active') && !!snap.body?.server_time, `kind=${snap.body?.access_kind}`);

console.log('\n--- Yetki: baska firmanin abonelik bilgisi okunamaz ---');
const other = ctx.accounts[USER === 'A' ? 'B' : 'A'];
if (other) {
  const { token: otherToken } = await passwordLogin(ctx, other);
  const oh = { apikey: ctx.anon, Authorization: `Bearer ${otherToken}`, 'Content-Type': 'application/json' };
  const asOther = await fetch(`${ctx.url}/rest/v1/rpc/company_subscription_access_snapshot`, { method: 'POST', headers: oh, body: JSON.stringify({ p_company_id: companyId }) });
  const otherBody = await asOther.json().catch(() => ({}));
  check('baska firma kullanicisi snapshot ALAMAZ', asOther.status >= 400 && !otherBody.access_kind, `HTTP ${asOther.status}`);
  const missing = await fetch(`${ctx.url}/rest/v1/rpc/company_subscription_access_snapshot`, { method: 'POST', headers: oh, body: JSON.stringify({ p_company_id: '00000000-0000-4000-8000-000000000000' }) });
  const missingBody = await missing.json().catch(() => ({}));
  check('var olmayan firma ile var olan firma AYNI hatayi verir (varlik sizmaz)', missing.status === asOther.status && (missingBody.code || '') === (otherBody.code || ''), `HTTP ${missing.status}/${asOther.status}`);
  const asOtherBool = await fetch(`${ctx.url}/rest/v1/rpc/company_subscription_access_allowed`, { method: 'POST', headers: oh, body: JSON.stringify({ p_company_id: companyId }) });
  check('baska firma icin access_allowed false (bilgi vermez)', (await asOtherBool.json().catch(() => null)) === false);
}
const anonSnap = await fetch(`${ctx.url}/rest/v1/rpc/company_subscription_access_snapshot`, { method: 'POST', headers: { apikey: ctx.anon, Authorization: `Bearer ${ctx.anon}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_company_id: companyId }) });
check('anon RPC cagiramaz', anonSnap.status >= 400, `HTTP ${anonSnap.status}`);

if (expect === 'active') {
  console.log('\n--- Okuma + yazma (aktif deneme) ---');
  let probe = (await getProbe())[0];
  if (cleanup) {
    if (!probe) console.log('(silinecek probe musteri yok)');
    else {
      const del = await rest(`customers?id=eq.${probe.id}`, { method: 'DELETE' });
      check('delete calisir (probe musteri temizlendi)', del.ok && (await getProbe()).length === 0, `HTTP ${del.status}`);
    }
    const rmo = await removeObj(OBJ);
    check('Storage probe nesnesi temizlendi', [200, 400, 404].includes(rmo.status), `HTTP ${rmo.status}`);
  } else {
    const rd = await rest('customers?select=id&limit=3');
    check('okuma calisir (GET)', rd.ok, `HTTP ${rd.status}`);
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
    let o = await signObj();
    if (!o.ok) {
      const up = await uploadObj(OBJ);
      check('Storage yukleme calisir', up.status === 200, `HTTP ${up.status}`);
      o = await signObj();
    }
    check('Storage imzali adres alinir (goruntuleme)', o.ok, `HTTP ${o.status}`);
    if (o.url) check('Storage dosya indirilir', (await fetch(o.url)).status === 200);
  }
} else {
  const probe = (await getProbe())[0];
  console.log('\n--- Goruntuleme / disa aktarma ACIK olmali (suresi bitmis) ---');
  const listAll = await rest('customers?select=id&limit=5');
  check('musteri listesi okunabiliyor (GET)', listAll.ok, `HTTP ${listAll.status}`);
  check('probe satiri okunabiliyor (SELECT acik)', !!probe, probe ? 'gorunur' : 'yok — once --expect active calistirin');
  const o = await signObj();
  check('Storage imzali adres alinabiliyor (goruntuleme)', o.ok, o.ok ? 'ok' : `HTTP ${o.status} — once --expect active ile nesne olusturun`);
  if (o.url) check('Storage dosya indirilebiliyor', (await fetch(o.url)).status === 200);

  console.log('\n--- Yeni kayit / duzenleme / silme ENGELLI olmali ---');
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
  const blockedPath = `${companyId}/__gate_probe__/blocked-${Date.now()}.png`;
  const upNew = await uploadObj(blockedPath);
  const gap = upNew.status < 400;
  check('Storage yeni dosya yukleme engellendi', !gap, `HTTP ${upNew.status}${gap ? ' — ACIK KANITLANDI: supabase_migration_029b gerekli' : ''}`);
  if (gap) await removeObj(blockedPath);
  if (o.ok) {
    await removeObj(OBJ);
    check('Storage dosya silme engellendi (nesne duruyor)', (await signObj()).ok, gap ? 'ACIK: 029b gerekli' : '');
  }
}
console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nGECTI');
process.exit(fail ? 1 : 0);
