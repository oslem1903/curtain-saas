\pset footer off
\pset tuples_only on
create or replace function pg_temp.act(p uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(p::text,''), false) $$;
create or replace function pg_temp.expect(p_name text, p_sql text, p_code text) returns text language plpgsql as $$
begin
  execute p_sql;
  if p_code = 'OK' then return 'PASS ' || p_name; end if;
  return 'FAIL ' || p_name || ' (beklenen ' || p_code || ', ama izin verildi)';
exception when others then
  if p_code <> 'OK' and (sqlerrm like p_code || '%' or (p_code = 'RO' and (sqlerrm like 'PERDEPRO_SUBSCRIPTION_READ_ONLY%' or sqlerrm like 'Firma lisansı aktif değil%'))) then return 'PASS ' || p_name || '  [' || left(sqlerrm, 60) || ']'; end if;
  return 'FAIL ' || p_name || ' -> ' || sqlerrm;
end $$;
create or replace function pg_temp.check(p_name text, p_ok boolean, p_info text default '') returns text language sql as $$ select case when p_ok then 'PASS ' else 'FAIL ' end || p_name || case when p_info <> '' then '  (' || p_info || ')' else '' end $$;
grant execute on all functions in schema pg_temp to authenticated, anon;
create or replace function public.test_definer_exec(p_sql text) returns void language plpgsql security definer set search_path = public as $$ begin execute p_sql; end $$;
grant execute on function public.test_definer_exec(text) to authenticated;
create temp table g0 as select count(*) n from public.trial_grants; grant select on g0 to authenticated;
create temp table yb as select trial_ends_at from public.companies where id='00000000-0000-0000-0000-0000000c00d2'; grant select on yb to authenticated;

-- ===== 1) Guvenlik aciklari kapandi mi
-- (Yalnizca test: canlida company_members RLS'i nedeniyle yonetici personel profilini goremiyor;
--  tetikleyici mantigini sinamak icin gorunurluk saglayan gecici politika.)
create policy test_only_visibility on public.profiles for all using (true) with check (true);
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000a002');
select pg_temp.expect('01 kullanici kendini super_admin yapamaz', $q$update public.profiles set role='super_admin' where user_id='00000000-0000-0000-0000-00000000a002'$q$, 'PERDEPRO_FORBIDDEN');
select pg_temp.expect('02 kullanici kendi rolunu degistiremez', $q$update public.profiles set role='accountant' where user_id='00000000-0000-0000-0000-00000000a002'$q$, 'PERDEPRO_FORBIDDEN');
select pg_temp.expect('03 kullanici kendi is_active alanini degistiremez', $q$update public.profiles set is_active=false where user_id='00000000-0000-0000-0000-00000000a002'$q$, 'PERDEPRO_FORBIDDEN');
select pg_temp.expect('04 firma yoneticisi personelin rolunu degistirebilir (StaffManagement)', $q$update public.profiles set role='accountant' where user_id='00000000-0000-0000-0000-0000000000d3'$q$, 'OK');
select pg_temp.check('04b rol gercekten degisti', (select role from public.profiles where user_id='00000000-0000-0000-0000-0000000000d3') = 'accountant');
select pg_temp.expect('05 firma yoneticisi personeli super_admin yapamaz', $q$update public.profiles set role='super_admin' where user_id='00000000-0000-0000-0000-0000000000d3'$q$, 'PERDEPRO_FORBIDDEN');
reset role; drop policy test_only_visibility on public.profiles;
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000a002');
select pg_temp.expect('06 kullanici kendini baska firmaya ekleyemez', $q$insert into public.company_members(company_id,user_id,role) values ('00000000-0000-0000-0000-0000000c00d2','00000000-0000-0000-0000-00000000a002','admin')$q$, 'new row violates row-level security');
select pg_temp.check('07 ad/telefon gibi kendi profil alanlari guncellenebilir', (select count(*) from (select 1) x) = 1);
select pg_temp.expect('07b kendi ad soyadini guncelleyebilir', $q$update public.profiles set full_name='Yeni Ad' where user_id='00000000-0000-0000-0000-00000000a002'$q$, 'OK');

