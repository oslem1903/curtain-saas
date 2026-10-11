\pset footer off
\pset tuples_only on
create or replace function pg_temp.act(p uuid) returns void language sql as $$ select set_config('request.jwt.claim.sub', coalesce(p::text,''), false) $$;
-- Herhangi bir SECURITY DEFINER RPC'yi taklit eder (RLS'i atlar, postgres sahibi)
create or replace function public.test_definer_exec(p_sql text) returns void language plpgsql security definer set search_path = public as $$ begin execute p_sql; end $$;
grant execute on function public.test_definer_exec(text) to authenticated;
create or replace function pg_temp.expect(p_name text, p_sql text, p_code text) returns text language plpgsql as $$
begin
  execute p_sql;
  if p_code = 'OK' then return 'PASS ' || p_name; end if;
  return 'FAIL ' || p_name || ' (beklenen ' || p_code || ', ama izin verildi)';
exception when others then
  if p_code <> 'OK' and (sqlerrm like p_code || '%' or (p_code = 'PERDEPRO_SUBSCRIPTION_READ_ONLY' and sqlerrm = 'Firma lisansı aktif değil veya sadece okuma modunda.')) then return 'PASS ' || p_name || '  [' || p_code || ']'; end if;
  return 'FAIL ' || p_name || ' -> ' || sqlerrm;
end $$;
grant execute on all functions in schema pg_temp to authenticated;

