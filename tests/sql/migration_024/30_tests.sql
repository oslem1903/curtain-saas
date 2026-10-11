\set ON_ERROR_STOP 1
\pset footer off
create or replace function pg_temp.act(p uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(p::text,''), false) $$;
create or replace function pg_temp.expect_error(p_sql text, p_like text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'FAIL (hata bekleniyordu): ' || p_sql;
exception when others then
  if sqlerrm ilike '%' || p_like || '%' then return 'PASS: ' || left(sqlerrm, 90); end if;
  return 'FAIL (farkli hata): ' || sqlerrm;
end $$;
grant execute on function pg_temp.act(uuid) to authenticated;

-- 1) Rol yukseltme acigi kapandi mi
insert into auth.users(id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000bad2','attacker2@evil.test','{"role":"super_admin","full_name":"X"}');
select '1 yeni kayit metadata super_admin -> rol' t, role, case when role='installer' then 'PASS' else 'FAIL' end from public.profiles where user_id='00000000-0000-0000-0000-00000000bad2';

-- 2) Dogrulanmamis e-posta ile deneme baslatilamaz
insert into auth.users(id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000e1','yeni1@musteri.test','{"full_name":"Ayse Yilmaz","company_name":"Ayse Perde","signup_intent":"self_trial"}');
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000e1');
select '2 dogrulanmamis' t, pg_temp.expect_error($$select public.start_self_service_trial('Ayse Perde','Ayse Yilmaz')$$, 'PERDEPRO_EMAIL_NOT_CONFIRMED');
reset role;

-- 3) Dogrulanmis kullanici: isletme + uyelik + deneme
update auth.users set email_confirmed_at = now() where id='00000000-0000-0000-0000-0000000000e1';
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000e1');
select '3 ilk cagri' t, r->>'created' created, (r->>'trial_ends_at')::timestamptz - (r->>'trial_started_at')::timestamptz sure from (select public.start_self_service_trial('', null) r) x;
reset role;
select '3 firma' t, c.name, c.plan_status, c.subscription_status, c.subscription_plan, c.package_code, c.signup_source, c.onboarding_completed, c.is_pilot,
  case when c.trial_started_at is not null and c.trial_ends_at = c.trial_started_at + interval '7 days' and c.owner_id = '00000000-0000-0000-0000-0000000000e1' then 'PASS' else 'FAIL' end
from public.companies c where c.owner_id='00000000-0000-0000-0000-0000000000e1';
select '3 uyelik+profil' t, cm.role, p.role prof_role, p.full_name, case when cm.role='admin' and p.role='admin' and p.full_name='Ayse Yilmaz' then 'PASS' else 'FAIL' end
from public.company_members cm join public.profiles p on p.user_id=cm.user_id where cm.user_id='00000000-0000-0000-0000-0000000000e1';
select '3 trial_grant' t, source, case when count(*) over () = 1 then 'PASS' else 'FAIL' end from public.trial_grants where user_id='00000000-0000-0000-0000-0000000000e1';

-- 4) Tekrar cagri / tekrar giris: yeni firma ya da yeni deneme yok
create temp table snap as select id, trial_ends_at from public.companies where owner_id='00000000-0000-0000-0000-0000000000e1';
grant select on snap to authenticated;
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000e1');
select '4 ikinci cagri' t, r->>'created' created, case when r->>'created'='false' and (r->>'company_id')::uuid = (select id from snap) then 'PASS' else 'FAIL' end from (select public.start_self_service_trial('Baska Ad', null) r) x;
reset role;
select '4 firma sayisi/sure degismedi' t, count(*), case when count(*)=1 and max(c.trial_ends_at) = (select trial_ends_at from snap) then 'PASS' else 'FAIL' end
from public.companies c where c.owner_id='00000000-0000-0000-0000-0000000000e1';

-- 5) Aktif denemede yazma serbest
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000e1');
insert into public.customers(company_id,name) select id,'Yeni Musteri' from snap;
insert into public.payments(company_id,amount) select id, 100 from snap;
select '5 aktif denemede yazma' t, (select count(*) from public.customers where company_id=(select id from snap)) musteri, (select count(*) from public.payments where company_id=(select id from snap)) odeme;
-- 13) Izolasyon: baska firmanin verisi gorunmez / yazilamaz
select '13 baska firma musterisi gorunur mu' t, count(*), case when count(*)=0 then 'PASS' else 'FAIL' end from public.customers where company_id='00000000-0000-0000-0000-0000000c000a';
select '13 baska firmaya yazma' t, pg_temp.expect_error($$insert into public.customers(company_id,name) values ('00000000-0000-0000-0000-0000000c000a','sizinti')$$, '');
reset role;

