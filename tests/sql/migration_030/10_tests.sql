-- LOCAL TEST DATABASE ONLY. 030 sonrasi: super-admin atama, bekleyen davet, yetki ve izolasyon.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.ok(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE FUNCTION pg_temp.err(stmt text, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN
    IF position(expected IN sqlerrm) > 0 THEN RAISE NOTICE 'PASS rejects: %', expected; RETURN; END IF;
    RAISE EXCEPTION 'Unexpected error: % (expected %)', sqlerrm, expected;
  END;
  RAISE EXCEPTION 'FAIL: expected rejection %', expected;
END $$;
-- kullanicilar: 01 super admin, 02 mevcut dogrulanmis (installer profil, uyeliksiz), 03 baska firmada,
-- 04 dogrulanmamis hesap, 05 baska firmada firma admini (yetkisiz), 06 ikinci super admin
INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES
('30000000-0000-0000-0000-000000000001','sa@example.test',now(),'{}'),
('30000000-0000-0000-0000-000000000002','Hulya@Example.Test',now(),'{"full_name":"Hulya"}'),
('30000000-0000-0000-0000-000000000003','other@example.test',now(),'{}'),
('30000000-0000-0000-0000-000000000004','pend@example.test',NULL,'{}'),
('30000000-0000-0000-0000-000000000005','adm@example.test',now(),'{}'),
('30000000-0000-0000-0000-000000000006','sa2@example.test',now(),'{}');
INSERT INTO public.companies(id,name,plan_status,max_users) VALUES
('30000000-0000-0000-0000-000000000101','Storing Tekstil Test','active',5),
('30000000-0000-0000-0000-000000000102','Baska Firma','active',5);
INSERT INTO public.profiles(user_id,email,full_name,role,is_active) VALUES
('30000000-0000-0000-0000-000000000001','sa@example.test','SA','super_admin',true),
('30000000-0000-0000-0000-000000000002','hulya@example.test','Hulya','installer',true),
('30000000-0000-0000-0000-000000000003','other@example.test','Other','admin',true),
('30000000-0000-0000-0000-000000000005','adm@example.test','Adm','admin',true),
('30000000-0000-0000-0000-000000000006','sa2@example.test','SA2','super_admin',true)
ON CONFLICT (user_id) DO UPDATE SET role=excluded.role;
INSERT INTO public.company_members(company_id,user_id,role,is_active) VALUES
('30000000-0000-0000-0000-000000000102','30000000-0000-0000-0000-000000000003','admin',true),
('30000000-0000-0000-0000-000000000102','30000000-0000-0000-0000-000000000005','admin',true);

-- 1) yetkisiz: firma admini ve anon kullanici baglayamaz
SELECT set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000005',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.err($q$SELECT public.super_admin_assign_user_to_company('hulya@example.test','30000000-0000-0000-0000-000000000101','admin')$q$,'PERDEPRO_FORBIDDEN');
SELECT pg_temp.err($q$SELECT public.super_admin_link_company_user('30000000-0000-0000-0000-000000000101','30000000-0000-0000-0000-000000000002','admin')$q$,'PERDEPRO_FORBIDDEN');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT pg_temp.err($q$SELECT public.super_admin_assign_user_to_company('hulya@example.test','30000000-0000-0000-0000-000000000101','admin')$q$,'permission denied');
RESET ROLE;
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM company_members WHERE user_id='30000000-0000-0000-0000-000000000002'),'unauthorized caller created no membership');

-- 2) super admin: zorunlu alanlar
SELECT set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.err($q$SELECT public.super_admin_assign_user_to_company('','30000000-0000-0000-0000-000000000101','admin')$q$,'Gecerli e-posta');
SELECT pg_temp.err($q$SELECT public.super_admin_assign_user_to_company('a@b.co',NULL,'admin')$q$,'Firma secilmeden');
SELECT pg_temp.err($q$SELECT public.super_admin_assign_user_to_company('a@b.co','30000000-0000-0000-0000-000000000101','')$q$,'Gecersiz firma rolu');
SELECT pg_temp.err($q$SELECT public.super_admin_assign_user_to_company('a@b.co','30000000-0000-0000-0000-000000000101','super_admin')$q$,'Gecersiz firma rolu');
SELECT pg_temp.err($q$SELECT public.super_admin_assign_user_to_company('a@b.co','30000000-0000-0000-0000-0000000009ff','admin')$q$,'Firma bulunamadi');
RESET ROLE;