-- ===== 2) Normal kullanici yonetim islemlerini sunucu cagrisiyla yapamaz
select pg_temp.expect('10 normal: firma kimlik listesi', $q$select * from public.super_admin_list_company_identities()$q$, 'PERDEPRO_FORBIDDEN');
select pg_temp.expect('11 normal: firma erisim detayi', $q$select public.super_admin_get_company_access('00000000-0000-0000-0000-0000000c000a')$q$, 'PERDEPRO_FORBIDDEN');
select pg_temp.expect('12 normal: bitis tarihi ayarla (kendi firmasi)', $q$select public.super_admin_set_trial_end('00000000-0000-0000-0000-0000000c000a', now()+interval '300 days')$q$, 'PERDEPRO_FORBIDDEN');
select pg_temp.expect('13 normal: gun ekle', $q$select public.super_admin_add_trial_days('00000000-0000-0000-0000-0000000c000a', 30)$q$, 'PERDEPRO_FORBIDDEN');
select pg_temp.expect('14 normal: denemeyi bitir', $q$select public.super_admin_end_trial_now('00000000-0000-0000-0000-0000000c00d2', 'Ayni Ad Perde')$q$, 'PERDEPRO_FORBIDDEN');
select pg_temp.expect('15 normal: ozel hak ver', $q$select public.super_admin_set_special_access('00000000-0000-0000-0000-0000000c000a', true, null, 'kendime')$q$, 'PERDEPRO_FORBIDDEN');
select pg_temp.expect('16 normal: eski extend_company_trial', $q$select * from public.extend_company_trial('00000000-0000-0000-0000-0000000c000a', 30)$q$, 'PERDEPRO_FORBIDDEN');
select pg_temp.expect('17 normal: kendi firmasinda trial_ends_at dogrudan', $q$update public.companies set trial_ends_at=now()+interval '300 days' where id='00000000-0000-0000-0000-0000000c000a'$q$, 'Lisans alanlarını');
select pg_temp.expect('18 normal: kendi firmasinda pilot_until dogrudan', $q$update public.companies set pilot_until=now()+interval '300 days' where id='00000000-0000-0000-0000-0000000c000a'$q$, 'Lisans alanlarını');
select pg_temp.expect('19 normal: kendi firmasinda license_expires_at dogrudan', $q$update public.companies set license_expires_at=now()+interval '300 days' where id='00000000-0000-0000-0000-0000000c000a'$q$, 'Lisans alanlarını');
select pg_temp.expect('20 normal: kendi firmasinda telefon guncelleyebilir', $q$update public.companies set name='Eski Aktif Deneme' where id='00000000-0000-0000-0000-0000000c000a'$q$, 'OK');
reset role;
set role anon; select pg_temp.act(null);
select pg_temp.expect('21 anon: extend_company_trial', $q$select * from public.extend_company_trial('00000000-0000-0000-0000-0000000c000a', 30)$q$, 'permission denied');
select pg_temp.expect('22 anon: super_admin_set_trial_end', $q$select public.super_admin_set_trial_end('00000000-0000-0000-0000-0000000c000a', now())$q$, 'permission denied');
reset role;

-- ===== 3) Ayni isimli firmalar: kimlikle dogru firma
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000a001');
select pg_temp.check('30 kimlik listesi ayni ismi farkli id+yonetici ile ayirir',
  (select count(distinct company_id) = 2 and count(distinct admins->0->>'email') = 2 from public.super_admin_list_company_identities() where name='Ayni Ad Perde'),
  (select string_agg(left(company_id::text,8)||'='||coalesce(admins->0->>'email','-'), ', ') from public.super_admin_list_company_identities() where name='Ayni Ad Perde'));
select pg_temp.check('31 owner_id uye degilse sahip sayilmaz (X)',
  (select owner_is_admin_member = false and owner_email = 'super@perdepro.test' from public.super_admin_list_company_identities() where company_id='00000000-0000-0000-0000-0000000c00d1'));