-- 6) Sure doldu (zaman ilerlemis gibi): okuma var, yazma yok
update public.companies set trial_ends_at = now() - interval '1 minute' where id=(select id from snap);
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000e1');
select '6 okuma' t, count(*) from public.payments where company_id=(select id from snap);
select '6 insert' t, pg_temp.expect_error($$insert into public.payments(company_id,amount) select id, 5 from snap$$, 'PERDEPRO_SUBSCRIPTION_READ_ONLY');
select '6 update' t, pg_temp.expect_error($$update public.payments set amount=1 where company_id=(select id from snap)$$, 'PERDEPRO_SUBSCRIPTION_READ_ONLY');
select '6 delete' t, pg_temp.expect_error($$delete from public.payments where company_id=(select id from snap)$$, 'PERDEPRO_SUBSCRIPTION_READ_ONLY');
select '6 tekrar cagri sure yenilemez' t, case when (r->>'trial_ends_at')::timestamptz < now() and r->>'created'='false' then 'PASS' else 'FAIL' end from (select public.start_self_service_trial('x',null) r) x;
reset role;
select '6 veriler duruyor' t, (select count(*) from public.payments where company_id=(select id from snap)) odeme, (select count(*) from public.customers where company_id=(select id from snap)) musteri;
-- oturumsuz (service role / SQL editor) muaf
select pg_temp.act(null);
insert into public.payments(company_id,amount) select id, 7 from snap;
select '6 oturumsuz sistem yazimi' t, 'PASS';

-- 7) Firma silinip ayni hesapla tekrar: deneme yenilenmez
select pg_temp.act('00000000-0000-0000-0000-00000000a001');
delete from public.payments where company_id=(select id from snap);
delete from public.customers where company_id=(select id from snap);
delete from public.companies where id=(select id from snap);
select pg_temp.act(null);
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000e1');
select '7 silinen firma sonrasi' t, r->>'created' created, r->>'trial_reused' reused, case when r->>'trial_reused'='true' and (r->>'trial_ends_at')::timestamptz = (select trial_ends_at from snap) then 'PASS' else 'FAIL' end from (select public.start_self_service_trial('Ayse Perde 2',null) r) x;
reset role;

-- 8) Ayni e-posta ile hesap silinip yeniden acilirsa: deneme yenilenmez
delete from public.company_members where user_id='00000000-0000-0000-0000-0000000000e1';
delete from auth.users where id='00000000-0000-0000-0000-0000000000e1';
insert into auth.users(id,email,email_confirmed_at) values ('00000000-0000-0000-0000-0000000000e2','YENI1@musteri.test',now());
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000e2');
select '8 ayni e-posta yeni hesap' t, case when r->>'trial_reused'='true' and (r->>'trial_ends_at')::timestamptz = (select trial_ends_at from snap) then 'PASS' else 'FAIL' end from (select public.start_self_service_trial('Ayse Perde 3',null) r) x;
reset role;

-- 9) Eski kullanici: mevcut firma doner, deneme degismez
create temp table snap_a as select trial_ends_at, plan_status from public.companies where id='00000000-0000-0000-0000-0000000c000a';
grant select on snap_a to authenticated;
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000a002');
select '9 eski yonetici' t, case when r->>'created'='false' and r->>'company_id'='00000000-0000-0000-0000-0000000c000a' then 'PASS' else 'FAIL' end from (select public.start_self_service_trial('Yeni',null) r) x;
reset role;
select '9 eski firma degismedi' t, case when c.trial_ends_at = s.trial_ends_at and c.plan_status = s.plan_status and c.signup_source is null and c.trial_started_at is null then 'PASS' else 'FAIL' end from public.companies c, snap_a s where c.id='00000000-0000-0000-0000-0000000c000a';

-- 10) Uyeligi kaldirilmis eski yonetici: yeni deneme alamaz (backfill)
delete from public.company_members where user_id='00000000-0000-0000-0000-00000000a005';
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000a005');
select '10 eski yonetici yeniden kayit' t, case when r->>'trial_reused'='true' and (r->>'trial_ends_at')::timestamptz < now() then 'PASS' else 'FAIL' end from (select public.start_self_service_trial('Yeni Isletme',null) r) x;
reset role;