-- 3) mevcut kullanici: bosluklu/buyuk harfli e-posta; sifre ve auth kullanicisi degismez
CREATE TEMP TABLE pw_before AS SELECT id,encrypted_password,created_at FROM auth.users WHERE id='30000000-0000-0000-0000-000000000002';
GRANT SELECT ON pw_before TO PUBLIC;
SET LOCAL ROLE authenticated;
SELECT public.super_admin_assign_user_to_company('  HULYA@example.test ','30000000-0000-0000-0000-000000000101','admin') AS r \gset
RESET ROLE;
SELECT pg_temp.ok(:'r'::jsonb->>'status'='linked','existing verified user linked');
SELECT pg_temp.ok((SELECT count(*)=1 FROM company_members WHERE user_id='30000000-0000-0000-0000-000000000002' AND company_id='30000000-0000-0000-0000-000000000101' AND role='admin' AND is_active),'membership admin in selected company by id');
SELECT pg_temp.ok((SELECT role='admin' FROM profiles WHERE user_id='30000000-0000-0000-0000-000000000002'),'profile role aligned (not super_admin)');
SELECT pg_temp.ok((SELECT count(*)=1 FROM auth.users u JOIN pw_before b ON b.id=u.id WHERE u.encrypted_password IS NOT DISTINCT FROM b.encrypted_password AND u.created_at=b.created_at),'auth user and password untouched');
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM user_invites WHERE lower(email)='hulya@example.test'),'no invite created for existing user');

-- 4) tekrar: mukerrer uyelik yok
SET LOCAL ROLE authenticated;
SELECT public.super_admin_assign_user_to_company('hulya@example.test','30000000-0000-0000-0000-000000000101','admin') AS r2 \gset
SELECT public.super_admin_link_company_user('30000000-0000-0000-0000-000000000101','30000000-0000-0000-0000-000000000002','admin');
RESET ROLE;
SELECT pg_temp.ok(:'r2'::jsonb->>'status'='already_member','repeat is idempotent');
SELECT pg_temp.ok((SELECT count(*)=1 FROM company_members WHERE user_id='30000000-0000-0000-0000-000000000002'),'still exactly one membership');

-- 5) baska firma uyeligi: onay istenir, tasinmaz/silinmez, profil rolu bozulmaz
SET LOCAL ROLE authenticated;
SELECT public.super_admin_assign_user_to_company('other@example.test','30000000-0000-0000-0000-000000000101','accountant') AS r3 \gset
RESET ROLE;
SELECT pg_temp.ok(:'r3'::jsonb->>'status'='requires_confirmation' AND jsonb_array_length(:'r3'::jsonb->'existing_memberships')=1,'other membership requires confirmation and is listed');
SELECT pg_temp.ok((SELECT count(*)=1 FROM company_members WHERE user_id='30000000-0000-0000-0000-000000000003' AND company_id='30000000-0000-0000-0000-000000000102' AND role='admin'),'other membership untouched');
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM company_members WHERE user_id='30000000-0000-0000-0000-000000000003' AND company_id='30000000-0000-0000-0000-000000000101'),'no membership before confirmation');
SET LOCAL ROLE authenticated;
SELECT public.super_admin_assign_user_to_company('other@example.test','30000000-0000-0000-0000-000000000101','accountant',true) AS r4 \gset
RESET ROLE;
SELECT pg_temp.ok(:'r4'::jsonb->>'status'='linked','confirmed link adds membership');
SELECT pg_temp.ok((SELECT count(*)=2 FROM company_members WHERE user_id='30000000-0000-0000-0000-000000000003' AND is_active),'both memberships kept');
SELECT pg_temp.ok((SELECT role='admin' FROM profiles WHERE user_id='30000000-0000-0000-0000-000000000003'),'profile role not changed when other memberships exist');

-- 6) super_admin hesabi firma kullanicisi yapilamaz
SET LOCAL ROLE authenticated;
SELECT pg_temp.err($q$SELECT public.super_admin_assign_user_to_company('sa2@example.test','30000000-0000-0000-0000-000000000101','admin')$q$,'Super admin hesabi');
RESET ROLE;

