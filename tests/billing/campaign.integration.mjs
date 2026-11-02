// node tests/billing/campaign.integration.mjs   (once: npm i --no-save @electric-sql/pglite)
// Lansman kampanyasi (migration 039): GERCEK migration 033-036+039 ve GERCEK billing-checkout / paytr-callback
// kaynak kodlari PGlite uzerinde calisir. PayTR agi ve Supabase istemcisi sahte; gercek tahsilat YOKTUR.
// Not: PGlite tek baglantidir; gercek paralel islem testi icin tests/billing/campaign.concurrency.mjs.
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
create table public.companies(id uuid primary key default gen_random_uuid(), name text, is_active boolean default true, plan_status text, subscription_status text, trial_ends_at timestamptz, license_expires_at timestamptz, package_code text, subscription_plan text, enabled_modules text[], updated_at timestamptz, created_at timestamptz default now(), is_pilot boolean default false, pilot_until timestamptz);
create function public.is_super_admin() returns boolean language sql as $$ select coalesce(current_setting('test.super', true),'')='1' $$;
create function public.is_company_admin(c uuid) returns boolean language sql as $$ select coalesce(current_setting('test.admin_of', true),'')=c::text $$;`);
for (const f of ['supabase_migration_033_solo_billing_modules.sql', 'supabase_migration_034_solo_plans.sql', 'supabase_migration_035_billing_event_keys.sql',
  'supabase_migration_036_test_company_checkout.sql', 'supabase_migration_039_launch_campaign.sql', 'supabase_migration_040_all_plans_campaign.sql']) {
  await db.exec(fs.readFileSync(path.join(ROOT, f), 'utf8'));
}
await db.exec(`update billing_plans set is_purchasable=true`);
const rows = async (s, p) => (await db.query(s, p)).rows;
const one = async (s, p) => (await rows(s, p))[0];
const CAMP = 'launch_solo_yearly_50';
const mkCo = async (name = 'Co') => (await one(`insert into companies(name,plan_status,trial_ends_at,package_code,subscription_plan) values($1,'trial', now()+interval '3 days','solo','trial') returning id`, [name])).id;
const enable = (on) => db.exec(`update billing_campaigns set is_enabled=${on}`);

// ---- Sahte supabase istemcisi + gercek edge function kaynaklari ----
const RPC = {
  billing_get_intent: (a) => rows('select * from billing_get_intent($1)', [a.p_intent_id]),
  billing_record_failure: async (a) => (await one('select billing_record_failure($1,$2,$3,$4) r', [a.p_channel, a.p_event_id, a.p_company_id, a.p_reason])).r,
  billing_mark_intent: (a) => rows('select billing_mark_intent($1,$2)', [a.p_intent_id, a.p_status]),
  billing_set_intent_token: (a) => rows('select billing_set_intent_token($1,$2)', [a.p_intent_id, a.p_token]),
  billing_is_test_company: async (a) => (await one('select billing_is_test_company($1) r', [a.p_company_id])).r,
  billing_create_intent: async (a) => (await one('select billing_create_intent($1,$2,$3,$4,$5) r', [a.p_channel, a.p_company_id, a.p_plan_code, a.p_created_by ?? null, a.p_expected_amount_minor ?? null])).r,
  billing_apply_charge: async (a) =>
    (await one('select billing_apply_charge($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10) r', [a.p_channel, a.p_event_id, a.p_company_id, a.p_plan_code,
      a.p_provider_payment_id, a.p_amount_minor, a.p_currency, a.p_provider_subscription_ref, JSON.stringify(a.p_payload ?? {}), a.p_test_mode ?? false])).r,
};
const chain = (data) => { const c = { select: () => c, eq: () => c, maybeSingle: async () => ({ data }) }; return c; };
const createClient = (_u, key) => ({
  auth: { getUser: async () => ({ data: { user: { id: '11111111-1111-1111-1111-111111111111', email: 'a@b.com' } } }) },
  from: (t) => chain(t === 'company_members' ? { role: 'admin', is_active: true } : { name: 'Firma', phone: '0500', address: 'x', full_name: 'Ad' }),
  rpc: async (name, args) => { try { return { data: await RPC[name](args), error: null }; } catch (e) { return { data: null, error: { message: e.message } }; } },
});
function loadHandler(file, env, fetchImpl) {
  let src = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/^import .*createClient.*$/m, '');
  src = transformSync(src, { loader: 'ts', format: 'esm' }).code.replace(/^export /gm, '');
  let handler;
  const Deno = { env: { get: (k) => env[k] }, serve: (fn) => { handler = fn; } };
  new Function('Deno', 'createClient', 'fetch', src)(Deno, createClient, fetchImpl ?? fetch);
  return handler;
}
let paytrForm = null; // PayTR'ye giden son istek
const fakeFetch = async (_url, init) => { paytrForm = new URLSearchParams(init.body); return new Response(JSON.stringify({ status: 'success', token: 'tok' + Math.random().toString(36).slice(2) })); };
const checkout = loadHandler('supabase/functions/billing-checkout/index.ts', {
  BILLING_ENABLED: '1', SUPABASE_URL: 'x', SUPABASE_ANON_KEY: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x', PAYTR_MERCHANT_ID: '1', PAYTR_MERCHANT_KEY: KEY,
  PAYTR_MERCHANT_SALT: SALT, APP_PUBLIC_URL: 'https://app.test',
}, fakeFetch);
const cb = loadHandler('supabase/functions/paytr-callback/index.ts', { SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x', PAYTR_MERCHANT_KEY: KEY, PAYTR_MERCHANT_SALT: SALT });

const startCheckout = async (company, plan, expected) => {
  paytrForm = null;
  const r = await checkout(new Request('http://x/billing-checkout', { method: 'POST', headers: { Authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify({ company_id: company, plan_code: plan, accepted_terms: true, ...(expected === undefined ? {} : { expected_amount_minor: expected }) }) }));
  return { status: r.status, body: await r.json(), paytr: paytrForm };
};
const hash = (oid, status, total) => createHmac('sha256', KEY).update(oid + SALT + status + total).digest('base64');
// METRAJ_REPO=<oslem1903/metraj360 klasoru> ise TUM callback'ler PayTR -> Metraj360 paytr-callback (GERCEK kaynak, hash dogrulama +
// PRD yonlendirme) -> PerdePRO paytr-callback zincirinden gecer; Metraj'in OK/502 karari aynen kullanilir.
const PERDEPRO_CB_URL = 'https://abcdefghijklmnopqrst.supabase.co/functions/v1/paytr-callback';
let viaChain = null;
if (process.env.METRAJ_REPO) {
  let msrc = fs.readFileSync(path.join(process.env.METRAJ_REPO, 'supabase/functions/paytr-callback/index.ts'), 'utf8').replace(/^import .*$/gm, '');
  msrc = transformSync(msrc, { loader: 'ts', format: 'esm' }).code;
  let mh;
  const verify = async (p, k, s) => createHmac('sha256', k).update(p.merchant_oid + s + p.status + p.total_amount).digest('base64') === p.hash;
  const chainFetch = async (url, init) => {
    if (String(url) !== PERDEPRO_CB_URL) throw new Error('beklenmeyen hedef ' + url);
    return cb(new Request(String(url), { method: 'POST', body: init.body }));
  };
  new Function('Deno', 'createClient', 'verifyPaytrCallbackHash', 'fetch', msrc)(
    { env: { get: (k) => ({ SUPABASE_URL: 'x', SUPABASE_SERVICE_ROLE_KEY: 'x', PAYTR_MERCHANT_KEY: KEY, PAYTR_MERCHANT_SALT: SALT, PERDEPRO_CALLBACK_URL: PERDEPRO_CB_URL })[k] }, serve: (f) => { mh = f; } },
    () => ({ rpc: async () => { throw new Error('Metraj RPC PRD icin calismamali'); } }), verify, chainFetch);
  viaChain = mh;
  console.log('--- CALLBACK ZINCIRI: PayTR -> Metraj360 -> PerdePRO ---');
}
const post = async (fields) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  const r = await (viaChain ?? cb)(new Request('http://localhost/paytr-callback', { method: 'POST', body: fd }));
  return { status: r.status, body: await r.text() };
};
const oidOf = (intentId) => 'PRD' + intentId.replace(/-/g, '');
const pay = (intentId, amount, extra = {}) => post({ merchant_oid: oidOf(intentId), status: 'success', total_amount: String(amount), hash: hash(oidOf(intentId), 'success', String(amount)), currency: 'TL', test_mode: '0', ...extra });
const payFail = (intentId, amount) => post({ merchant_oid: oidOf(intentId), status: 'failed', total_amount: String(amount), hash: hash(oidOf(intentId), 'failed', String(amount)), currency: 'TL', failed_reason_msg: 'x' });
const used = async () => (await one(`select billing_campaign_used($1) n`, [CAMP])).n;
const claim = (intentId) => one('select * from billing_campaign_claims where intent_id=$1', [intentId]);

// ===== Kampanya KAPALIYKEN (varsayilan) =====
let co1 = await mkCo('A');
let r = await startCheckout(co1, 'solo_yearly');
ok(r.status === 200 && r.paytr.get('payment_amount') === '499000', 'varsayilan (kampanya kapali): yillik 4.990 TL (499000 kurus)');
ok(JSON.stringify((await one(`select billing_campaign_public_status() s`)).s) === '{"active":false}', 'kampanya kapaliyken genel durum: active=false');

// ===== 1) Uygun isletme: yillik 2.495 TL, aylik 499 TL =====
await enable(true);
const coA = await mkCo('Uygun');
r = await startCheckout(coA, 'solo_yearly');
ok(r.status === 200 && r.paytr.get('payment_amount') === '249500', '1) uygun isletme yillik: PayTR\'ye giden tutar 249500 kurus (2.495 TL)');
const bk = JSON.parse(Buffer.from(r.paytr.get('user_basket'), 'base64').toString('utf8'));
ok(bk[0][1] === '2495.00' && /Lansman/.test(bk[0][0]), '1) sepet satiri 2495.00 ve kampanya adini tasir');
ok(r.paytr.get('timeout_limit') === '30', '1) PayTR timeout_limit = 30 dk (rezervasyon 45 dk ile uyumlu)');
const intentA = r.body.intent_id;
const cl = await claim(intentA);
ok(cl.status === 'reserved' && (new Date(cl.reserved_until) - Date.now()) > 44 * 60e3 && (new Date(cl.reserved_until) - Date.now()) <= 45 * 60e3,
  '1) rezervasyon 45 dk sureli (timeout 30 + tampon 15)');
r = await startCheckout(coA, 'solo_monthly');
ok(r.status === 200 && r.paytr.get('payment_amount') === '24950', '1) aylik paket: kampanyali ilk donem 249,50 TL (24950 kurus)');
const bkm = JSON.parse(Buffer.from(r.paytr.get('user_basket'), 'base64').toString('utf8'));
ok(bkm[0][1] === '249.50', '1) aylik sepet satiri 249.50');
const q = (await one(`select billing_campaign_quote($1,'solo_yearly') q`, [coA]).catch(() => null));
ok(q === null, '1) quote: oturumsuz/yetkisiz cagri reddedilir');
await db.exec(`select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false); select set_config('test.admin_of','${coA}',false);`);
const quote = (await one(`select billing_campaign_quote($1,'solo_yearly') q`, [coA])).q;
ok(quote.applied && quote.amount_minor === 249500 && quote.list_price_minor === 499000, '1) quote (firma yoneticisi): uygulanir, 249500 / 499000');
const other = await mkCo('Baska');
ok((await one(`select billing_campaign_quote($1,'solo_yearly') q`, [other]).catch(() => 'forbidden')) === 'forbidden', '1) quote: baska firmanin yoneticisi okuyamaz');
await db.exec(`select set_config('request.jwt.claim.sub','',false); select set_config('test.admin_of','',false);`);

// Istemci fiyati belirleyemez
r = await startCheckout(coA, 'solo_yearly', 1);
ok(r.status === 409 && r.body.error === 'price_changed', 'istemci tutari (1 kurus) fiyati belirlemez: sunucu 409 price_changed');
r = await startCheckout(coA, 'solo_yearly', 249500);
ok(r.status === 200 && r.paytr.get('payment_amount') === '249500', 'dogru beklenen tutarla ayni tutar');
const intentA2 = r.body.intent_id;
ok((await claim(intentA)).status === 'released' && (await one('select status from billing_intents where id=$1', [intentA])).status === 'expired',
  'ayni isletme yeniden baslatinca onceki rezervasyon devralinir (tek aktif rezervasyon)');

// ===== 5) Dogrulanmis odeme + tekrar =====
ok((await pay(intentA2, 100)).body === 'OK' && (await one('select plan_status p from companies where id=$1', [coA])).p === 'trial', 'yanlis tutarli bildirim lisans acmaz');
ok(await used() === 1, 'odeme oncesi: yalniz bekleyen rezervasyon sayilir (1)');
r = await pay(intentA2, 249500);
let c = await one('select plan_status p, license_expires_at e from companies where id=$1', [coA]);
ok(r.body === 'OK' && c.p === 'active', '5) dogrulanmis basarili odeme: lisans acildi');
const e1 = +c.e;
ok((await claim(intentA2)).status === 'consumed', '5) kontenjan yalniz dogrulanmis odemede KESINLESTI');
r = await pay(intentA2, 249500);
c = await one('select license_expires_at e from companies where id=$1', [coA]);
ok(r.body === 'OK' && +c.e === e1, '5) tekrarlanan callback lisans suresini ikinci kez uzatmaz');
ok(await used() === 1 && (await one('select count(*)::int n from billing_payments where company_id=$1', [coA])).n === 1, '5) tekrarlanan callback kontenjani/odeme kaydini ikinci kez islemez');
ok((await one('select amount_minor from billing_payments where company_id=$1', [coA])).amount_minor === 249500, '5) odeme kaydi 249500 kurus');

// ===== 2) Daha once yillik alan isletme yararlanamaz =====
r = await startCheckout(coA, 'solo_yearly');
ok(r.status === 200 && r.paytr.get('payment_amount') === '499000', '2) kampanyadan yararlanmis isletme: ikinci yillik alim 4.990 TL');
const coOld = await mkCo('EskiYillik');
const [oldInt] = await rows(`insert into billing_intents(company_id,plan_code,channel,amount_minor,currency,status) values($1,'solo_yearly','paytr',499000,'TRY','paid') returning id`, [coOld]);
r = await startCheckout(coOld, 'solo_yearly');
ok(r.paytr.get('payment_amount') === '499000', '2) kampanya oncesi yillik almis isletme de 4.990 TL');
const coMon = await mkCo('SadeceAylik');
await db.query(`insert into billing_intents(company_id,plan_code,channel,amount_minor,currency,status) values($1,'solo_monthly','paytr',49900,'TRY','paid')`, [coMon]);
r = await startCheckout(coMon, 'solo_yearly');
ok(r.paytr.get('payment_amount') === '499000', '2) onceki ucretli (aylik) alimi olan isletme kampanya disi: yillik 4.990 TL');
r = await startCheckout(coMon, 'solo_monthly');
ok(r.paytr.get('payment_amount') === '49900', '2) onceki ucretli alimi olan isletme: aylik de normal 499 TL');
// Sonraki donem: tuketilmis isletme icin bir daha asla
{
  const x = (await one(`select billing_campaign_eval($1,'solo_yearly') e`, [coA])).e;
  ok(x.applied === false && x.reason === 'already_purchased', '2) eval: aynisletme ikinci kez uygun degil (already_purchased)');
}

// ===== 4) Basarisiz / iptal / test / suresi dolan: kalici kontenjan tuketmez =====
const baseUsed = await used(); // coA consumed(1) + coMon reserved
const coF = await mkCo('Basarisiz');
r = await startCheckout(coF, 'solo_yearly');
const intF = r.body.intent_id;
ok(await used() === baseUsed + 1, '4) rezervasyon bekleyen odemeyi kontenjana dahil eder');
await payFail(intF, 249500);
ok((await claim(intF)).status === 'released' && await used() === baseUsed, '4) basarisiz odeme rezervasyonu serbest birakir');
const coT = await mkCo('TestModu');
r = await startCheckout(coT, 'solo_yearly'); const intT = r.body.intent_id;
await pay(intT, 249500, { test_mode: '1' });
ok((await claim(intT)).status === 'released' && (await one('select plan_status p from companies where id=$1', [coT])).p === 'trial', '4) PayTR TEST odemesi lisans acmaz ve kontenjan tuketmez');
ok(await used() === baseUsed, '4) test odemesi sonrasi sayac degismedi');
const coE = await mkCo('Zamanasimi');
r = await startCheckout(coE, 'solo_yearly'); const intE = r.body.intent_id;
await db.exec(`update billing_campaign_claims set reserved_until = now() - interval '1 minute' where intent_id='${intE}'`);
ok(await used() === baseUsed, '4) suresi dolan rezervasyon sayilmaz');
const coE2 = await mkCo('Zamanasimi2');
await startCheckout(coE2, 'solo_yearly');
ok((await claim(intE)).status === 'expired' && (await one('select status from billing_intents where id=$1', [intE])).status === 'expired', '4) suresi dolan rezervasyon sonraki istekte temizlenir (expired)');
// Basarisiz odeme sonrasi ayni isletme yeniden deneyip basarili olabilir (failed -> success ayni oid)
r = await pay(intF, 249500);
ok((await claim(intF)).status === 'consumed' && (await one('select plan_status p from companies where id=$1', [coF])).p === 'active',
  '4) basarisiz bildirimden sonra ayni odemenin basarili bildirimi kontenjan bosken kesinlesir');

// ===== 3) 20 kisi siniri (sirali, tek baglanti; paralel test ayri dosyada) =====
await db.exec(`delete from billing_campaign_claims; delete from billing_payments; delete from billing_intents; delete from billing_events; delete from billing_subscriptions; delete from companies;`);
const ids = [];
for (let i = 0; i < 25; i++) { const id = await mkCo('K' + i); const x = await startCheckout(id, 'solo_yearly'); ids.push({ id, ...x }); }
const got = ids.filter((x) => x.paytr.get('payment_amount') === '249500').length;
ok(got === 20, `3) 25 farkli isletme baslatti: yalniz 20'si kampanyali (${got}), digerleri 4.990 TL`);
ok(ids.slice(20).every((x) => x.paytr.get('payment_amount') === '499000'), '3) 21-25. isletmeler normal fiyat');
ok(await used() === 20, '3) rezervasyon sayaci 20');
ok(JSON.stringify((await one(`select billing_campaign_public_status() s`)).s) === '{"active":false}', '6) dolu kontenjanda genel durum: kampanya gosterimi kalkar (active=false)');
r = await startCheckout(ids[20].id, 'solo_yearly', 249500);
ok(r.status === 409 && r.body.error === 'price_changed', '6) ekranda 2.495 gosterilmisken kontenjan dolduysa odeme baslatilmaz (price_changed)');

