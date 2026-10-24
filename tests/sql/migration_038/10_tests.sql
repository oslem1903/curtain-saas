-- LOCAL TEST DATABASE ONLY. Zincir: 024 fixture -> 024 -> 025 -> 026 -> 027 -> 038 (bkz. run_038.mjs notu README).
BEGIN;
CREATE FUNCTION pg_temp.check_ok(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE FUNCTION pg_temp.expect_error(stmt text, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN
    IF position(expected IN sqlerrm) > 0 THEN RAISE NOTICE 'PASS rejects: %', expected; RETURN; END IF;
    RAISE EXCEPTION 'Unexpected error: % (expected %)', sqlerrm, expected;
  END;
  RAISE EXCEPTION 'FAIL: expected rejection %', expected;
END $$;

-- Prod'da yonetici (admin) uyeler bu tablolara RLS ile yazabilir; tetikleyiciyi RLS'ten bagimsiz
-- sinamak icin fixture'a genis (test-only) politika eklenir.
CREATE POLICY t038_cm_all ON public.company_members FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY t038_ui_all ON public.user_invites FOR ALL TO authenticated USING (true) WITH CHECK (true);
SELECT set_config('request.jwt.claim.sub', '', true);
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
 ('38000000-0000-0000-0000-000000000001','owner@firma.test',now()),
 ('38000000-0000-0000-0000-000000000002','ekip@firma.test',now()),
 ('38000000-0000-0000-0000-000000000003','baska@firma.test',now()),
 ('38000000-0000-0000-0000-000000000004','digerowner@firma.test',now()),
 ('38000000-0000-0000-0000-000000000005','ekip2@firma.test',now());
INSERT INTO public.profiles(user_id,email,role) VALUES
 ('38000000-0000-0000-0000-000000000001','owner@firma.test','admin'),
 ('38000000-0000-0000-0000-000000000004','digerowner@firma.test','admin')
ON CONFLICT (user_id) DO UPDATE SET role = excluded.role;
INSERT INTO public.companies(id,name,plan_status,package_code,subscription_plan,max_users,is_active,trial_ends_at,owner_id,enabled_modules) VALUES
 ('38000000-0000-0000-0000-000000000101','Firma A','trial','solo','solo',4,true,now()+interval '5 days','38000000-0000-0000-0000-000000000001',
  ARRAY['admin','measurements','orders','customers','appointments','suppliers','installation','collections']),
 ('38000000-0000-0000-0000-000000000102','Firma B','trial','solo','solo',4,true,now()+interval '5 days','38000000-0000-0000-0000-000000000004',NULL),
 ('38000000-0000-0000-0000-000000000103','Dar limit','trial','solo','solo',2,true,now()+interval '5 days','38000000-0000-0000-0000-000000000001',NULL);
INSERT INTO public.company_members(company_id,user_id,role) VALUES
 ('38000000-0000-0000-0000-000000000101','38000000-0000-0000-0000-000000000001','admin'),
 ('38000000-0000-0000-0000-000000000102','38000000-0000-0000-0000-000000000004','admin'),
 ('38000000-0000-0000-0000-000000000103','38000000-0000-0000-0000-000000000001','admin');
SELECT pg_temp.check_ok((SELECT is_owner FROM company_members WHERE user_id='38000000-0000-0000-0000-000000000001' AND company_id='38000000-0000-0000-0000-000000000101'), 'mevcut uyeler sahip');

-- Sahip ekip daveti olusturur
SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
CREATE TEMP TABLE inv AS SELECT * FROM create_team_invite('38000000-0000-0000-0000-000000000101','Ekip@Firma.test',ARRAY['orders','customers']);
GRANT ALL ON inv TO authenticated;
SELECT pg_temp.check_ok((SELECT count(*) FROM inv)=1, 'sahip ekip daveti olusturur');
SELECT pg_temp.expect_error($q$SELECT * FROM create_team_invite('38000000-0000-0000-0000-000000000101','x@firma.test',ARRAY[]::text[])$q$,'MODULES_REQUIRED');
SELECT pg_temp.expect_error($q$SELECT * FROM create_team_invite('38000000-0000-0000-0000-000000000101','x@firma.test',ARRAY['orders','hack'])$q$,'MODULE_INVALID');
SELECT pg_temp.expect_error($q$SELECT * FROM create_team_invite('38000000-0000-0000-0000-000000000101','x@firma.test',ARRAY['accounting'])$q$,'MODULE_NOT_IN_PLAN');
SELECT pg_temp.expect_error($q$SELECT * FROM create_team_invite('38000000-0000-0000-0000-000000000101','bozuk',ARRAY['orders'])$q$,'EMAIL_INVALID');
SELECT pg_temp.expect_error($q$SELECT * FROM create_team_invite('38000000-0000-0000-0000-000000000101','owner@firma.test',ARRAY['orders'])$q$,'ALREADY_MEMBER');
SELECT pg_temp.expect_error($q$SELECT * FROM create_team_invite('38000000-0000-0000-0000-000000000102','x@firma.test',ARRAY['orders'])$q$,'OWNER_ONLY');
-- Ayni e-postaya tekrar: yenilenir, ikinci kayit olusmaz
CREATE TEMP TABLE inv2 AS SELECT * FROM create_team_invite('38000000-0000-0000-0000-000000000101','ekip@firma.test',ARRAY['orders','customers','installation']);
RESET ROLE;
SELECT pg_temp.check_ok((SELECT count(*) FROM user_invites WHERE company_id='38000000-0000-0000-0000-000000000101' AND is_team_member)=1, 'ayni e-postaya tek bekleyen davet');
SELECT pg_temp.check_ok((SELECT token FROM inv2) <> (SELECT token FROM inv), 'tekrar davet yeni token uretir');
SELECT pg_temp.check_ok((SELECT invite_code IS NULL AND role='admin' FROM user_invites WHERE is_team_member), 'ekip davetinde kod yok, rol admin');

-- Baska e-postayla kabul reddedilir
SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(format($q$SELECT * FROM accept_invite_for_current_user(%L,NULL)$q$,(SELECT token FROM inv2)),'INVITE_EMAIL_MISMATCH');
RESET ROLE;

-- Eski token gecersiz (yenilendi)
SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error(format($q$SELECT * FROM accept_invite_for_current_user(%L,NULL)$q$,(SELECT token FROM inv)),'INVITE_INVALID');
-- Kodla katilim ekip davetinde calismaz
SELECT pg_temp.expect_error($q$SELECT * FROM accept_invite_code_for_current_user('ekip@firma.test','',NULL)$q$,'INVITE_INVALID');
SELECT * FROM accept_invite_for_current_user((SELECT token FROM inv2),'Ekip Uyesi');
RESET ROLE;
SELECT pg_temp.check_ok((SELECT NOT is_owner AND role='admin' AND allowed_modules=ARRAY['customers','installation','orders'] FROM company_members WHERE user_id='38000000-0000-0000-0000-000000000002'), 'ekip uyesi sahip degil, moduller davetten');
SELECT pg_temp.check_ok((SELECT owner_id='38000000-0000-0000-0000-000000000001' FROM companies WHERE id='38000000-0000-0000-0000-000000000101'), 'firma sahibi degismedi');

-- Ekip uyesi sahip-kilitli tablolara dogrudan yazamaz
SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$UPDATE companies SET name='ele gecirildi' WHERE id='38000000-0000-0000-0000-000000000101'$q$,'OWNER_ONLY');
SELECT pg_temp.expect_error($q$UPDATE company_members SET is_owner=true WHERE user_id='38000000-0000-0000-0000-000000000002'$q$,'OWNER_ONLY');
SELECT pg_temp.expect_error($q$UPDATE company_members SET allowed_modules=NULL WHERE user_id='38000000-0000-0000-0000-000000000002'$q$,'OWNER_ONLY');
SELECT pg_temp.expect_error($q$DELETE FROM company_members WHERE user_id='38000000-0000-0000-0000-000000000001'$q$,'OWNER_ONLY');
SELECT pg_temp.expect_error($q$INSERT INTO user_invites(company_id,email,role,token,expires_at) VALUES ('38000000-0000-0000-0000-000000000101','z@firma.test','admin','t',now()+interval '1 day')$q$,'OWNER_ONLY');
SELECT pg_temp.expect_error($q$SELECT * FROM create_team_invite('38000000-0000-0000-0000-000000000101','z@firma.test',ARRAY['orders'])$q$,'OWNER_ONLY');
SELECT pg_temp.expect_error($q$SELECT * FROM list_company_team('38000000-0000-0000-0000-000000000101')$q$,'OWNER_ONLY');
SELECT pg_temp.expect_error($q$SELECT * FROM update_team_member('38000000-0000-0000-0000-000000000101','38000000-0000-0000-0000-000000000002',ARRAY['orders','accounting'],true)$q$,'OWNER_ONLY');
RESET ROLE;
SELECT pg_temp.check_ok((SELECT name='Firma A' FROM companies WHERE id='38000000-0000-0000-0000-000000000101'), 'firma adi degismedi');

-- Sahip hala yazabilir, ekibi yonetir
SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
UPDATE companies SET name='Firma A Yeni' WHERE id='38000000-0000-0000-0000-000000000101';
SELECT pg_temp.check_ok((SELECT count(*)=2 FROM list_company_team('38000000-0000-0000-0000-000000000101')), 'sahip ekip listesini gorur (sahip + ekip uyesi)');
SELECT update_team_member('38000000-0000-0000-0000-000000000101','38000000-0000-0000-0000-000000000002',ARRAY['orders'],true);
SELECT pg_temp.expect_error($q$SELECT update_team_member('38000000-0000-0000-0000-000000000101','38000000-0000-0000-0000-000000000001',ARRAY['orders'],false)$q$,'MEMBER_INVALID');
SELECT pg_temp.expect_error($q$SELECT update_team_member('38000000-0000-0000-0000-000000000101','38000000-0000-0000-0000-000000000002',ARRAY['accounting'],true)$q$,'MODULE_NOT_IN_PLAN');
RESET ROLE;
SELECT pg_temp.check_ok((SELECT name='Firma A Yeni' FROM companies WHERE id='38000000-0000-0000-0000-000000000101'), 'sahip firma kaydini guncelleyebilir');
SELECT pg_temp.check_ok((SELECT allowed_modules=ARRAY['orders'] FROM company_members WHERE user_id='38000000-0000-0000-0000-000000000002'), 'moduller guncellendi');

-- Erisimi kapatma
SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT update_team_member('38000000-0000-0000-0000-000000000101','38000000-0000-0000-0000-000000000002',NULL,false);
RESET ROLE;
SELECT pg_temp.check_ok((SELECT NOT is_active FROM company_members WHERE user_id='38000000-0000-0000-0000-000000000002'), 'ekip uyesi pasife alindi');

-- Kullanici siniri (max_users=2: sahip + 1 davet)
SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT * FROM create_team_invite('38000000-0000-0000-0000-000000000103','a@firma.test',ARRAY['orders']);
SELECT pg_temp.expect_error($q$SELECT * FROM create_team_invite('38000000-0000-0000-0000-000000000103','b@firma.test',ARRAY['orders'])$q$,'MEMBER_LIMIT');
-- Iptal kotayi geri verir
SELECT revoke_team_invite((SELECT id FROM user_invites WHERE email='a@firma.test'));
SELECT * FROM create_team_invite('38000000-0000-0000-0000-000000000103','b@firma.test',ARRAY['orders']);
RESET ROLE;

-- Super admin sahip yetkisine sahiptir; baska firmanin sahibi degildir
SELECT set_config('request.jwt.claim.sub','',true);
SELECT pg_temp.check_ok((SELECT NOT (SELECT public.is_company_owner('38000000-0000-0000-0000-000000000101'))), 'oturumsuz sahip degil');
SELECT set_config('request.jwt.claim.sub','38000000-0000-0000-0000-000000000004',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_ok(NOT public.is_company_owner('38000000-0000-0000-0000-000000000101'), 'baska firma sahibi bu firmanin sahibi degil');
-- RLS satiri gizler (0 satir) veya tetikleyici reddeder; iki durumda da firma degismemeli.
DO $$ BEGIN UPDATE companies SET name='x' WHERE id='38000000-0000-0000-0000-000000000101'; EXCEPTION WHEN OTHERS THEN NULL; END $$;
RESET ROLE;
SELECT pg_temp.check_ok((SELECT name='Firma A Yeni' FROM companies WHERE id='38000000-0000-0000-0000-000000000101'), 'baska firma sahibi bu firmayi degistiremez');

-- Solo siniri guncellemesi (migration zaten uygulandi): 3 -> 4, ozel degerler korunur
SELECT pg_temp.check_ok((SELECT max_users FROM self_signup_settings)=4, 'self-signup solo siniri 4');
ROLLBACK;
