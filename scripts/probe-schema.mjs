import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import { loadQaAccounts } from './lib/qaAccounts.mjs';
const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).replace(/^"|"$/g,'')]}));
const sb = createClient(env.VITE_SUPABASE_URI, env.VITE_SUPABASE_ANON_KEY);
const a = loadQaAccounts({ requireBoth: false }).accounts.A;
const { error } = await sb.auth.signInWithPassword({ email: a.email, password: a.password });
if (error) { console.log('login', error.message); process.exit(1); }
const m = await sb.from('orders').select('installation_mode').limit(1);
console.log('installation_mode:', m.error ? 'YOK -> ' + m.error.message : 'VAR');
const o = await sb.from('orders').select('*').limit(1);
console.log('orders kolonlari:', o.data?.[0] ? Object.keys(o.data[0]).join(',') : o.error?.message ?? '(satir yok)');
for (const t of ['installation_jobs','installer_earnings','installer_transactions','supplier_transactions']) {
  const r = await sb.from(t).select('*', { count: 'exact', head: false }).limit(1);
  console.log(t, r.error ? r.error.message : `count=${r.count ?? '?'} kolonlar=${r.data?.[0] ? Object.keys(r.data[0]).join(',') : '-'}`);
}
const { data: u } = await sb.auth.getUser();
const mm = await sb.from('company_members').select('role,is_active,company_id').eq('user_id', u.user.id);
console.log('uyelik:', JSON.stringify(mm.data), mm.error?.message ?? '');
const pr = await sb.from('profiles').select('role').eq('id', u.user.id);
console.log('profil rol:', JSON.stringify(pr.data), pr.error?.message ?? '');