// 20'nin 5'i oduyor, 15'i vazgeciyor/zaman asimi -> bosalan yerler yeni isletmelere acilir
for (let i = 0; i < 5; i++) await pay(ids[i].body.intent_id, 249500);
for (let i = 5; i < 20; i++) await payFail(ids[i].body.intent_id, 249500);
ok(await used() === 5, '4) 5 kesinlesen + 15 serbest: sayac 5');
const coNew = await mkCo('Yeni');
r = await startCheckout(coNew, 'solo_yearly');
ok(r.paytr.get('payment_amount') === '249500', '4) serbest kalan kontenjan yeni isletmeye acilir');

// Gec gelen bildirim: rezervasyon bitmis ve yer baskasina gitmis -> lisans acilmaz, iade gerekir
await db.exec(`delete from billing_campaign_claims where status<>'consumed'; delete from billing_intents where status<>'paid' and id not in (select intent_id from billing_campaign_claims);`);
{
  const late = await mkCo('Gec');
  const x = await startCheckout(late, 'solo_yearly'); const lateInt = x.body.intent_id;
  await db.exec(`update billing_campaign_claims set status='expired', reserved_until=now()-interval '2 hours' where intent_id='${lateInt}'`);
  for (let i = 0; i < 15; i++) { const id = await mkCo('Dolgu' + i); await startCheckout(id, 'solo_yearly'); }
  ok(await used() === 20, 'gec-bildirim senaryosu: yerler 20/20 doldu');
  r = await pay(lateInt, 249500);
  const lc = await one('select plan_status p from companies where id=$1', [late]);
  const ev = await one(`select outcome from billing_events where outcome like 'rejected_campaign%' order by received_at desc limit 1`);
  ok(r.body === 'OK' && lc.p === 'trial' && ev?.outcome === 'rejected_campaign_unavailable_refund_required',
    'gec bildirim + dolu kontenjan: LISANS ACILMAZ, olay "iade gerekir" olarak kaydedilir (20 asilmaz)');
  ok(await used() === 20, 'gec bildirim kontenjani 20\'nin ustune tasimaz');

  // Iade takibi
  const rc = await one('select * from billing_refund_cases where company_id=$1', [late]);
  ok(rc && rc.status === 'open' && rc.amount_minor === 249500 && rc.provider_ref === oidOf(lateInt), 'iade kaydi ACIK olarak acildi (tutar + PayTR referansi)');
  await pay(lateInt, 249500); // PayTR yeniden dener
  ok((await one('select count(*)::int n from billing_refund_cases where company_id=$1', [late])).n === 1, 'tekrarlanan gec bildirim ikinci iade kaydi acmaz');
  ok((await one('select count(*)::int n from billing_payments where company_id=$1', [late])).n === 0, 'gec bildirimde "basarili odeme" kaydi YAZILMAZ');
  const asUser = (sub, sup, admin = '') => db.exec(`select set_config('request.jwt.claim.sub','${sub}',false); select set_config('test.super','${sup}',false); select set_config('test.admin_of','${admin}',false);`);
  await asUser('44444444-4444-4444-4444-444444444444', '0');
  ok((await one(`select billing_refund_cases_list('open') r`).catch(() => 'forbidden')) === 'forbidden', 'super admin olmayan iade listesini goremez');
  await asUser('44444444-4444-4444-4444-444444444444', '1');
  const list = (await one(`select billing_refund_cases_list('open') r`)).r;
  ok(list.length === 1 && list[0].company_name === 'Gec' && list[0].status === 'open', 'super admin acik iadeyi firma adiyla listeler');
  ok((await one(`select billing_refund_case_resolve($1,'refunded','') r`, [rc.id]).catch(() => 'invalid')) === 'invalid', 'iade kaydi notsuz/referanssiz kapatilamaz');
  const done = (await one(`select billing_refund_case_resolve($1,'refunded','PayTR iade ref 123') r`, [rc.id])).r;
  ok(done.status === 'refunded' && done.resolved_at, 'super admin iadeyi referansla "iade edildi" yapar');
  ok((await one(`select billing_refund_case_resolve($1,'dismissed','x') r`, [rc.id]).catch(() => 'closed')) === 'closed', 'kapanmis kayit tekrar kapatilamaz');
  await asUser('', '');
}

