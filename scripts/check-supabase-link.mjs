// =============================================================================
// Supabase CLI bağlantı güvenlik kontrolü.
//
// NEDEN VAR: 14.09.2026'da tespit edildi — uygulama `ffhmzlcsgsgjonqqhgqq`
// projesine bağlanırken Supabase CLI BAŞKA bir projeye (`egvclvmsmyvbqfuzchvz`,
// farklı bir organizasyona ait) linkliydi. Bu durumda `supabase db push` /
// `supabase migration up` komutları YANLIŞ VERİTABANINA yazar.
//
// Bu betik, .env dosyasındaki proje ref'i ile supabase/.temp/ altındaki CLI link
// bilgisini karşılaştırır ve uyuşmazlıkta sıfırdan farklı çıkış kodu döner.
//
// Kullanım:
//   node scripts/check-supabase-link.mjs
//   npm run check:link
//
// Çıkış kodları: 0 = güvenli, 1 = UYUŞMAZLIK (migration çalıştırmayın)
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => {
  try { return fs.readFileSync(path.join(root, p), 'utf8'); } catch { return null; }
};

function refFromUrl(url) {
  const m = /https?:\/\/([a-z0-9]+)\.supabase\.co/i.exec(url || '');
  return m ? m[1] : null;
}

// --- 1) Uygulamanın bağlandığı proje (.env.local > .env) -------------------
let appRef = null;
let appSource = null;
for (const file of ['.env.local', '.env', '.env.production']) {
  const raw = read(file);
  if (!raw) continue;
  const vars = {};
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const [k, ...rest] = t.split('=');
    vars[k.trim()] = rest.join('=').trim().replace(/^["']|["']$/g, '');
  }
  const url = vars.VITE_SUPABASE_URL || vars.VITE_SUPABASE_URI || vars.SUPABASE_URL;
  const ref = refFromUrl(url);
  if (ref) { appRef = ref; appSource = file; break; }
}

// --- 2) CLI'nin linkli olduğu proje (üç ayrı kaynak) -----------------------
const cliRef = (read('supabase/.temp/project-ref') || '').trim() || null;

let linkedRef = null;
let linkedName = null;
const linkedRaw = read('supabase/.temp/linked-project.json');
if (linkedRaw) {
  try {
    const j = JSON.parse(linkedRaw);
    linkedRef = j.ref || null;
    linkedName = j.name || null;
  } catch { /* bozuk json */ }
}

const poolerRaw = read('supabase/.temp/pooler-url') || '';
const poolerMatch = /postgres\.([a-z0-9]{16,})/i.exec(poolerRaw);
const poolerRef = poolerMatch ? poolerMatch[1] : null;

// --- 3) Rapor --------------------------------------------------------------
console.log('Supabase baglanti kontrolu');
console.log('-'.repeat(60));
console.log(`Uygulama (${appSource || 'env bulunamadi'})   : ${appRef || '(cozulemedi)'}`);
console.log(`CLI .temp/project-ref              : ${cliRef || '(yok)'}`);
console.log(`CLI linked-project.json            : ${linkedRef || '(yok)'}${linkedName ? `  ("${linkedName}")` : ''}`);
console.log(`CLI pooler-url icindeki ref        : ${poolerRef || '(yok)'}`);
console.log('-'.repeat(60));

if (!appRef) {
  console.log('UYARI  .env dosyasindan proje ref cozulemedi. Kontrol yapilamadi.');
  process.exit(1);
}

const cliRefs = [cliRef, linkedRef, poolerRef].filter(Boolean);

if (cliRefs.length === 0) {
  console.log('OK  CLI hicbir projeye linkli degil — yanlis veritabanina yazma riski YOK.');
  console.log(`    Link kurmak icin: supabase link --project-ref ${appRef}`);
  process.exit(0);
}

const mismatched = [...new Set(cliRefs.filter((r) => r !== appRef))];

if (mismatched.length > 0) {
  console.log('HATA  CLI linki uygulamanin projesiyle UYUSMUYOR.');
  console.log(`      Beklenen : ${appRef}`);
  console.log(`      Bulunan  : ${mismatched.join(', ')}`);
  console.log('');
  console.log('      Bu haldeyken `supabase db push` / `supabase migration up`');
  console.log('      YANLIS VERITABANINA yazar. Migration/SQL CALISTIRMAYIN.');
  console.log('');
  console.log(`      Duzeltme: supabase link --project-ref ${appRef}`);
  console.log('      (.temp dosyalarini ELLE duzenlemeyin — pooler-url eski projede kalir.)');
  process.exit(1);
}

console.log(`OK  CLI dogru projeye linkli: ${appRef}`);
console.log('    Migration/SQL calistirmak bu acidan guvenli.');
process.exit(0);
