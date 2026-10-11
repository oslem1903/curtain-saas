-- ESKI handle_new_user ile acik: metadata role=super_admin
insert into auth.users(id,email,raw_user_meta_data) values ('00000000-0000-0000-0000-00000000bad1','attacker1@evil.test','{"role":"super_admin"}');
select 'ONCE (eski trigger) attacker1 rol' as test, role from public.profiles where user_id='00000000-0000-0000-0000-00000000bad1';
