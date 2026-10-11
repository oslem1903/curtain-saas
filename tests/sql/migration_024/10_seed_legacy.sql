-- Eski durum: migration oncesi veriler
insert into auth.users(id,email,email_confirmed_at) values
 ('00000000-0000-0000-0000-00000000a001','super@perdepro.test',now()),
 ('00000000-0000-0000-0000-00000000a002','legacy.admin@a.test',now()),
 ('00000000-0000-0000-0000-00000000a003','expired.admin@b.test',now()),
 ('00000000-0000-0000-0000-00000000a004','pilot.admin@p.test',now()),
 ('00000000-0000-0000-0000-00000000a005','removed.admin@x.test',now()),
 ('00000000-0000-0000-0000-00000000a006','paid.admin@l.test',now());
update public.profiles set role='super_admin' where user_id='00000000-0000-0000-0000-00000000a001';
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-00000000a001',false);
update public.profiles set role='admin' where user_id in ('00000000-0000-0000-0000-00000000a002','00000000-0000-0000-0000-00000000a003','00000000-0000-0000-0000-00000000a004','00000000-0000-0000-0000-00000000a006');
insert into public.companies(id,name,plan_status,subscription_plan,trial_ends_at,trial_start,is_pilot,onboarding_completed) values
 ('00000000-0000-0000-0000-0000000c000a','Eski Aktif Deneme','trial','starter',now()+interval '3 days',now()-interval '4 days',false,true),
 ('00000000-0000-0000-0000-0000000c000b','Eski Suresi Dolmus','trial','starter',now()-interval '2 days',now()-interval '9 days',false,true),
 ('00000000-0000-0000-0000-0000000c000c','Pilot Firma','trial','starter',null,null,true,true),
 ('00000000-0000-0000-0000-0000000c000d','Silinecek Firma','trial','starter',now()-interval '30 days',now()-interval '37 days',false,true),
 ('00000000-0000-0000-0000-0000000c000e','Lisansli Firma','lifetime','lifetime',null,null,false,true);
insert into public.company_members(company_id,user_id,role) values
 ('00000000-0000-0000-0000-0000000c000a','00000000-0000-0000-0000-00000000a002','admin'),
 ('00000000-0000-0000-0000-0000000c000b','00000000-0000-0000-0000-00000000a003','admin'),
 ('00000000-0000-0000-0000-0000000c000c','00000000-0000-0000-0000-00000000a004','admin'),
 ('00000000-0000-0000-0000-0000000c000d','00000000-0000-0000-0000-00000000a005','admin'),
 ('00000000-0000-0000-0000-0000000c000e','00000000-0000-0000-0000-00000000a006','admin');
insert into public.customers(company_id,name) values
 ('00000000-0000-0000-0000-0000000c000a','A musterisi'),('00000000-0000-0000-0000-0000000c000b','B musterisi'),
 ('00000000-0000-0000-0000-0000000c000c','P musterisi'),('00000000-0000-0000-0000-0000000c000e','L musterisi');
-- eski firmadaki uyeligi kaldirilmis yonetici (firma uyeligi silinir ama trial grant backfill'i oncesinde)
-- (backfill uyelik uzerinden yapildigi icin bu kullaniciyi migration SONRASI kaldiriyoruz, asagida)

select set_config('request.jwt.claim.sub','',false);