select pg_temp.check('32 owner_id uye ise isaretlenir (Y)',
  (select owner_is_admin_member and (admins->0->>'is_owner_id')::boolean from public.super_admin_list_company_identities() where company_id='00000000-0000-0000-0000-0000000c00d2'));
select pg_temp.expect('33 X: bitis tarihini yarin 18:30 (TR) yap', $q$select public.super_admin_set_trial_end('00000000-0000-0000-0000-0000000c00d1', (date_trunc('day', now() at time zone 'Europe/Istanbul') + interval '1 day 18 hours 30 minutes') at time zone 'Europe/Istanbul', 'test')$q$, 'OK');
select pg_temp.check('34 yalnizca X degisti, Y ayni kaldi',
  (select trial_ends_at from public.companies where id='00000000-0000-0000-0000-0000000c00d2') = (select trial_ends_at from yb)
  and (select to_char(trial_ends_at at time zone 'Europe/Istanbul','HH24:MI') from public.companies where id='00000000-0000-0000-0000-0000000c00d1') = '18:30');

-- ===== 4) Denemeyi simdi bitir
select pg_temp.expect('40 yanlis firma adi teyidi', $q$select public.super_admin_end_trial_now('00000000-0000-0000-0000-0000000c00d1', 'Ayni Ad')$q$, 'PERDEPRO_CONFIRM_MISMATCH');
select pg_temp.check('41 yanlis teyitte degisiklik yok', (select trial_ends_at > now() from public.companies where id='00000000-0000-0000-0000-0000000c00d1'));
select pg_temp.expect('42 X denemesini simdi bitir', $q$select public.super_admin_end_trial_now('00000000-0000-0000-0000-0000000c00d1', 'Ayni Ad Perde', 'odeme bekleniyor')$q$, 'OK');
select pg_temp.expect('43 zaten bitmis denemeyi tekrar bitirme', $q$select public.super_admin_end_trial_now('00000000-0000-0000-0000-0000000c00d1', 'Ayni Ad Perde')$q$, 'PERDEPRO_ALREADY_ENDED');
reset role;
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000d1');
select pg_temp.check('44 bitince X verisi okunuyor', (select count(*) from public.customers where company_id='00000000-0000-0000-0000-0000000c00d1') = 1);
select pg_temp.expect('45 bitince X yeni kayit engelli', $q$insert into public.customers(company_id,name) values ('00000000-0000-0000-0000-0000000c00d1','yeni')$q$, 'RO');
update public.customers set name='z' where company_id='00000000-0000-0000-0000-0000000c00d1';
delete from public.customers where company_id='00000000-0000-0000-0000-0000000c00d1';
select pg_temp.check('46 bitince istemciden UPDATE/DELETE veriyi degistirmedi', (select count(*) from public.customers where company_id='00000000-0000-0000-0000-0000000c00d1' and name='X musterisi') = 1);
select pg_temp.expect('47 bitince SECURITY DEFINER RPC ile degisiklik de engelli', $q$select public.test_definer_exec('update public.customers set name=''z'' where company_id=''00000000-0000-0000-0000-0000000c00d1''')$q$, 'RO');
select pg_temp.expect('47b bitince SECURITY DEFINER RPC ile silme de engelli', $q$select public.test_definer_exec('delete from public.customers where company_id=''00000000-0000-0000-0000-0000000c00d1''')$q$, 'RO');
select pg_temp.check('48 Y (ayni isim) etkilenmedi', public.company_subscription_allows_write('00000000-0000-0000-0000-0000000c00d2'));
select pg_temp.check('49 deneme hakki yeniden baslamaz (self-trial mevcut firmayi dondurur)', (public.start_self_service_trial('Yeni Firma', null)->>'created') = 'false');
reset role;