-- 7) hesap yok: bekleyen davet, uyelik yok, tekrar ayni davet
SET LOCAL ROLE authenticated;
SELECT public.super_admin_assign_user_to_company('New.User@Example.Test ','30000000-0000-0000-0000-000000000101','installer') AS r5 \gset
SELECT public.super_admin_assign_user_to_company('new.user@example.test','30000000-0000-0000-0000-000000000101','installer') AS r6 \gset
RESET ROLE;
SELECT pg_temp.ok(:'r5'::jsonb->>'status'='invited' AND :'r5'::jsonb->>'reused'='false','pending invite created for unknown email');
SELECT pg_temp.ok(:'r6'::jsonb->>'reused'='true' AND :'r6'::jsonb->>'invite_id'=:'r5'::jsonb->>'invite_id','repeat reuses same invite');
SELECT pg_temp.ok((SELECT count(*)=1 FROM user_invites WHERE email='new.user@example.test'),'exactly one invite row');
SELECT pg_temp.ok((SELECT company_id='30000000-0000-0000-0000-000000000101' FROM user_invites WHERE email='new.user@example.test'),'invite stores selected company id');

-- 8) dogrulanmamis mevcut hesap: erisim verilmez, davet tutulur
SET LOCAL ROLE authenticated;
SELECT public.super_admin_assign_user_to_company('pend@example.test','30000000-0000-0000-0000-000000000101','measurement') AS r7 \gset
RESET ROLE;
SELECT pg_temp.ok(:'r7'::jsonb->>'status'='invited' AND :'r7'::jsonb->>'account_exists'='true','unverified account gets pending invite only');
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM company_members WHERE user_id='30000000-0000-0000-0000-000000000004'),'no access before verification');

-- 9) claim: dogrulanmamis hesap erisim alamaz; dogrulaninca kodsuz uyelik, tekrar mukerrer yaratmaz
SELECT set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000004',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.err($q$SELECT * FROM claim_pending_invites_for_current_user()$q$,'EMAIL_NOT_VERIFIED');
RESET ROLE;
UPDATE auth.users SET email_confirmed_at=now() WHERE id='30000000-0000-0000-0000-000000000004';
SET LOCAL ROLE authenticated;
SELECT count(*) AS n1 FROM claim_pending_invites_for_current_user() \gset
SELECT count(*) AS n2 FROM claim_pending_invites_for_current_user() \gset
RESET ROLE;
SELECT pg_temp.ok(:n1=1,'verified user claims pending invite');
SELECT pg_temp.ok(:n2<=1,'repeat claim does not fail');
SELECT pg_temp.ok((SELECT count(*)=1 FROM company_members WHERE user_id='30000000-0000-0000-0000-000000000004' AND role='measurement'),'one membership with invited role');
-- baskasinin e-postasina yazilmis davet baskasi tarafindan alinamaz
SELECT set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT count(*) AS n3 FROM claim_pending_invites_for_current_user() \gset
RESET ROLE;
SELECT pg_temp.ok(:n3=0,'other user cannot claim invite addressed to someone else');

-- 10) yeni kullanici kayit + dogrulama sonrasi uyelik; tekrar giris mukerrer yaratmaz
INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES ('30000000-0000-0000-0000-000000000007','new.user@example.test',NULL,'{}');
SELECT set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000007',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.err($q$SELECT * FROM claim_pending_invites_for_current_user()$q$,'EMAIL_NOT_VERIFIED');
RESET ROLE;
SELECT pg_temp.ok(NOT EXISTS(SELECT 1 FROM company_members WHERE user_id='30000000-0000-0000-0000-000000000007'),'new signup has no access before verification');
UPDATE auth.users SET email_confirmed_at=now() WHERE id='30000000-0000-0000-0000-000000000007';
SET LOCAL ROLE authenticated;
SELECT count(*) AS n4 FROM claim_pending_invites_for_current_user() \gset
SELECT count(*) AS n5 FROM claim_pending_invites_for_current_user() \gset
RESET ROLE;
SELECT pg_temp.ok(:n4=1,'new verified user gets membership');
SELECT pg_temp.ok((SELECT count(*)=1 FROM company_members WHERE user_id='30000000-0000-0000-0000-000000000007' AND company_id='30000000-0000-0000-0000-000000000101' AND role='installer'),'single installer membership in selected company');
SELECT pg_temp.ok(:n5=0,'relogin claims nothing new');

-- 11) izolasyon: Storing Tekstil uyesi Baska Firma verisini goremez
SELECT set_config('request.jwt.claim.sub','30000000-0000-0000-0000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT count(*) AS iso1 FROM company_members WHERE company_id='30000000-0000-0000-0000-000000000102' \gset
SELECT count(*) AS iso2 FROM companies WHERE id='30000000-0000-0000-0000-000000000102' \gset
RESET ROLE;
SELECT pg_temp.ok(:iso1=0,'member cannot read other company memberships');
SELECT pg_temp.ok(:iso2=0,'member cannot read other company');
ROLLBACK;