// ===== Elle verilmis ucretli yillik lisans / deneme / hediye =====
{
  await db.exec(`update billing_campaigns set is_enabled=true; delete from billing_campaign_claims; delete from billing_intents where status='created'`);
  const el = async (co) => (await one(`select billing_campaign_eval($1,'solo_yearly') e`, [co])).e;
  const trialCo = await mkCo('Deneme');
  ok((await el(trialCo)).applied === true, 'ucretsiz deneme (trial) firma kampanyaya uygun');
  const manual = await mkCo('ElleYillik');
  await db.query(`update companies set plan_status='active', license_expires_at=now()+interval '300 days' where id=$1`, [manual]);
  let e = await el(manual);
  ok(e.applied === false && e.reason === 'already_purchased', 'super admin elle ucretli aktif lisans vermis firma kampanyadan yararlanamaz');
  r = await startCheckout(manual, 'solo_yearly');
  ok(r.paytr.get('payment_amount') === '499000', 'elle lisansli firma yillik odemede 4.990 TL');
  const gift = await mkCo('Hediye');
  await db.query(`update companies set plan_status='active', is_pilot=true, pilot_until=now()+interval '30 days' where id=$1`, [gift]);
  ok((await el(gift)).applied === true, 'ozel erisim (hediye) firma kampanyaya uygun');
  const giftActive = await mkCo('HediyeAktif');
  await db.query(`update companies set plan_status='active', license_expires_at=now()+interval '60 days' where id=$1`, [giftActive]);
  ok((await el(giftActive)).applied === false, 'otomatik tespit: kayitsiz aktif lisans temkinli sekilde ucretli sayilir');
  await db.exec(`select set_config('request.jwt.claim.sub','55555555-5555-5555-5555-555555555555',false); select set_config('test.super','1',false);`);
  const st = (await one(`select billing_campaign_set_override($1,true,'hediye') r`, [giftActive])).r;
  ok(st.override.allow === true && (await el(giftActive)).applied === true, 'super admin istisnasi (hediye): kampanya acilir');
  await one(`select billing_campaign_set_override($1,false,'faturali yillik') r`, [trialCo]);
  ok((await el(trialCo)).applied === false, 'super admin "ucretli yillik" isaretlerse deneme firma da disarida kalir');
  await one(`select billing_campaign_set_override($1,null) r`, [trialCo]);
  ok((await el(trialCo)).applied === true, 'istisna kaldirilinca varsayilan kural');
  await db.exec(`select set_config('test.super','0',false);`);
  ok((await one(`select billing_campaign_set_override($1,true,'x') r`, [manual]).catch(() => 'forbidden')) === 'forbidden', 'super admin olmayan istisna koyamaz');
  await db.exec(`select set_config('request.jwt.claim.sub','',false); select set_config('test.super','',false);`);
  // Aylik KAMPANYA odemesi yapan isletme sonradan yillik indirimi (ve tekrar aylik indirimi) kullanamaz
  const mon = await mkCo('AylikKampanya');
  const mi = await startCheckout(mon, 'solo_monthly');
  ok(mi.paytr.get('payment_amount') === '24950', 'aylik kampanya: 249,50 TL');
  await pay(mi.body.intent_id, 24950);
  ok((await one('select plan_status p from companies where id=$1', [mon])).p === 'active', 'aylik kampanyali odeme lisansi acti');
  ok((await claim(mi.body.intent_id)).status === 'consumed' && await used() === 1, 'aylik kampanya TEK ortak kontenjani kesinlestirdi');
  ok((await el(mon)).applied === false, 'aylik indirim kullanan isletme yillik indirime uygun degil');
  r = await startCheckout(mon, 'solo_yearly');
  ok(r.paytr.get('payment_amount') === '499000', 'aylik indirim kullanan isletme: yillik 4.990 TL');
  r = await startCheckout(mon, 'solo_monthly');
  ok(r.paytr.get('payment_amount') === '49900', 'aylik indirim kullanan isletme: sonraki aylik 499 TL (normal)');
  // Yillik indirim kullanan sonradan aylik indirimi kullanamaz
  const yr = await mkCo('YillikKampanya');
  const yi = await startCheckout(yr, 'solo_yearly');
  await pay(yi.body.intent_id, 249500);
  ok((await claim(yi.body.intent_id)).status === 'consumed' && await used() === 2, 'yillik kampanya ayni ortak kontenjandan (2/20)');
  r = await startCheckout(yr, 'solo_monthly');
  ok(r.paytr.get('payment_amount') === '49900', 'yillik indirim kullanan isletme: aylik 499 TL (indirim yok)');
  // Kampanya KAPALIYKEN yapilan normal (indirimsiz) odeme de "onceki ucretli alim" sayilir
  await db.exec(`update billing_campaigns set is_enabled=false`);
  const nrm = await mkCo('NormalOdeme');
  const ni = await startCheckout(nrm, 'solo_monthly');
  await pay(ni.body.intent_id, 49900);
  await db.exec(`update billing_campaigns set is_enabled=true`);
  ok((await el(nrm)).applied === false && (await el(nrm)).reason === 'already_purchased', 'kampanya oncesi normal fiyatla odeme yapmis isletme kampanya disi');
  // Ortak kontenjan: 18 daha (2 + 18 = 20) karisik plan -> 21. ve sonrasi normal fiyat
  const mix = [];
  for (let i = 0; i < 24; i++) { const id = await mkCo('Mix' + i); const plan = i % 2 ? 'solo_monthly' : 'solo_yearly'; mix.push({ plan, ...(await startCheckout(id, plan)) }); }
  const amts = mix.map((m) => m.paytr.get('payment_amount'));
  const disc = mix.filter((m) => m.paytr.get('payment_amount') === (m.plan === 'solo_monthly' ? '24950' : '249500')).length;
  ok(disc === 18 - 0 + 0 && await used() === 20, `karisik aylik+yillik: ortak kontenjan ${await used()}/20, kampanyali ${disc} (beklenen 18; 2'si once kesinlesti)`);
  ok(mix.slice(18).every((m) => m.paytr.get('payment_amount') === (m.plan === 'solo_monthly' ? '49900' : '499000')), 'kontenjan dolunca her iki paket normal fiyat');
  ok(JSON.stringify((await one(`select billing_campaign_public_status() s`)).s) === '{"active":false}', 'ortak kontenjan dolunca genel durum kapali');
  // Genel durum: acikken her iki plan
  await db.exec(`delete from billing_campaign_claims where status='reserved'`);
  const ps = (await one(`select billing_campaign_public_status() s`)).s;
  ok(ps.active === true && ps.plans.length === 2 && ps.plans.find((x) => x.plan_code === 'solo_monthly').price_minor === 24950 && ps.plans.find((x) => x.plan_code === 'solo_yearly').price_minor === 249500 && ps.price_minor === 249500,
    'genel durum: plans[] aylik 24950 + yillik 249500 (eski yillik alanlar korunur)');
  // Gec bildirim, AYLIK: kontenjan dolmus -> lisans acilmaz, iade kaydi
  await db.exec(`delete from billing_campaign_claims where status='reserved'; delete from billing_intents where status='created'`);
  const lateM = await mkCo('GecAylik');
  const lm = await startCheckout(lateM, 'solo_monthly');
  await db.exec(`update billing_campaign_claims set status='expired', reserved_until=now()-interval '2 hours' where intent_id='${lm.body.intent_id}'`);
  for (let i = 0; i < 18; i++) { const id = await mkCo('Dolgu2_' + i); await startCheckout(id, 'solo_yearly'); }
  ok(await used() === 20, 'gec aylik senaryo: 20/20');
  await pay(lm.body.intent_id, 24950);
  ok((await one('select plan_status p from companies where id=$1', [lateM])).p === 'trial' && (await one('select count(*)::int n from billing_refund_cases where company_id=$1', [lateM])).n === 1,
    'gec gelen AYLIK kampanya odemesi + dolu kontenjan: lisans acilmaz, iade kaydi acilir');
}