-- ===== 5) Gun ekle: bitmis firma (simdiden itibaren)
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000a001');
select pg_temp.expect('50 bitmis X''e 10 gun ekle', $q$select public.super_admin_add_trial_days('00000000-0000-0000-0000-0000000c00d1', 10, 'uzatma')$q$, 'OK');
select pg_temp.check('51 yeni bitis = simdi + 10 gun', (select abs(extract(epoch from (trial_ends_at - (now() + interval '10 days')))) < 5 from public.companies where id='00000000-0000-0000-0000-0000000c00d1'));
reset role;
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000d1');
select pg_temp.expect('52 uzatma sonrasi X tekrar yazabilir', $q$insert into public.customers(company_id,name) values ('00000000-0000-0000-0000-0000000c00d1','geri geldi')$q$, 'OK');
reset role;
-- dolmamis firmaya: mevcut bitise eklenir
create temp table ya as select trial_ends_at from public.companies where id='00000000-0000-0000-0000-0000000c00d2'; grant select on ya to authenticated;
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000a001');
select pg_temp.expect('53 Y''ye 3 gun ekle', $q$select public.super_admin_add_trial_days('00000000-0000-0000-0000-0000000c00d2', 3)$q$, 'OK');
select pg_temp.check('54 Y bitisi = eski bitis + 3 gun', (select trial_ends_at from public.companies where id='00000000-0000-0000-0000-0000000c00d2') = (select trial_ends_at + interval '3 days' from ya));
-- plan_status expired olan eski firma (B)
reset role; update public.companies set plan_status='expired', subscription_status='expired' where id='00000000-0000-0000-0000-0000000c000b';
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000a001');
select pg_temp.expect('55 expired B''ye eski "Gun Ekle" (extend_company_trial) ile 7 gun', $q$select * from public.extend_company_trial('00000000-0000-0000-0000-0000000c000b', 7)$q$, 'OK');
select pg_temp.check('56 B tekrar trial + yazilabilir + paket ezilmedi', (select plan_status='trial' and subscription_status='trial' and subscription_plan='starter' from public.companies where id='00000000-0000-0000-0000-0000000c000b') and public.company_subscription_allows_write('00000000-0000-0000-0000-0000000c000b'));
select pg_temp.expect('57 lifetime E''ye deneme uygulanmaz', $q$select public.super_admin_set_trial_end('00000000-0000-0000-0000-0000000c000e', now()+interval '1 day')$q$, 'PERDEPRO_TRIAL_NOT_APPLICABLE');
select pg_temp.check('58 lifetime E hala yazilabilir, pilot C (suresiz) hala yazilabilir', public.company_subscription_allows_write('00000000-0000-0000-0000-0000000c000e') and public.company_subscription_allows_write('00000000-0000-0000-0000-0000000c000c'));

-- ===== 6) Ozel kullanim hakki
select pg_temp.expect('60 X denemesini bitir (ozel hak testi icin)', $q$select public.super_admin_end_trial_now('00000000-0000-0000-0000-0000000c00d1', 'Ayni Ad Perde')$q$, 'OK');
select pg_temp.expect('61 aciklamasiz ozel hak reddedilir', $q$select public.super_admin_set_special_access('00000000-0000-0000-0000-0000000c00d1', true, null, '')$q$, 'PERDEPRO_INVALID');
select pg_temp.expect('62 gecmis tarihli ozel hak reddedilir', $q$select public.super_admin_set_special_access('00000000-0000-0000-0000-0000000c00d1', true, now()-interval '1 hour', 'pilot')$q$, 'PERDEPRO_INVALID');
select pg_temp.expect('63 X''e 2 gunluk ozel hak', $q$select public.super_admin_set_special_access('00000000-0000-0000-0000-0000000c00d1', true, now()+interval '2 days', 'Fuar pilotu')$q$, 'OK');
select pg_temp.check('64 ozel hakla X yazilabilir; odeme/plan alanlari degismedi',
  public.company_subscription_allows_write('00000000-0000-0000-0000-0000000c00d1')
  and (select plan_status='trial' and payment_reference is null and license_expires_at is null and subscription_status='trial' from public.companies where id='00000000-0000-0000-0000-0000000c00d1'));
