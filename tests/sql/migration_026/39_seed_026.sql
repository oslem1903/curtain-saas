-- Ayni isimli iki firma + personel
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000a001',false);
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-0000000000d1','ayni.x@firma.test',now()),
 ('00000000-0000-0000-0000-0000000000d2','ayni.y@firma.test',now()),
 ('00000000-0000-0000-0000-0000000000d3','montajci.a@firma.test',now());
update public.profiles set role='admin' where user_id in ('00000000-0000-0000-0000-0000000000d1','00000000-0000-0000-0000-0000000000d2');
insert into public.companies(id,name,plan_status,subscription_plan,package_code,trial_ends_at,trial_start,is_pilot,owner_id,onboarding_completed) values
 ('00000000-0000-0000-0000-0000000c00d1','Ayni Ad Perde','trial','solo','solo',now()+interval '5 days',now()-interval '2 days',false,'00000000-0000-0000-0000-00000000a001',true),
 ('00000000-0000-0000-0000-0000000c00d2','Ayni Ad Perde','trial','solo','solo',now()+interval '5 days',now()-interval '2 days',false,'00000000-0000-0000-0000-0000000000d2',true);
insert into public.company_members(company_id,user_id,role) values
 ('00000000-0000-0000-0000-0000000c00d1','00000000-0000-0000-0000-0000000000d1','admin'),
 ('00000000-0000-0000-0000-0000000c00d2','00000000-0000-0000-0000-0000000000d2','admin'),
 ('00000000-0000-0000-0000-0000000c000a','00000000-0000-0000-0000-0000000000d3','installer');
insert into public.customers(company_id,name) values ('00000000-0000-0000-0000-0000000c00d1','X musterisi'),('00000000-0000-0000-0000-0000000c00d2','Y musterisi');
select set_config('request.jwt.claim.sub','',false);