-- 11) Super admin kurulum kodu (pilot/ozel sure) ile katilim: yeni firma/deneme yok
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000a001');
create temp table inv on commit preserve rows as select * from public.create_company_with_owner_invite('Ozel Kurulum', 'ozel@musteri.test', 30, true);
reset role;
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ('00000000-0000-0000-0000-0000000000e3','ozel@musteri.test',now(),'{"role":"admin"}');
select '11 metadata admin -> profil' t, role, case when role='installer' then 'PASS' else 'FAIL' end from public.profiles where user_id='00000000-0000-0000-0000-0000000000e3';
create temp table cnt as select count(*) n from public.companies; grant select on cnt, inv to authenticated;
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000e3');
select '11 kodla katil' t, accepted_role from public.accept_invite_code_for_current_user('ozel@musteri.test', (select invite_code from inv), 'Ozel Kisi');
select '11 sonra self trial' t, case when r->>'created'='false' and (r->>'company_id')::uuid=(select company_id from inv) then 'PASS' else 'FAIL' end from (select public.start_self_service_trial('Baska',null) r) x;
reset role;
select '11 firma sayisi ayni + ozel sure korundu' t, case when (select count(*) from public.companies)=(select n from cnt) and c.is_pilot and c.trial_ends_at > now() + interval '29 days' then 'PASS' else 'FAIL' end from public.companies c where c.id=(select company_id from inv);

-- 12) Personel daveti ile mevcut isletmeye katilim
insert into public.user_invites(company_id,email,role,token,invite_code,expires_at,invited_by)
values ('00000000-0000-0000-0000-0000000c000a','montajci@a.test','installer','tok-12','ABC-123',now()+interval '7 days','00000000-0000-0000-0000-00000000a002');
insert into auth.users(id,email,email_confirmed_at) values ('00000000-0000-0000-0000-0000000000e4','montajci@a.test',now());
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000e4');
select '12 personel katilim' t, accepted_company_id, accepted_role from public.accept_invite_code_for_current_user('montajci@a.test','abc-123',null);
select '12 sonra self trial' t, case when r->>'created'='false' and r->>'company_id'='00000000-0000-0000-0000-0000000c000a' then 'PASS' else 'FAIL' end from (select public.start_self_service_trial('Kendi',null) r) x;
reset role;
select '12 grant yok' t, case when count(*)=0 then 'PASS' else 'FAIL' end from public.trial_grants where user_id='00000000-0000-0000-0000-0000000000e4';

-- 14) Super admin deneme isletmesi acamaz
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000a001');
select '14 super admin' t, pg_temp.expect_error($$select public.start_self_service_trial('X',null)$$, 'Süper yönetici');
-- 18) Super admin suresi dolmus firmaya yazabilir (muaf)
insert into public.payments(company_id,amount) values ('00000000-0000-0000-0000-0000000c000b', 1);
select '18 super admin muaf' t, 'PASS';
reset role;

-- 18) Pilot / lisansli / suresi dolmus eski firmalar
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000a004');
insert into public.payments(company_id,amount) values ('00000000-0000-0000-0000-0000000c000c', 1);
select '18 pilot (tarih NULL) yazabilir' t, 'PASS';
select pg_temp.act('00000000-0000-0000-0000-00000000a006');
insert into public.payments(company_id,amount) values ('00000000-0000-0000-0000-0000000c000e', 1);
select '18 lifetime yazabilir' t, 'PASS';
select pg_temp.act('00000000-0000-0000-0000-00000000a003');
select '18 eski suresi dolmus firma' t, pg_temp.expect_error($$insert into public.payments(company_id,amount) values ('00000000-0000-0000-0000-0000000c000b', 1)$$, 'PERDEPRO_SUBSCRIPTION_READ_ONLY');
select '18 eski suresi dolmus firma okuma' t, count(*) from public.customers where company_id='00000000-0000-0000-0000-0000000c000b';
reset role;

-- 15) Kayit kapatilinca
update public.self_signup_settings set enabled=false;
insert into auth.users(id,email,email_confirmed_at) values ('00000000-0000-0000-0000-0000000000e5','kapali@musteri.test',now());
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000e5');
select '15 kayit kapali' t, pg_temp.expect_error($$select public.start_self_service_trial('X Perde',null)$$, 'PERDEPRO_SELF_SIGNUP_DISABLED');
reset role;
update public.self_signup_settings set enabled=true;

-- 17) anon calistiramaz
set role anon;
select '17 anon' t, pg_temp.expect_error($$select public.start_self_service_trial('X',null)$$, 'permission denied');
reset role;
-- ayarlar ve grant tablosu normal kullaniciya kapali
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000e5');
select '17 grant tablosu gorunmez' t, count(*), case when count(*)=0 then 'PASS' else 'FAIL' end from public.trial_grants;
select '17 ayar tablosu gorunmez' t, count(*), case when count(*)=0 then 'PASS' else 'FAIL' end from public.self_signup_settings;
reset role;