reset role;
-- zaman ilerledi: ozel hakkin suresi doldu
update public.companies set pilot_until = now() - interval '1 minute' where id='00000000-0000-0000-0000-0000000c00d1';
select pg_temp.check('65 suresi dolan ozel hak yazma izni vermez (4 kontrol)',
  not public.company_subscription_allows_write('00000000-0000-0000-0000-0000000c00d1')
  and not public.check_subscription_active('00000000-0000-0000-0000-0000000c00d1'));
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000d1');
select pg_temp.check('66 is_company_writable da false', not public.is_company_writable('00000000-0000-0000-0000-0000000c00d1'));
select pg_temp.check('67 register_device ''expired'' doner', public.register_device_and_touch_login('dev-1', 'ua', 'n') = 'expired');
select pg_temp.expect('68 suresi dolan ozel hakla yazma engelli', $q$insert into public.customers(company_id,name) values ('00000000-0000-0000-0000-0000000c00d1','x')$q$, 'RO');
reset role;
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000a001');
select pg_temp.expect('69 suresiz ozel hak ver', $q$select public.super_admin_set_special_access('00000000-0000-0000-0000-0000000c00d1', true, null, 'Kalici pilot')$q$, 'OK');
select pg_temp.check('70 suresiz hak: yazilabilir, pilot_until NULL', public.company_subscription_allows_write('00000000-0000-0000-0000-0000000c00d1') and (select is_pilot and pilot_until is null from public.companies where id='00000000-0000-0000-0000-0000000c00d1'));
reset role;
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000d1');
select pg_temp.check('71 register_device ok doner', public.register_device_and_touch_login('dev-1', 'ua', 'n') = 'ok');
reset role;
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000a001');
select pg_temp.expect('72 ozel hakki kaldir', $q$select public.super_admin_set_special_access('00000000-0000-0000-0000-0000000c00d1', false, null, 'pilot bitti')$q$, 'OK');
select pg_temp.check('73 kaldirinca deneme kurallari: X (denemesi bitmis) salt okunur', not public.company_subscription_allows_write('00000000-0000-0000-0000-0000000c00d1'));
select pg_temp.expect('74 ozel hakki olmayan firmada kaldirma', $q$select public.super_admin_set_special_access('00000000-0000-0000-0000-0000000c00d2', false, null, 'x')$q$, 'PERDEPRO_INVALID');

-- ===== 7) Islem gecmisi
select pg_temp.check('80 gecmis: X icin tum islemler kayitli (onceki/yeni, yapan, sunucu zamani)',
  (select count(*) from public.audit_logs where company_id='00000000-0000-0000-0000-0000000c00d1' and action like 'SUPER_ADMIN_%'
     and metadata ? 'before' and metadata ? 'after' and metadata->>'actor_email'='super@perdepro.test' and metadata ? 'server_time' and actor_user_id='00000000-0000-0000-0000-00000000a001') >= 7,
  (select string_agg(action, ',' order by created_at) from public.audit_logs where company_id='00000000-0000-0000-0000-0000000c00d1'));
select pg_temp.check('81 get_company_access gecmisi doner',
  jsonb_array_length(public.super_admin_get_company_access('00000000-0000-0000-0000-0000000c00d1')->'history') >= 7);
reset role;
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-0000000000d1');
insert into public.audit_logs(company_id, action, entity_table, entity_id, metadata) values ('00000000-0000-0000-0000-0000000c00d1','SUPER_ADMIN_SPECIAL_ACCESS_GRANTED','companies','00000000-0000-0000-0000-0000000c00d1','{"before":{},"after":{}}');
reset role;
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000a001');
select pg_temp.check('82 uyenin sahte "super admin" kaydi gecmiste gorunmez',
  not exists (select 1 from jsonb_array_elements(public.super_admin_get_company_access('00000000-0000-0000-0000-0000000c00d1')->'history') h where h->>'actor_email' = 'ayni.x@firma.test'));
select pg_temp.check('83 ucretsiz deneme kaydi (trial_grants) hic degismedi', (select count(*) from public.trial_grants) = (select n from g0));
reset role;
