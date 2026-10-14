import { chromium } from '@playwright/test';
import { loadQaAccounts } from './lib/qaAccounts.mjs';
const acc = loadQaAccounts({ requireBoth: false }).accounts.A;
const BASE = 'http://localhost:5199';
const b = await chromium.launch(); const ctx = await b.newContext();
await ctx.addInitScript((id) => localStorage.setItem('curtain_saas_device_id', id), acc.deviceId);
const p = await ctx.newPage();
p.on('console', (m) => { if (/Auth|read|salt/i.test(m.text())) console.log('console:', m.text().slice(0, 150)); });
let rpcCalls = 0;
await p.route('**/rpc/company_subscription_access_allowed*', (r) => { rpcCalls++; r.fulfill({ status: 200, contentType: 'application/json', body: 'false' }); });
await p.goto(`${BASE}/#/login`);
await p.locator('input[type="email"]').first().fill(acc.email);
await p.locator('input[type="password"]').first().fill(acc.password);
await p.getByRole('button', { name: /^Giriş Yap$/ }).click();
await p.waitForTimeout(10000);
await p.goto(`${BASE}/#/suppliers`);
await p.waitForTimeout(6000);
const r = await p.evaluate(async () => {
  const m = await import('/src/supabaseClient.ts');
  // zararsiz yazma denemesi: var olmayan id'li satir silme
  const del = await window.supabase.from('supplier_transactions').delete().eq('id', '00000000-0000-0000-0000-000000000000').select('id');
  return { appReadOnly: m.isAppReadOnly(), delCode: del.error?.code ?? null, delStatus: del.status };
});
console.log(JSON.stringify(r), 'rpcCalls', rpcCalls, 'banner', /Read-only mod aktif/i.test(await p.locator('body').innerText()));
await b.close();
