// Storage firma izolasyonu dogrulama (canli proje, .env.local'deki Supabase).
//
//   node scripts/verify-storage-isolation.mjs
//     -> ANON kontrolleri (anahtar/oturum gerektirmez)
//
// Iki AYRILMIS test hesabi icin .env.e2e icine su degiskenleri koyun (degerler ciktiya yazilmaz):
//   E2E_A_EMAIL / E2E_A_PASSWORD   (ornek: Test Company 1 kullanicisi)
//   E2E_B_EMAIL / E2E_B_PASSWORD   (ornek: Test Company 2 kullanicisi)
//   E2E_COMPANY_NAME_PATTERN       (opsiyonel; varsayilan ^(test|zz ?qa), buyuk/kucuk harf duyarsiz)
//
// Guvenlik korkuluklari — herhangi biri tutmazsa kimlikli testler HIC CALISMAZ:
//   - her hesap tam 1 aktif firmaya uye olmali ve firma adi desenle eslesmeli (gercek musteri firmasi degil)
//   - hesap super admin OLMAMALI (super admin bypass eder, izolasyon testi anlamsiz olur)
//   - A ve B farkli firmalarda olmali
// Test yalnizca "<firma>/__izolasyon_testi__/" altina kendi olusturdugu nesneleri yazar ve ayni calistirmada siler.
import fs from 'node:fs';

const BUCKETS = ['appointment-photos', 'catalog-images', 'catalog-pdfs', 'logos',
  'measurement-photos', 'support-attachments', 'visual-previews'];
const REF = 'ffhmzlcsgsgjonqqhgqq';

