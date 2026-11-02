// GERCEK PostgreSQL uzerinde ESZAMANLI kampanya testi (migration 033-036 + 039; PGlite tek baglantidir, bunu kanitlayamaz).
//   PG_TEST_MODULES=<dizin> node tests/billing/campaign.concurrency.mjs
// <dizin>: icinde `npm i embedded-postgres pg` yapilmis bir klasor (repo bagimliligi DEGILDIR; yalniz bu test icin).
// Gecici bir PostgreSQL ornegi acilir, test bitince silinir. Supabase / PayTR'ye baglanmaz.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const modDir = process.env.PG_TEST_MODULES;
if (!modDir) { console.error('PG_TEST_MODULES ayarlanmamis (embedded-postgres + pg kurulu klasor).'); process.exit(2); }
const req = createRequire(path.join(modDir, 'x.js'));
const EmbeddedPostgres = req('embedded-postgres').default ?? req('embedded-postgres');
const { Pool } = req('pg');

let fail = 0;
const ok = (c, m) => { if (!c) fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perdepro-pg-'));
const port = 54000 + Math.floor(Math.random() * 900);
const pgsrv = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port, persistent: false, initdbFlags: ['--locale=C', '--encoding=UTF8'] });
await pgsrv.initialise();
await pgsrv.start();
await pgsrv.createDatabase('t');
const pool = new Pool({ host: 'localhost', port, user: 'postgres', password: 'pw', database: 't', max: 60 });
const q = (s, p) => pool.query(s, p).then((r) => r.rows);
try {
  await q(`create role anon; create role authenticated; create role service_role; create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create table public.companies(id uuid primary key default gen_random_uuid(), name text, is_active boolean default true, plan_status text, subscription_status text, trial_ends_at timestamptz, license_expires_at timestamptz, package_code text, subscription_plan text, enabled_modules text[], updated_at timestamptz, created_at timestamptz default now(), is_pilot boolean default false, pilot_until timestamptz);
create function public.is_super_admin() returns boolean language sql as $$ select false $$;
create function public.is_company_admin(c uuid) returns boolean language sql as $$ select true $$;`);
  for (const f of ['supabase_migration_033_solo_billing_modules.sql', 'supabase_migration_034_solo_plans.sql', 'supabase_migration_035_billing_event_keys.sql',
    'supabase_migration_036_test_company_checkout.sql', 'supabase_migration_039_launch_campaign.sql']) {
    await pool.query(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  }
  await q(`update billing_plans set is_purchasable=true; update billing_campaigns set is_enabled=true`);

  const mkCo = async (n) => (await q(`insert into companies(name,plan_status,trial_ends_at,package_code,subscription_plan) values($1,'trial',now()+interval '3 days','solo','trial') returning id`, [n]))[0].id;
  const intent = (co, plan = 'solo_yearly') => q(`select billing_create_intent('paytr',$1,$2,null) r`, [co, plan]).then((r) => r[0].r);
  const pay = (i, amount, test = false) => q(`select billing_apply_charge('paytr',$1,$2,'solo_yearly',$1,$3,'TRY',null,'{}'::jsonb,$4) r`,
    ['PRD' + i.intent_id.replace(/-/g, ''), i.company, amount, test]).then((r) => r[0].r);
  const state = async () => (await q(`select
    (select count(*)::int from billing_campaign_claims where status='consumed' and not is_test) consumed,
    (select count(*)::int from billing_campaign_claims where status='reserved' and reserved_until>now() and not is_test) reserved,
    (select count(*)::int from billing_payments where amount_minor=249500) disc_payments`))[0];

  // A) 60 farkli isletme ayni anda odeme baslatir -> tam 20 kampanyali
  const cos = await Promise.all(Array.from({ length: 60 }, (_, i) => mkCo('A' + i)));
  const ints = await Promise.all(cos.map((c) => intent(c).then((r) => ({ ...r, company: c }))));
  const disc = ints.filter((i) => i.amount_minor === 249500).length;
  ok(disc === 20, `A) 60 eszamanli yillik baslatma: kampanyali = ${disc} (beklenen tam 20)`);
  ok(ints.filter((i) => i.amount_minor === 499000).length === 40, 'A) kalan 40 tanesi 4.990 TL');
  ok((await state()).reserved === 20, 'A) aktif rezervasyon 20');

  // B) Ayni odeme bildirimi 15 kez ESZAMANLI -> tek odeme, tek sure uzatma, kontenjan 1 kez
  const first = ints.find((i) => i.amount_minor === 249500);
  const res = await Promise.all(Array.from({ length: 15 }, () => pay(first, 249500)));
  ok(res.filter((r) => r.status === 'applied').length === 1, 'B) 15 eszamanli ayni bildirim: yalniz 1 "applied"');
  const pc = await q(`select count(*)::int n from billing_payments where company_id=$1`, [first.company]);
  ok(pc[0].n === 1, 'B) tek odeme kaydi');
  ok((await state()).consumed === 1, 'B) kontenjan tek kez kesinlesti');

  // C) Ayni isletme ayni anda 10 odeme baslatir -> tek aktif rezervasyon
  const cx = await mkCo('C');
  await q(`update billing_campaign_claims set status='released' where status='reserved'`);
  const cints = await Promise.all(Array.from({ length: 10 }, () => intent(cx)));
  const live = await q(`select count(*)::int n from billing_campaign_claims where company_id=$1 and status='reserved'`, [cx]);
  ok(live[0].n === 1, `C) ayni isletmeden 10 eszamanli baslatma: aktif rezervasyon ${live[0].n} (beklenen 1)`);

  // D) Yaris: 20 eski rezervasyon SURESI DOLMUS, 20 yeni isletme yerleri aldi; eski 20 + yeni 20 AYNI ANDA oduyor
  await q(`delete from billing_campaign_claims; delete from billing_payments; delete from billing_events; delete from billing_subscriptions; delete from billing_intents;
           update companies set plan_status='trial', license_expires_at=null`);
  const oldCos = await Promise.all(Array.from({ length: 20 }, (_, i) => mkCo('Old' + i)));
  const oldInts = await Promise.all(oldCos.map((c) => intent(c).then((r) => ({ ...r, company: c }))));
  await q(`update billing_campaign_claims set reserved_until = now() - interval '1 minute'`);
  const newCos = await Promise.all(Array.from({ length: 20 }, (_, i) => mkCo('New' + i)));
  const newInts = await Promise.all(newCos.map((c) => intent(c).then((r) => ({ ...r, company: c }))));
  ok(newInts.every((i) => i.amount_minor === 249500), 'D) suresi dolan 20 rezervasyonun yerini 20 yeni isletme aldi');
  const all = [...oldInts, ...newInts].sort(() => Math.random() - 0.5);
  const out = await Promise.all(all.map((i) => pay(i, 249500)));
  const st = await state();
  ok(st.consumed === 20 && st.disc_payments <= 20, `D) 40 eszamanli odeme bildirimi: kesinlesen=${st.consumed}, indirimli tahsilat kaydi=${st.disc_payments} (20'yi asmaz)`);
  const refunds = out.filter((r) => r.reason === 'campaign_unavailable' && r.refund_required);
  ok(out.filter((r) => r.status === 'applied').length === st.consumed && refunds.length === 40 - st.consumed,
    `D) reddedilen ${refunds.length} odeme "iade gerekir" olarak isaretli; lisans acilmadi`);
  const lic = await q(`select count(*)::int n from companies where plan_status='active' and name ~ '^(Old|New)'`);
  ok(lic[0].n === st.consumed, 'D) lisans yalniz kesinlesen odemeler icin acildi');

  // E) Eszamanli baslatma + odeme birlikte (kilitlenme/hata olmamali)
  await q(`delete from billing_campaign_claims; delete from billing_payments; delete from billing_events; delete from billing_subscriptions; delete from billing_intents;
           update companies set plan_status='trial', license_expires_at=null`);
  const e1 = await Promise.all(Array.from({ length: 10 }, (_, i) => mkCo('E1_' + i)));
  const e1i = await Promise.all(e1.map((c) => intent(c).then((r) => ({ ...r, company: c }))));
  const e2 = await Promise.all(Array.from({ length: 30 }, (_, i) => mkCo('E2_' + i)));
  const mixed = await Promise.allSettled([...e1i.map((i) => pay(i, 249500)), ...e2.map((c) => intent(c))]);
  ok(mixed.every((m) => m.status === 'fulfilled'), 'E) eszamanli baslatma + odeme: hata / kilitlenme yok');
  const st2 = await state();
  ok(st2.consumed + st2.reserved <= 20, `E) kesinlesen+rezerve = ${st2.consumed + st2.reserved} (<=20)`);
} finally {
  await pool.end().catch(() => {});
  await pgsrv.stop().catch(() => {});
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(fail ? `\n${fail} KONTROL BASARISIZ` : '\nTUM KONTROLLER GECTI');
process.exit(fail ? 1 : 0);