// ===== QA onizleme: kampanya KAPALIYKEN yalniz test firmasina =====
{
  await db.exec(`update billing_campaigns set is_enabled=false, qa_preview=true; delete from billing_campaign_claims; delete from billing_intents where status='created'`);
  const real = await mkCo('GercekMusteri');
  const qa = await mkCo('QAFirma');
  await db.exec(`insert into billing_test_companies(company_id) values ('${qa}')`);
  r = await startCheckout(real, 'solo_yearly');
  ok(r.paytr.get('payment_amount') === '499000', 'QA onizleme: gercek firmaya kampanya UYGULANMAZ (4.990 TL)');
  ok(r.paytr.get('test_mode') === '0', 'gercek firma: PayTR CANLI mod (test_mode=0), satis etkilenmez');
  r = await startCheckout(qa, 'solo_yearly');
  ok(r.paytr.get('payment_amount') === '249500', 'QA onizleme: yalniz test firmasina 2.495 TL');
  ok(r.paytr.get('test_mode') === '1', 'test firmasi: PayTR TEST modu zorlanir (gercek kart cekilmez)');
  ok(JSON.stringify((await one(`select billing_campaign_public_status() s`)).s) === '{"active":false}', 'QA onizleme: genel (site) durumu KAPALI kalir');
  ok((await one(`select count(*)::int n from billing_campaign_claims where is_test`)).n === 1 && await used() === 0, 'QA onizleme: test firmasi kontenjan tuketmez');
  await db.exec(`update billing_campaigns set qa_preview=false`);
  r = await startCheckout(qa, 'solo_yearly');
  ok(r.paytr.get('payment_amount') === '499000', 'QA onizleme kapaninca test firmasi da normal fiyat');
  await db.exec(`update billing_campaigns set is_enabled=true; delete from billing_campaign_claims; delete from billing_intents where status='created'`);
}

