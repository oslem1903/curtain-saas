// node tests/billing/callback.integration.mjs   (once: npm i --no-save @electric-sql/pglite)
// paytr-callback ve billing-checkout fonksiyonlarini GERCEK kaynak kodlariyla, PGlite uzerindeki migration
// 033+034 ile calistirir. PayTR agi ve Supabase istemcisi sahte; PayTR sandbox/canli testi DEGILDIR.
import { PGlite } from '@electric-sql/pglite';
import { transformSync } from 'esbuild';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const KEY = 'test-key', SALT = 'test-salt';
let fail = 0;
const ok = (c, m) => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };

const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create table public.companies(id uuid primary key default gen_random_uuid(), name text, is_active boolean default true, plan_status text, subscription_status text, trial_ends_at timestamptz, license_expires_at timestamptz, package_code text, subscription_plan text, enabled_modules text[], updated_at timestamptz, created_at timestamptz default now());
create function public.is_super_admin() returns boolean language sql as $$ select false $$;
create function public.is_company_admin(c uuid) returns boolean language sql as $$ select true $$;`);
for (const f of ['supabase_migration_033_solo_billing_modules.sql', 'supabase_migration_034_solo_plans.sql', 'supabase_migration_035_billing_event_keys.sql', 'supabase_migration_036_test_company_checkout.sql']) {
  await db.exec(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}
const rows = async (s, p) => (await db.query(s, p)).rows;

// Sahte supabase istemcisi: yalniz kullanilan rpc'ler
const RPC = {
  billing_get_intent: (a) => rows('select * from billing_get_intent($1)', [a.p_intent_id]),
  billing_record_failure: async (a) => (await rows('select billing_record_failure($1,$2,$3,$4) r', [a.p_channel, a.p_event_id, a.p_company_id, a.p_reason]))[0].r,
  billing_mark_intent: (a) => rows('select billing_mark_intent($1,$2)', [a.p_intent_id, a.p_status]),
  billing_apply_charge: async (a) =>
    (await rows('select billing_apply_charge($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) r', [a.p_channel, a.p_event_id, a.p_company_id, a.p_plan_code,
      a.p_provider_payment_id, a.p_amount_minor, a.p_currency, a.p_provider_subscription_ref, JSON.stringify(a.p_payload ?? {}), a.p_test_mode ?? false]))[0].r,
};
const createClient = () => ({
  rpc: async (name, args) => {
    try { return { data: await RPC[name](args), error: null }; } catch (e) { return { data: null, error: { message: e.message } }; }
  },
});

function loadHandler(file, env) {
  let src = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/^import .*createClient.*$/m, '');
  src = transformSync(src, { loader: 'ts', format: 'esm' }).code.replace(/^export /gm, '');
  let handler;
  const Deno = { env: { get: (k) => env[k] }, serve: (fn) => { handler = fn; } };
  new Function('Deno', 'createClient', src)(Deno, createClient);
  return handler;
}
const cb = loadHandler('supabase/functions/paytr-callback/index.ts',
  { SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x', PAYTR_MERCHANT_KEY: KEY, PAYTR_MERCHANT_SALT: SALT });

const hash = (oid, status, total) => createHmac('sha256', KEY).update(oid + SALT + status + total).digest('base64');
const post = async (fields) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const r = await cb(new Request('http://localhost/paytr-callback', { method: 'POST', body: fd }));
  return { status: r.status, body: await r.text() };
};

// Kurulum: firma + plan acik + niyet
const [{ id: company }] = await rows(`insert into companies(name,plan_status,trial_ends_at,package_code,subscription_plan) values('QA Solo','trial', now()+interval '3 days','solo','trial') returning id`);
await db.exec(`update billing_plans set is_purchasable=true where code='solo_monthly'`);
const intent = (await rows(`select billing_create_intent('paytr',$1,'solo_yearly',null) r`, [company]).catch(() => null));
ok(intent === null, 'yearly plan kapaliyken niyet olusturulamaz');
const [{ id: tco }] = await rows(`insert into companies(name,plan_status,trial_ends_at,package_code) values('QA Test Co','trial', now()+interval '3 days','solo') returning id`);
await db.exec(`insert into billing_test_companies(company_id) values ('${tco}')`);
const tint = (await rows(`select billing_create_intent('paytr',$1,'solo_yearly',null) r`, [tco]))[0].r;
ok(tint.amount_minor === 499000, 'test firmasi kapali planda niyet olusturabilir (yillik 499000 kurus)');
const { r: it } = (await rows(`select billing_create_intent('paytr',$1,'solo_monthly',null) r`, [company]))[0];
const oid = 'PRD' + it.intent_id.replace(/-/g, '');
const amount = String(it.amount_minor);
ok(amount === '49900', 'tutar sunucudan: 49900 kurus (499 TL)');

let r = await post({ merchant_oid: oid, status: 'success', total_amount: amount, hash: 'bozuk', currency: 'TL' });
ok(r.status === 400 && r.body !== 'OK', 'gecersiz hash: islem yok, OK donmez');
r = await post({ merchant_oid: oid, status: 'success', total_amount: '100', hash: hash(oid, 'success', '100'), currency: 'TL' });
ok(r.body === 'OK', 'yanlis tutar (hash gecerli): OK doner (tekrar denenmesin) ...');
let co = (await rows('select plan_status from companies where id=$1', [company]))[0];
ok(co.plan_status === 'trial', '... ama lisans ACILMAZ');
r = await post({ merchant_oid: oid, status: 'failed', total_amount: amount, hash: hash(oid, 'failed', amount), currency: 'TL', failed_reason_msg: 'x' });
co = (await rows('select plan_status from companies where id=$1', [company]))[0];
ok(r.body === 'OK' && co.plan_status === 'trial', 'basarisiz odeme kaydedilir, lisans acilmaz');
r = await post({ merchant_oid: oid, status: 'success', total_amount: amount, hash: hash(oid, 'success', amount), currency: 'TL', test_mode: '1' });
co = (await rows('select plan_status from companies where id=$1', [company]))[0];
ok(r.body === 'OK' && co.plan_status === 'trial', 'TEST modu odemesi gercek firmanin lisansini acmaz');
// intent 'failed' oldugu icin yeniden isaretlenebilir; gercek basarili odeme
r = await post({ merchant_oid: oid, status: 'success', total_amount: amount, hash: hash(oid, 'success', amount), currency: 'TL', test_mode: '0' });
co = (await rows('select plan_status, license_expires_at > now()+interval \'30 days\' as longer from companies where id=$1', [company]))[0];
ok(r.body === 'OK' && co.plan_status === 'active' && co.longer, 'dogrulanmis basarili odeme: lisans acildi, kalan deneme korundu');
const end1 = (await rows('select license_expires_at e from companies where id=$1', [company]))[0].e;
r = await post({ merchant_oid: oid, status: 'success', total_amount: amount, hash: hash(oid, 'success', amount), currency: 'TL', test_mode: '0' });
const end2 = (await rows('select license_expires_at e from companies where id=$1', [company]))[0].e;
ok(r.body === 'OK' && +end1 === +end2, 'yinelenen callback sureyi ikinci kez uzatmaz');
const pays = await rows('select count(*)::int n from billing_payments where company_id=$1', [company]);
ok(pays[0].n === 1, 'tek odeme kaydi');
r = await post({ merchant_oid: 'MTR' + 'a'.repeat(32), status: 'success', total_amount: '100', hash: hash('MTR' + 'a'.repeat(32), 'success', '100') });
ok(r.body === 'OK', 'baska urunun (MTR) siparisi: dokunmadan OK');

console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nTUM KONTROLLER GECTI');
process.exit(fail ? 1 : 0);
