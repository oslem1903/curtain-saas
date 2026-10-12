// Storage firma izolasyonu dogrulama (canli proje, .env.local'deki Supabase).
//
//   node scripts/verify-storage-isolation.mjs
//     -> yalnizca ANON kontrolleri (anahtar/oturum gerektirmez)
//
//   A_TOKEN=<A firmasi kullanicisinin access_token'i> A_COMPANY=<A firma uuid> \
//   B_COMPANY=<B firma uuid> node scripts/verify-storage-isolation.mjs
//     -> ayrica A kullanicisi: kendi klasorunu listeler/yukler/siler (GECMELI),
//        B firmasinin klasorunu listeler/imzali URL alir/yukler (ENGELLENMELI)
//
// Token'lar yalnizca ortam degiskeninden okunur, hicbir yere yazilmaz/yazdirilmaz.
// Yukleme testi "<A_COMPANY>/__izolasyon_testi__/" altina tek bir 1 baytlik
// dosya yazar ve ayni calistirmada siler.
import fs from 'node:fs';

const BUCKETS = ['appointment-photos', 'catalog-images', 'catalog-pdfs', 'logos',
  'measurement-photos', 'support-attachments', 'visual-previews'];

const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)
  .filter((l) => l.includes('=') && !l.startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const URL_ = env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URI;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const REF = 'ffhmzlcsgsgjonqqhgqq';
if (!new URL(URL_).host.startsWith(REF + '.')) { console.error('YANLIS PROJE: .env.local ' + REF + ' degil'); process.exit(2); }

let fail = 0;
const check = (ad, ok, detay = '') => { if (!ok) fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${ad}${detay ? '  -> ' + detay : ''}`); };
const hdr = (tok) => ({ apikey: ANON, Authorization: 'Bearer ' + (tok || ANON), 'Content-Type': 'application/json' });
const list = async (b, prefix, tok) => {
  const r = await fetch(`${URL_}/storage/v1/object/list/${b}`, { method: 'POST', headers: hdr(tok), body: JSON.stringify({ prefix, limit: 5 }) });
  const j = await r.json().catch(() => null);
  return { status: r.status, n: Array.isArray(j) ? j.length : -1 };
};

console.log('--- ANON ---');
for (const b of BUCKETS) {
  const l = await list(b, '');
  check(`anon listeleme bos: ${b}`, l.n === 0, `HTTP ${l.status} n=${l.n}`);
  const g = await fetch(`${URL_}/storage/v1/object/public/${b}/x.png`);
  check(`anon public indirme 4xx: ${b}`, g.status >= 400, `HTTP ${g.status}`);
}

const { A_TOKEN, A_COMPANY, B_COMPANY } = process.env;
if (A_TOKEN && A_COMPANY && B_COMPANY) {
  console.log('--- A KULLANICISI ---');
  const probe = `${A_COMPANY}/__izolasyon_testi__/${Date.now()}.txt`;
  for (const b of BUCKETS) {
    const own = await list(b, A_COMPANY, A_TOKEN);
    check(`A kendi klasorunu listeler: ${b}`, own.status === 200, `HTTP ${own.status} n=${own.n}`);
    const other = await list(b, B_COMPANY, A_TOKEN);
    check(`A, B klasorunu GOREMEZ: ${b}`, other.n === 0, `HTTP ${other.status} n=${other.n}`);
    const up = await fetch(`${URL_}/storage/v1/object/${b}/${probe}`, { method: 'POST', headers: { ...hdr(A_TOKEN), 'Content-Type': 'text/plain' }, body: 'x' });
    check(`A kendi klasorune yukler: ${b}`, up.status === 200, `HTTP ${up.status}`);
    if (up.status === 200) {
      const sg = await fetch(`${URL_}/storage/v1/object/sign/${b}/${probe}`, { method: 'POST', headers: hdr(A_TOKEN), body: JSON.stringify({ expiresIn: 60 }) });
      check(`A kendi dosyasi icin imzali URL alir: ${b}`, sg.status === 200, `HTTP ${sg.status}`);
      const del = await fetch(`${URL_}/storage/v1/object/${b}/${probe}`, { method: 'DELETE', headers: hdr(A_TOKEN) });
      check(`A test dosyasini siler: ${b}`, del.status === 200, `HTTP ${del.status}`);
    }
    const upB = await fetch(`${URL_}/storage/v1/object/${b}/${B_COMPANY}/__izolasyon_testi__/${Date.now()}.txt`, { method: 'POST', headers: { ...hdr(A_TOKEN), 'Content-Type': 'text/plain' }, body: 'x' });
    check(`A, B klasorune YUKLEYEMEZ: ${b}`, upB.status >= 400, `HTTP ${upB.status}`);
    const sgB = await fetch(`${URL_}/storage/v1/object/sign/${b}/${B_COMPANY}/x.png`, { method: 'POST', headers: hdr(A_TOKEN), body: JSON.stringify({ expiresIn: 60 }) });
    check(`A, B dosyasi icin imzali URL ALAMAZ: ${b}`, sgB.status >= 400, `HTTP ${sgB.status}`);
  }
} else {
  console.log('(A_TOKEN / A_COMPANY / B_COMPANY verilmedi: yetkili-kullanici kontrolleri atlandi)');
}

console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nHEPSI GECTI');
process.exit(fail ? 1 : 0);
