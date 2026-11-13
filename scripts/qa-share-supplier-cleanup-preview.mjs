// SALT OKUNUR önizleme: Test Company 1'deki "QA-SHARE%" tedarikçileri ve bağlı kayıtları. Hiçbir şey silmez/değiştirmez.
//   node scripts/qa-share-supplier-cleanup-preview.mjs [temelUrl] > cikti.md
import { chromium } from '@playwright/test';
import { loadQaAccounts } from './lib/qaAccounts.mjs';
const BASE = (process.argv[2] || 'http://localhost:5199').replace(/\/$/, '');
const A = loadQaAccounts({ requireBoth: false }).accounts.A;
const b = await chromium.launch({ channel: process.env.QA_BROWSER_CHANNEL || undefined });
const c = await b.newContext();
await c.addInitScript((id) => localStorage.setItem('curtain_saas_device_id', id), A.deviceId);
const p = await c.newPage();
await p.goto(`${BASE}/#/login`);
await p.locator('input[type="email"]').first().fill(A.email);
await p.locator('input[type="password"]').first().fill(A.password);
await p.locator('form button[type="submit"]').first().click();
await p.waitForURL(/#\/(dashboard|app\/dashboard|field)/, { timeout: 60000 });
const r = await p.evaluate(async () => {
  const sb = window.supabase;
  const { data: sups, error } = await sb.from('suppliers').select('id,name,phone,company_id,created_at').like('name', 'QA-SHARE%').order('created_at');
  if (error) return { error: error.message };
  const ids = sups.map((s) => s.id);
  const linked = {};
  for (const [table, col] of [['supplier_transactions', 'supplier_id'], ['supplier_product_prices', 'supplier_id'], ['order_items', 'supplier_id'], ['appointments', 'supplier_id'], ['expenses', 'supplier_id']]) {
    const res = await sb.from(table).select(`id,${col}`).in(col, ids);
    linked[table] = res.error ? { error: res.error.message } : Object.fromEntries(ids.map((i) => [i, res.data.filter((x) => x[col] === i).length]));
  }
  const names = [...new Set(sups.map((s) => s.name))];
  return { sups, linked, ids };
});
if (r.error) { console.log('HATA', r.error); process.exit(1); }
const nz = (t, id) => (r.linked[t]?.error ? '?' : r.linked[t][id]);
const comps = [...new Set(r.sups.map((s) => s.company_id))];
console.log(`# QA-SHARE tedarikçi temizlik ÖNİZLEMESİ (salt okunur — hiçbir kayıt silinmedi)\n`);
console.log(`Firma(lar): ${comps.join(', ')}  ·  Toplam tedarikçi: ${r.sups.length}\n`);
console.log('| # | ID | Ad | Telefon | supplier_transactions | supplier_product_prices | order_items | appointments | expenses');
console.log('|---|----|----|---------|----|----|----|----|----|----|');
r.sups.forEach((s, i) => console.log(`| ${i + 1} | ${s.id} | ${s.name} | ${s.phone ?? '—'} | ${nz('supplier_transactions', s.id)} | ${nz('supplier_product_prices', s.id)} | ${nz('order_items', s.id)} | ${nz('appointments', s.id)} | ${nz('expenses', s.id)} |`));
const sum = (t) => r.linked[t]?.error ? `? (${r.linked[t].error})` : Object.values(r.linked[t]).reduce((a, b) => a + b, 0);
console.log(`\n**Toplam bağlı kayıt:** supplier_transactions=${sum('supplier_transactions')}, supplier_product_prices=${sum('supplier_product_prices')}, order_items=${sum('order_items')}, appointments=${sum('appointments')}, expenses=${sum('expenses')}\n`);
console.log('## Önerilen silme sırası (ONAYLANMADI, ÇALIŞTIRILMADI)\n');
console.log('```sql\n-- company_id = ' + comps[0] + '  (yalnız bu firma ve yalnız adı QA-SHARE ile başlayanlar)\nBEGIN;\nDELETE FROM supplier_transactions WHERE supplier_id IN (SELECT id FROM suppliers WHERE company_id = \'' + comps[0] + '\' AND name LIKE \'QA-SHARE%\');\nDELETE FROM supplier_product_prices WHERE supplier_id IN (SELECT id FROM suppliers WHERE company_id = \'' + comps[0] + '\' AND name LIKE \'QA-SHARE%\');\n-- order_items / appointments / expenses / products satırları varsa önce NULL\'a çekilmeli ya da silinmeli (yukarıdaki sayılara bakın)\nDELETE FROM suppliers WHERE company_id = \'' + comps[0] + '\' AND name LIKE \'QA-SHARE%\';\n-- beklenen silinen satır: ' + r.sups.length + '\nROLLBACK; -- onay sonrası COMMIT ile değiştirilecek\n```');
await b.close();