// ===== Tutar sabitleme + kapatma =====
await db.exec(`delete from billing_campaign_claims; delete from billing_payments; delete from billing_intents; delete from billing_events; delete from billing_subscriptions; delete from companies;`);
{
  const co = await mkCo('Sabit');
  const x = await startCheckout(co, 'solo_yearly'); // 2.495 sabitlendi
  await enable(false); // yonetici kampanyayi kapatti
  ok(JSON.stringify((await one(`select billing_campaign_public_status() s`)).s) === '{"active":false}', '6) kapatilinca genel durum active=false');
  const co2 = await mkCo('KapaliSonrasi');
  const y = await startCheckout(co2, 'solo_yearly');
  ok(y.paytr.get('payment_amount') === '499000', '6) kampanya kapaliyken yeni yillik alim 4.990 TL');
  r = await pay(x.body.intent_id, 499000);
  ok((await one('select plan_status p from companies where id=$1', [co])).p === 'trial', 'baslatilmis kampanyali odeme icin 4.990 ile gelen bildirim reddedilir (tutar sabit)');
  r = await pay(x.body.intent_id, 249500);
  ok((await one('select plan_status p from companies where id=$1', [co])).p === 'active', 'kampanya kapandiktan SONRA gelen, onceden baslatilmis 2.495 odeme sabit tutarla kesinlesir');
  const y2 = await pay(y.body.intent_id, 249500);
  ok((await one('select plan_status p from companies where id=$1', [co2])).p === 'trial', 'normal fiyatli niyet icin 2.495 bildirimi lisans acmaz');
  // Yonetici RPC yetkisi
  await db.exec(`select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false); select set_config('test.super','0',false);`);
  ok((await one(`select billing_campaign_set_enabled($1,true) r`, [CAMP]).catch(() => 'forbidden')) === 'forbidden', 'yonetici olmayan kullanici kampanyayi acip kapatamaz');
  await db.exec(`select set_config('test.super','1',false);`);
  const on = (await one(`select billing_campaign_set_enabled($1,true) r`, [CAMP])).r;
  ok(on.is_enabled === true, 'super admin kampanyayi acabilir');
  const off = (await one(`select billing_campaign_set_enabled($1,false) r`, [CAMP])).r;
  ok(off.is_enabled === false, 'super admin kampanyayi kapatabilir');
  await db.exec(`select set_config('request.jwt.claim.sub','',false); select set_config('test.super','',false);`);
}

