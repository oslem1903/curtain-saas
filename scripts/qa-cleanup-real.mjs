// Yalnizca "QA-REAL" adli (qa-real-records.mjs'in olusturdugu) kayitlari siler; hata ciktisini gosterir.
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import { loadQaAccounts } from './lib/qaAccounts.mjs';
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).replace(/^"|"$/g,'')]}));
const sb = createClient(env.VITE_SUPABASE_URI, env.VITE_SUPABASE_ANON_KEY);
const a = loadQaAccounts({ requireBoth: false }).accounts.A;
await sb.auth.signInWithPassword({ email: a.email, password: a.password });
const log = (n, r) => console.log(n, r.error ? 'HATA ' + r.error.message : Array.isArray(r.data) ? (r.data.length ? `${r.data.length} satir silindi` : 'UYARI 0 satir etkilendi (RLS DELETE politikasi yok/engelledi)') : 'ok');
const { data: custs } = await sb.from('customers').select('id,name').like('name', 'QA-REAL%');
const cids = (custs || []).map((c) => c.id);
const { data: ords } = cids.length ? await sb.from('orders').select('id').in('customer_id', cids) : { data: [] };
const oids = (ords || []).map((o) => o.id);
const { data: jobs } = oids.length ? await sb.from('installation_jobs').select('id,assigned_staff_id').in('order_id', oids) : { data: [] };
const staff = [...new Set((jobs || []).map((j) => j.assigned_staff_id).filter(Boolean))];
console.log({ musteri: cids.length, siparis: oids.length, is: (jobs || []).length, montajci: staff.length });
if (oids.length) {
  log('installer_earnings(order)', await sb.from('installer_earnings').delete().in('order_id', oids).select('id'));
  log('installation_jobs', await sb.from('installation_jobs').delete().in('order_id', oids).select('id'));
  log('payments', await sb.from('payments').delete().in('order_id', oids).select('id'));
  log('income', await sb.from('income').delete().in('order_id', oids).select('id'));
  log('order_items', await sb.from('order_items').delete().in('order_id', oids).select('id'));
  log('orders', await sb.from('orders').delete().in('id', oids).select('id'));
}
if (staff.length) {
  log('installer_transactions', await sb.from('installer_transactions').delete().in('installer_id', staff).select('id'));
  log('installer_earnings(installer)', await sb.from('installer_earnings').delete().in('installer_id', staff).select('id'));
  log('employees', await sb.from('employees').delete().in('id', staff).select('id'));
}
if (cids.length) {
  log('appointments', await sb.from('appointments').delete().in('customer_id', cids).select('id'));
  log('customers', await sb.from('customers').delete().in('id', cids).select('id'));
}
const { data: sups } = await sb.from('suppliers').select('id').like('name', 'QA-REAL%');
const sids = (sups || []).map((s) => s.id);
if (sids.length) {
  log('supplier_transactions', await sb.from('supplier_transactions').delete().in('supplier_id', sids).select('id'));
  log('suppliers', await sb.from('suppliers').delete().in('id', sids).select('id'));
}
// income satirlari silinemez (deftere bagli) -> kalan QA siparislerini IPTAL yap (Tahsilat listelerine girmez)
if (oids.length) {
  log('orders -> cancelled', await sb.from('orders').update({ status: 'cancelled' }).in('id', oids));
}
