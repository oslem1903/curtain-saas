\pset tuples_only on
-- 026 ONCESI: canlidaki aciklarin yerel tekrari
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000a002',false);
update public.profiles set role='super_admin' where user_id='00000000-0000-0000-0000-00000000a002';
select 'ONCE: kendini super_admin yapabildi mi = ' || (select role='super_admin' from public.profiles where user_id='00000000-0000-0000-0000-00000000a002');
reset role;
update public.profiles set role='admin' where user_id='00000000-0000-0000-0000-00000000a002';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000a002',false);
insert into public.company_members(company_id,user_id,role) values ('00000000-0000-0000-0000-0000000c00d2','00000000-0000-0000-0000-00000000a002','admin');
select 'ONCE: baska firmaya kendini admin ekleyebildi mi = ' || exists(select 1 from public.company_members where user_id='00000000-0000-0000-0000-00000000a002' and company_id='00000000-0000-0000-0000-0000000c00d2');
reset role;
delete from public.company_members where user_id='00000000-0000-0000-0000-00000000a002' and company_id='00000000-0000-0000-0000-0000000c00d2';