// ===== Mevcut davranis bozulmadi =====
{
  await enable(false);
  const co = await mkCo('Normal');
  const x = await startCheckout(co, 'solo_monthly');
  r = await pay(x.body.intent_id, 49900);
  ok((await one('select plan_status p from companies where id=$1', [co])).p === 'active', 'aylik paket akisi aynen calisir');
  ok(JSON.stringify((await one(`select billing_campaign_public_status() s`)).s) === '{"active":false}', 'kampanya kapali genel durum');
  const rl = await one(`select (select count(*) from billing_campaign_claims where intent_id=$1) n`, [x.body.intent_id]);
  ok(Number(rl.n) === 0, 'aylik/normal alimlar kampanya kaydi olusturmaz');
  // Rollback dosyasi uygulanabilir
  await db.exec(fs.readFileSync(path.join(ROOT, 'supabase_migration_040_rollback.sql'), 'utf8'));
  const e40 = (await one(`select billing_campaign_eval($1,'solo_monthly') e`, [co])).e;
  ok(e40.applied === false, '040 geri alma: aylik plan kampanya disi (yalniz yillik kampanya)');
  await db.exec(fs.readFileSync(path.join(ROOT, 'supabase_migration_039_rollback.sql'), 'utf8'));
  const fns = await rows(`select proname from pg_proc where proname like 'billing_campaign%'`);
  ok(fns.length === 0, 'geri alma: kampanya fonksiyonlari kalkti');
  const cnt = await one('select count(*)::int n from billing_payments');
  ok(cnt.n >= 1, 'geri alma: odeme kayitlari KORUNDU');
  const x2 = (await one(`select billing_create_intent('paytr',$1,'solo_yearly',null) r`, [co])).r;
  ok(x2.amount_minor === 499000, 'geri alma sonrasi (eski 4 argumanli RPC) yillik 4.990 TL niyeti olusur');
}

console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nTUM KONTROLLER GECTI');
process.exit(fail ? 1 : 0);