-- ---------- Hazirlik (mevcut orders tetikleyicisi oturumsuz yazimi reddettigi icin super admin olarak)
select pg_temp.act('00000000-0000-0000-0000-00000000a001');
insert into auth.users(id, email, email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000c000a','firma-a-legacy@x.test',now()),
 ('00000000-0000-0000-0000-0000000c000b','firma-b-legacy@x.test',now()),
 ('00000000-0000-0000-0000-0000000c000c','firma-p-legacy@x.test',now()),
 ('00000000-0000-0000-0000-0000000c000e','firma-l-legacy@x.test',now()),
 ('99999999-0000-0000-0000-000000000001','sadece-kullanici@x.test',now());
insert into public.orders(id, company_id, total) values ('0a000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000c000a',1),('0b000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000c000b',1);
insert into public.suppliers(id, company_id, name) values ('5a000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000c000a','A'),('5b000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000c000b','B');
insert into public.appointments(id, company_id) values ('a0000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000c000a'),('a0000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000c000b');
insert into public.catalog_collections(id, company_id) values ('cc000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000c000a'),('cc000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000c000b');
insert into public.catalog_items(id, company_id, collection_id) values ('c1000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000c000a','cc000000-0000-0000-0000-00000000000a'),('c1000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000c000b','cc000000-0000-0000-0000-00000000000b');
insert into public.accounts(id, company_id, name) values ('ac000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000c000a','Kasa A'),('ac000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000c000b','Kasa B'),('ac000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-0000000c000c','Kasa P'),('ac000000-0000-0000-0000-00000000000e','00000000-0000-0000-0000-0000000c000e','Kasa L');
insert into public.expense_categories(id, company_id, name) values ('ec000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000c000a','A'),('ec000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000c000b','B');
insert into public.income_categories(id, company_id, name) values ('1c000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-0000000c000a','A'),('1c000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000c000b','B');
insert into public.appointment_assignees(id, appointment_id, staff_user_id, company_id) values ('aa000000-0000-0000-0000-00000000000b','a0000000-0000-0000-0000-00000000000b',gen_random_uuid(),'00000000-0000-0000-0000-0000000c000b');
insert into public.supplier_work_orders(id, company_id, supplier_id, order_id) values ('50000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-0000000c000b','5b000000-0000-0000-0000-00000000000b','0b000000-0000-0000-0000-00000000000b');
select pg_temp.act(null);
insert into public.supplier_work_orders(id, company_id, note) values ('50000000-0000-0000-0000-0000000000ff', null, 'yetim (bakim ile eklendi)');
insert into public.installer_payments(company_id, installer_id, order_id, amount) values ('00000000-0000-0000-0000-0000000c000a', gen_random_uuid(), '0a000000-0000-0000-0000-00000000000a', 5);
select 'PASS 00 oturumsuz bakim yazimi muaf (isletmesiz yetim satir dahil)';

-- ========== AKTIF DENEME: A yoneticisi, SECURITY DEFINER RPC uzerinden
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000a002');
select pg_temp.expect('01 accounts guncelle (RPC)', $q$select public.rpc_set_account_name('ac000000-0000-0000-0000-00000000000a','Kasa A2')$q$, 'OK');
select pg_temp.expect('02 is emri: company+tedarikci+siparis ayni firma', $q$select public.rpc_add_work_order('00000000-0000-0000-0000-0000000c000a','5a000000-0000-0000-0000-00000000000a','0a000000-0000-0000-0000-00000000000a',10)$q$, 'OK');
select pg_temp.expect('03 is emri: company NULL, ust kayitlardan A', $q$select public.rpc_add_work_order(null,'5a000000-0000-0000-0000-00000000000a','0a000000-0000-0000-0000-00000000000a',10)$q$, 'OK');
select pg_temp.expect('03b company_id ust kayittan dolduruldu', $q$select public.test_definer_exec('do $x$ begin if exists (select 1 from public.supplier_work_orders where company_id is null and supplier_id is not null) then raise exception ''doldurulmadi''; end if; end $x$')$q$, 'OK');
select pg_temp.expect('04 is emri: company A + tedarikci B', $q$select public.rpc_add_work_order('00000000-0000-0000-0000-0000000c000a','5b000000-0000-0000-0000-00000000000b',null,10)$q$, 'PERDEPRO_COMPANY_MISMATCH');
select pg_temp.expect('05 is emri: company NULL, siparis A + tedarikci B', $q$select public.rpc_add_work_order(null,'5b000000-0000-0000-0000-00000000000b','0a000000-0000-0000-0000-00000000000a',10)$q$, 'PERDEPRO_COMPANY_MISMATCH');
select pg_temp.expect('06 is emri: hicbir baglanti yok', $q$select public.rpc_add_work_order(null,null,null,10)$q$, 'PERDEPRO_COMPANY_UNRESOLVED');
select pg_temp.expect('07 is emri: baska firma (B) company_id', $q$select public.rpc_add_work_order('00000000-0000-0000-0000-0000000c000b',null,null,10)$q$, 'PERDEPRO_COMPANY_FORBIDDEN');
select pg_temp.expect('08 is emri: yalnizca B tedarikcisi', $q$select public.rpc_add_work_order(null,'5b000000-0000-0000-0000-00000000000b',null,10)$q$, 'PERDEPRO_COMPANY_FORBIDDEN');
select pg_temp.expect('09 montajci odemesi: company NULL, siparis A', $q$select public.rpc_add_installer_payment(null,'0a000000-0000-0000-0000-00000000000a',5)$q$, 'OK');
select pg_temp.expect('10 montajci odemesi: hicbir baglanti yok', $q$select public.rpc_add_installer_payment(null,null,5)$q$, 'PERDEPRO_COMPANY_UNRESOLVED');
select pg_temp.expect('11 montajci odemesi: olmayan siparis', $q$select public.rpc_add_installer_payment(null,'0f000000-0000-0000-0000-0000000000ff',5)$q$, 'PERDEPRO_COMPANY_UNRESOLVED');
select pg_temp.expect('12 katalog urunu: A + kartela yok', $q$select public.test_definer_exec('insert into public.catalog_items(company_id) values (''00000000-0000-0000-0000-0000000c000a'')')$q$, 'OK');
select pg_temp.expect('13 katalog urunu: A + B kartelasi', $q$select public.test_definer_exec('insert into public.catalog_items(company_id, collection_id) values (''00000000-0000-0000-0000-0000000c000a'',''cc000000-0000-0000-0000-00000000000b'')')$q$, 'PERDEPRO_COMPANY_MISMATCH');
select pg_temp.expect('14 randevu atamasi: A randevusu', $q$select public.test_definer_exec('insert into public.appointment_assignees(appointment_id, staff_user_id, company_id) values (''a0000000-0000-0000-0000-00000000000a'', gen_random_uuid(), ''00000000-0000-0000-0000-0000000c000a'')')$q$, 'OK');
select pg_temp.expect('15 randevu atamasi: A company + B randevusu', $q$select public.test_definer_exec('insert into public.appointment_assignees(appointment_id, staff_user_id, company_id) values (''a0000000-0000-0000-0000-00000000000b'', gen_random_uuid(), ''00000000-0000-0000-0000-0000000c000a'')')$q$, 'PERDEPRO_COMPANY_MISMATCH');
select pg_temp.expect('16 hesap: company_id isletme degil (yalnizca kullanici id)', $q$select public.test_definer_exec('insert into public.accounts(company_id, name) values (''99999999-0000-0000-0000-000000000001'',''x'')')$q$, 'PERDEPRO_COMPANY_UNRESOLVED');
select pg_temp.expect('17 gider kategorisi sil (RPC, A)', $q$select public.test_definer_exec('insert into public.expense_categories(id, company_id, name) values (''ec000000-0000-0000-0000-0000000000a2'',''00000000-0000-0000-0000-0000000c000a'',''gecici'')'); select public.rpc_delete_category('ec000000-0000-0000-0000-0000000000a2')$q$, 'OK');
select pg_temp.expect('18 gelir kategorisi guncelle (A)', $q$select public.test_definer_exec('update public.income_categories set name=''A2'' where company_id=''00000000-0000-0000-0000-0000000c000a''')$q$, 'OK');
select pg_temp.expect('19 kartela ekle (A)', $q$select public.test_definer_exec('insert into public.catalog_collections(company_id) values (''00000000-0000-0000-0000-0000000c000a'')')$q$, 'OK');
select pg_temp.expect('20 isletmesiz yetim satiri silme (normal kullanici)', $q$select public.test_definer_exec('delete from public.supplier_work_orders where id=''50000000-0000-0000-0000-0000000000ff''')$q$, 'PERDEPRO_COMPANY_UNRESOLVED');
select pg_temp.expect('21 A siparisi silinince bagli is emri cascade, odeme set null', $q$select public.test_definer_exec('delete from public.orders where id=''0a000000-0000-0000-0000-00000000000a''')$q$, 'OK');
reset role;
select case when (select count(*) from public.supplier_work_orders where order_id='0a000000-0000-0000-0000-00000000000a')=0
             and (select count(*) from public.installer_payments where company_id='00000000-0000-0000-0000-0000000c000a' and order_id is null) >= 2
       then 'PASS 22 cascade/set null sonuclari dogru' else 'FAIL 22 cascade/set null' end;

-- ========== SURESI DOLMUS: B yoneticisi (RPC uzerinden de engellenmeli; okuma serbest)
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000a003');
select pg_temp.expect('30 B hesap guncelle (RPC)', $q$select public.rpc_set_account_name('ac000000-0000-0000-0000-00000000000b','x')$q$, 'PERDEPRO_SUBSCRIPTION_READ_ONLY');
select pg_temp.expect('31 B is emri ekle (RPC)', $q$select public.rpc_add_work_order('00000000-0000-0000-0000-0000000c000b','5b000000-0000-0000-0000-00000000000b','0b000000-0000-0000-0000-00000000000b',1)$q$, 'PERDEPRO_SUBSCRIPTION_READ_ONLY');
select pg_temp.expect('32 B is emri: company NULL, ust kayitlardan B', $q$select public.rpc_add_work_order(null,'5b000000-0000-0000-0000-00000000000b',null,1)$q$, 'PERDEPRO_SUBSCRIPTION_READ_ONLY');
select pg_temp.expect('33 B montajci odemesi (RPC)', $q$select public.rpc_add_installer_payment(null,'0b000000-0000-0000-0000-00000000000b',1)$q$, 'PERDEPRO_SUBSCRIPTION_READ_ONLY');
select pg_temp.expect('34 B kategori sil (RPC)', $q$select public.rpc_delete_category('ec000000-0000-0000-0000-00000000000b')$q$, 'PERDEPRO_SUBSCRIPTION_READ_ONLY');
select pg_temp.expect('35 B gelir kategorisi guncelle', $q$select public.test_definer_exec('update public.income_categories set name=''x'' where company_id=''00000000-0000-0000-0000-0000000c000b''')$q$, 'PERDEPRO_SUBSCRIPTION_READ_ONLY');
select pg_temp.expect('36 B katalog urunu guncelle', $q$select public.test_definer_exec('update public.catalog_items set series_code=''x'' where id=''c1000000-0000-0000-0000-00000000000b''')$q$, 'PERDEPRO_SUBSCRIPTION_READ_ONLY');
select pg_temp.expect('37 B kartela sil', $q$select public.test_definer_exec('delete from public.catalog_collections where id=''cc000000-0000-0000-0000-00000000000b''')$q$, 'PERDEPRO_SUBSCRIPTION_READ_ONLY');
select pg_temp.expect('38 B randevu atamasi sil', $q$select public.test_definer_exec('delete from public.appointment_assignees where id=''aa000000-0000-0000-0000-00000000000b''')$q$, 'PERDEPRO_SUBSCRIPTION_READ_ONLY');
select pg_temp.expect('39 B siparis ekle (024 korumasi, RPC)', $q$select public.rpc_add_order('00000000-0000-0000-0000-0000000c000b')$q$, 'PERDEPRO_SUBSCRIPTION_READ_ONLY');
select pg_temp.expect('40 B kaydini A firmasina tasima (UPDATE company_id)', $q$select public.test_definer_exec('update public.expense_categories set company_id=''00000000-0000-0000-0000-0000000c000a'' where id=''ec000000-0000-0000-0000-00000000000b''')$q$, 'PERDEPRO_COMPANY_FORBIDDEN');
reset role;
select pg_temp.act(null);
select 'INFO 41 B verileri duruyor: hesap=' || (select count(*) from public.accounts where company_id='00000000-0000-0000-0000-0000000c000b')
  || ' kategori=' || (select count(*) from public.expense_categories where company_id='00000000-0000-0000-0000-0000000c000b')
  || ' is_emri=' || (select count(*) from public.supplier_work_orders where company_id='00000000-0000-0000-0000-0000000c000b')
  || ' katalog=' || (select count(*) from public.catalog_items where company_id='00000000-0000-0000-0000-0000000c000b');

-- ========== SUPER ADMIN: abonelikten muaf, butunluk kurallarindan muaf degil
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000a001');
select pg_temp.expect('50 super admin suresi dolmus B hesabini guncelle', $q$select public.rpc_set_account_name('ac000000-0000-0000-0000-00000000000b','Kasa B')$q$, 'OK');
select pg_temp.expect('51 super admin B is emri ekle', $q$select public.rpc_add_work_order(null,'5b000000-0000-0000-0000-00000000000b','0b000000-0000-0000-0000-00000000000b',1)$q$, 'OK');
select pg_temp.expect('52 super admin de capraz firma baglayamaz', $q$select public.rpc_add_work_order('00000000-0000-0000-0000-0000000c000a','5b000000-0000-0000-0000-00000000000b',null,1)$q$, 'PERDEPRO_COMPANY_MISMATCH');
select pg_temp.expect('53 super admin de isletmesiz kayit ekleyemez', $q$select public.rpc_add_installer_payment(null,null,1)$q$, 'PERDEPRO_COMPANY_UNRESOLVED');
select pg_temp.expect('54 super admin yetim satiri temizleyebilir', $q$select public.test_definer_exec('delete from public.supplier_work_orders where id=''50000000-0000-0000-0000-0000000000ff''')$q$, 'OK');
reset role;

-- ========== Pilot ve lifetime etkilenmez
set role authenticated; select pg_temp.act('00000000-0000-0000-0000-00000000a004');
select pg_temp.expect('60 pilot (tarih NULL) hesap guncelle', $q$select public.rpc_set_account_name('ac000000-0000-0000-0000-00000000000c','P2')$q$, 'OK');
select pg_temp.act('00000000-0000-0000-0000-00000000a006');
select pg_temp.expect('61 lifetime hesap guncelle', $q$select public.rpc_set_account_name('ac000000-0000-0000-0000-00000000000e','L2')$q$, 'OK');
reset role;
select case when has_function_privilege('authenticated','public.guard_resolve_row_company(text,jsonb,text[],boolean)','EXECUTE') then 'FAIL 62 cozumleyici disaridan cagrilabiliyor' else 'PASS 62 cozumleyici disaridan cagrilamaz' end;
reset role;
