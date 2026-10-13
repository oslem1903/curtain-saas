// Repodaki SQL dosyalarindan fonksiyon GOVDELERININ normalize md5 ozetini cikarir.
// Canli veritabanindaki ozetle (supabase_migration_029_live_diff_readonly.sql) karsilastirmak icindir.
//
//   node scripts/function-body-hashes.mjs [--show] [fonksiyon_adi ...]
//   --show: ozetin yanina normalize govde metnini de yazar (surumler arasi fark okumak icin).
//
// Normalizasyon canli sorguyla birebir ayni: bosluk dizileri tek bosluga, bas/son kirpilir
// (PostgreSQL: btrim(regexp_replace(prosrc, '\s+', ' ', 'g'))). Govde = $tag$ ... $tag$ arasi.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DEFAULT = ['is_company_writable', 'check_subscription_active', 'company_subscription_allows_write',
  'company_subscription_access_allowed', 'company_subscription_access_snapshot', 'register_device_and_touch_login'];
const SHOW = process.argv.includes('--show');
const args = process.argv.slice(2).filter((a) => a !== '--show');
const names = args.length ? args : DEFAULT;

const files = [];
for (const dir of ['.', 'supabase/migrations']) {
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir)) if (f.endsWith('.sql')) files.push(path.join(dir, f));
}
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const rows = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z_0-9]+)\s*\(/gi;
  let m;
  while ((m = re.exec(text))) {
    const name = m[1].toLowerCase();
    if (!names.includes(name)) continue;
    const rest = text.slice(m.index);
    const open = /\bAS\s+(\$[A-Za-z_0-9]*\$)/i.exec(rest);
    if (!open) continue;
    const tag = open[1];
    const bodyStart = open.index + open[0].length;
    const end = rest.indexOf(tag, bodyStart);
    if (end < 0) continue;
    const body = norm(rest.slice(bodyStart, end));
    const line = text.slice(0, m.index).split('\n').length;
    rows.push({ body, name, file: file.replace(/^\.[\\/]/, ''), line, len: body.length, md5: crypto.createHash('md5').update(body, 'utf8').digest('hex') });
  }
}
rows.sort((a, b) => a.name.localeCompare(b.name) || a.file.localeCompare(b.file));
for (const r of rows) {
  console.log(`${r.name.padEnd(36)} ${r.md5}  len=${String(r.len).padEnd(5)} ${r.file}:${r.line}`);
  if (SHOW) console.log(`    ${r.body}
`);
}