const parseEnv = (file) => {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(fs.readFileSync(file, 'utf8').split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
};
const env = { ...parseEnv('.env.local'), ...parseEnv('.env.e2e'), ...process.env };
const URL_ = env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URI;
const ANON = env.VITE_SUPABASE_ANON_KEY;
if (!URL_ || !new URL(URL_).host.startsWith(REF + '.')) { console.error('YANLIS PROJE: .env.local ' + REF + ' degil'); process.exit(2); }

let fail = 0;
const check = (ad, ok, detay = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${ad}${detay ? '  -> ' + detay : ''}`); };
const hdr = (tok, extra = {}) => ({ apikey: ANON, Authorization: 'Bearer ' + (tok || ANON), ...extra });
const J = { 'Content-Type': 'application/json' };
const list = async (b, prefix, tok) => {
  const r = await fetch(`${URL_}/storage/v1/object/list/${b}`, { method: 'POST', headers: hdr(tok, J), body: JSON.stringify({ prefix, limit: 5 }) });
  const j = await r.json().catch(() => null);
  return { status: r.status, n: Array.isArray(j) ? j.length : -1 };
};
const sign = async (b, path, tok) => {
  const r = await fetch(`${URL_}/storage/v1/object/sign/${b}/${path}`, { method: 'POST', headers: hdr(tok, J), body: JSON.stringify({ expiresIn: 60 }) });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, url: j.signedURL ? `${URL_}/storage/v1${j.signedURL}` : null };
};

// ----------------------------------------------------------------- ANON
console.log('--- ANON ---');
for (const b of BUCKETS) {
  const l = await list(b, '');
  check(`anon listeleme bos: ${b}`, l.n === 0, `HTTP ${l.status} n=${l.n}`);
  const g = await fetch(`${URL_}/storage/v1/object/public/${b}/x.png`);
  check(`anon public indirme 4xx: ${b}`, g.status >= 400, `HTTP ${g.status}`);
}

// ------------------------------------------------------- KIMLIKLI (A/B)
const creds = ['A', 'B'].map((k) => ({ k, email: env[`E2E_${k}_EMAIL`], password: env[`E2E_${k}_PASSWORD`] }));
if (creds.some((c) => !c.email || !c.password)) {
  console.log('\n(E2E_A_* / E2E_B_* tanimli degil: iki-firma kimlikli kontrolleri ATLANDI — DOGRULANMADI)');
  console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nANON KONTROLLERI GECTI; kimlikli izolasyon DOGRULANMADI');
  process.exit(fail ? 1 : 0);
}

const pattern = new RegExp(env.E2E_COMPANY_NAME_PATTERN || '^(test|zz ?qa)', 'i');
const abort = (m) => { console.error('DURDURULDU: ' + m); process.exit(3); };
const sessions = [];
for (const c of creds) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, ...J }, body: JSON.stringify({ email: c.email, password: c.password }) });
  if (!r.ok) abort(`${c.k} hesabi giris yapamadi (HTTP ${r.status}). Bilgileri kontrol edin.`);
  const s = await r.json();
  const tok = s.access_token;
  const sa = await fetch(`${URL_}/rest/v1/rpc/is_super_admin`, { method: 'POST', headers: hdr(tok, J), body: '{}' });
  if ((await sa.json().catch(() => null)) === true) abort(`${c.k} hesabi super admin; izolasyon testi icin ayrilmis normal test kullanicisi gerekir.`);
  const mr = await fetch(`${URL_}/rest/v1/company_members?select=company_id,is_active&user_id=eq.${s.user.id}`, { headers: hdr(tok) });
  const members = ((await mr.json().catch(() => [])) || []).filter((m) => m.is_active !== false);
  if (members.length !== 1) abort(`${c.k} hesabi ${members.length} aktif firmaya uye; tam 1 olmali.`);
  const cr = await fetch(`${URL_}/rest/v1/companies?select=id,name&id=eq.${members[0].company_id}`, { headers: hdr(tok) });
  const company = ((await cr.json().catch(() => [])) || [])[0];
  if (!company || !pattern.test(company.name || '')) abort(`${c.k} hesabinin firma adi test desenine uymuyor (gercek firma olabilir); calistirilmadi.`);
  sessions.push({ k: c.k, tok, company: company.id, name: company.name });
}
if (sessions[0].company === sessions[1].company) abort('A ve B ayni firmada; iki FARKLI firma gerekir.');
console.log(`\nA = "${sessions[0].name}", B = "${sessions[1].name}" (farkli firmalar, super admin degil)`);

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.0\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 3 3]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
const TYPES = [['image/png', 'png', PNG], ['application/pdf', 'pdf', PDF], ['text/plain', 'txt', Buffer.from('x')]];
const runId = Date.now().toString(36);
const created = [];

const upload = async (s, b, path, type, body) => {
  const r = await fetch(`${URL_}/storage/v1/object/${b}/${path}`, { method: 'POST', headers: hdr(s.tok, { 'Content-Type': type }), body });
  return r.status;
};
const del = (s, b, path) => fetch(`${URL_}/storage/v1/object/${b}/${path}`, { method: 'DELETE', headers: hdr(s.tok) }).then((r) => r.status);

async function direction(owner, other) {
  console.log(`\n--- ${owner.k} sahip, ${other.k} yetkisiz ---`);
  for (const b of BUCKETS) {
    let path = null;
    for (const [type, ext, body] of TYPES) {
      const p = `${owner.company}/__izolasyon_testi__/${runId}-${b}.${ext}`;
      const st = await upload(owner, b, p, type, body);
      if (st === 200) { path = p; created.push({ s: owner, b, p }); check(`${owner.k} kendi klasorune yukler: ${b}`, true, `${type}`); break; }
    }
    if (!path) { check(`${owner.k} kendi klasorune yukler: ${b}`, false, 'png/pdf/txt hicbiri kabul edilmedi (mime/boyut kisiti olabilir, INCELE)'); continue; }

    const own = await sign(b, path, owner.tok);
    check(`${owner.k} kendi dosyasi icin imzali URL alir: ${b}`, own.status === 200, `HTTP ${own.status}`);
    if (own.url) { const d = await fetch(own.url); check(`${owner.k} kendi dosyasini indirir: ${b}`, d.status === 200, `HTTP ${d.status}`); }
    const ownList = await list(b, `${owner.company}/__izolasyon_testi__`, owner.tok);
    check(`${owner.k} kendi klasorunde dosyayi listeler: ${b}`, ownList.n >= 1, `HTTP ${ownList.status} n=${ownList.n}`);

    const xl = await list(b, `${owner.company}/__izolasyon_testi__`, other.tok);
    check(`${other.k}, ${owner.k} klasorunu GOREMEZ (liste): ${b}`, xl.n === 0, `HTTP ${xl.status} n=${xl.n}`);
    const xs = await sign(b, path, other.tok);
    check(`${other.k}, ${owner.k} dosyasi icin imzali URL ALAMAZ: ${b}`, xs.status >= 400, `HTTP ${xs.status}`);
    const xg = await fetch(`${URL_}/storage/v1/object/authenticated/${b}/${path}`, { headers: hdr(other.tok) });
    check(`${other.k}, ${owner.k} dosyasini dogrudan INDIREMEZ: ${b}`, xg.status >= 400, `HTTP ${xg.status}`);
    const xu = await upload(other, b, `${owner.company}/__izolasyon_testi__/${runId}-capraz-${b}.txt`, 'text/plain', Buffer.from('x'));
    if (xu === 200) created.push({ s: owner, b, p: `${owner.company}/__izolasyon_testi__/${runId}-capraz-${b}.txt` });
    check(`${other.k}, ${owner.k} klasorune YUKLEYEMEZ: ${b}`, xu >= 400, `HTTP ${xu}`);
    await del(other, b, path);
    const still = await sign(b, path, owner.tok);
    check(`${other.k} silmeyi denese de ${owner.k} dosyasi duruyor: ${b}`, still.status === 200, `HTTP ${still.status}`);
  }
}

try {
  await direction(sessions[0], sessions[1]);
  await direction(sessions[1], sessions[0]);
} finally {
  let temiz = 0;
  for (const { s, b, p } of created) { const st = await del(s, b, p); if (st === 200) temiz++; }
  console.log(`\nTemizlik: testin olusturdugu ${created.length} nesneden ${temiz} tanesi silindi.`);
}

console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nHEPSI GECTI (anon + iki firma karsilikli)');
process.exit(fail ? 1 : 0);
