-- LOCAL TEST DATABASE ONLY. Run after fixtures 024-026 and migration 027.
\set ON_ERROR_STOP on
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
SELECT set_config('request.jwt.claim.sub', '', true);
INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES
('27000000-0000-0000-0000-000000000001','join@example.test',NULL,'{"perdepro_invite":{"code":"TEST-01"},"role":"super_admin","company_id":"forged"}'),
('27000000-0000-0000-0000-000000000002','wrong@example.test',now(),'{}'),
('27000000-0000-0000-0000-000000000003','other@example.test',now(),'{}');
INSERT INTO public.companies(id,name,plan_status,max_users,license_expires_at) VALUES
('27000000-0000-0000-0000-000000000101','Invite test','active',2,NULL),
('27000000-0000-0000-0000-000000000102','Blocked test','active',0,NULL);
INSERT INTO public.user_invites(id,company_id,email,role,token,invite_code,expires_at) VALUES
('27000000-0000-0000-0000-000000000201','27000000-0000-0000-0000-000000000101','join@example.test','measurement','token-01','TEST-01',now()+interval '1 day'),
('27000000-0000-0000-0000-000000000202','27000000-0000-0000-0000-000000000102','other@example.test','installer','token-02','TEST-02',now()+interval '1 day');
SELECT pg_temp.check_ok(NOT EXISTS(SELECT 1 FROM company_members WHERE user_id='27000000-0000-0000-0000-000000000001'), 'auth signup creates no membership before verification');
SELECT pg_temp.check_ok((SELECT role='installer' FROM profiles WHERE user_id='27000000-0000-0000-0000-000000000001'), 'metadata cannot grant super_admin');
SELECT set_config('request.jwt.claim.sub','27000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT * FROM complete_pending_invite_for_current_user()$q$,'EMAIL_NOT_VERIFIED');
SELECT pg_temp.expect_error($q$SELECT * FROM accept_verified_invite('27000000-0000-0000-0000-000000000201',NULL)$q$,'permission denied');
SELECT pg_temp.expect_error($q$INSERT INTO company_members(company_id,user_id,role) VALUES ('27000000-0000-0000-0000-000000000101','27000000-0000-0000-0000-000000000001','admin')$q$,'row-level security');
RESET ROLE;
UPDATE auth.users SET email_confirmed_at=now() WHERE id='27000000-0000-0000-0000-000000000001';
SELECT set_config('request.jwt.claim.sub','27000000-0000-0000-0000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT * FROM accept_invite_for_current_user('token-01',NULL)$q$,'INVITE_EMAIL_MISMATCH');
SELECT pg_temp.expect_error($q$SELECT * FROM accept_invite_code_for_current_user('join@example.test','TEST-01',NULL)$q$,'INVITE_EMAIL_MISMATCH');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','27000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT * FROM complete_pending_invite_for_current_user();
SELECT * FROM complete_pending_invite_for_current_user();
SELECT * FROM accept_invite_code_for_current_user('JOIN@example.test','test-01',NULL);
SELECT * FROM accept_invite_for_current_user('token-01',NULL);
RESET ROLE;
SELECT pg_temp.check_ok((SELECT count(*)=1 FROM company_members WHERE user_id='27000000-0000-0000-0000-000000000001'), 'retry yields exactly one membership');
SELECT pg_temp.check_ok((SELECT role='measurement' AND company_id='27000000-0000-0000-0000-000000000101' FROM company_members WHERE user_id='27000000-0000-0000-0000-000000000001'), 'company and role come from invite, user_id from auth.uid');
SELECT pg_temp.check_ok((SELECT accepted_by='27000000-0000-0000-0000-000000000001' AND used_at IS NOT NULL FROM user_invites WHERE invite_code='TEST-01'), 'acceptance records actual recipient');
SELECT pg_temp.check_ok((SELECT NOT(raw_user_meta_data ? 'perdepro_invite') FROM auth.users WHERE id='27000000-0000-0000-0000-000000000001'), 'pending intent cleared only after successful transaction');
UPDATE company_members SET role='installer' WHERE user_id='27000000-0000-0000-0000-000000000001';
UPDATE user_invites SET expires_at=now()-interval '1 day' WHERE invite_code='TEST-01';
SET LOCAL ROLE authenticated;
SELECT * FROM accept_invite_code_for_current_user('join@example.test','TEST-01',NULL);
RESET ROLE;
SELECT pg_temp.check_ok((SELECT role='installer' FROM company_members WHERE user_id='27000000-0000-0000-0000-000000000001'), 'replay after expiry preserves later role changes');
UPDATE company_members SET is_active=false WHERE user_id='27000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT * FROM accept_invite_for_current_user('token-01',NULL)$q$,'MEMBER_INACTIVE');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','27000000-0000-0000-0000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT * FROM accept_invite_code_for_current_user('other@example.test','TEST-02',NULL)$q$,'MEMBER_LIMIT');
RESET ROLE;
SELECT pg_temp.check_ok((SELECT used_at IS NULL FROM user_invites WHERE invite_code='TEST-02'), 'failed transaction leaves invite reusable');
SELECT pg_temp.check_ok(NOT EXISTS(SELECT 1 FROM company_members WHERE user_id='27000000-0000-0000-0000-000000000003'), 'failed transaction leaves no partial membership');
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE companies SET max_users=2,read_only=true WHERE id='27000000-0000-0000-0000-000000000102';
SELECT set_config('request.jwt.claim.sub','27000000-0000-0000-0000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT * FROM accept_invite_for_current_user('token-02',NULL)$q$,'COMPANY_UNAVAILABLE');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE companies SET read_only=false,license_expires_at=now()-interval '1 day' WHERE id='27000000-0000-0000-0000-000000000102';
SELECT set_config('request.jwt.claim.sub','27000000-0000-0000-0000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT * FROM accept_invite_for_current_user('token-02',NULL)$q$,'COMPANY_UNAVAILABLE');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',true);
UPDATE companies SET license_expires_at=NULL WHERE id='27000000-0000-0000-0000-000000000102';
UPDATE user_invites SET expires_at=now()-interval '1 day' WHERE invite_code='TEST-02';
SELECT set_config('request.jwt.claim.sub','27000000-0000-0000-0000-000000000003',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT * FROM accept_invite_for_current_user('token-02',NULL)$q$,'INVITE_EXPIRED');
RESET ROLE;
UPDATE user_invites SET expires_at=now()+interval '1 day',role='super_admin' WHERE invite_code='TEST-02';
SET LOCAL ROLE authenticated;
SELECT pg_temp.expect_error($q$SELECT * FROM accept_invite_for_current_user('token-02',NULL)$q$,'INVITE_INVALID');
RESET ROLE;
UPDATE user_invites SET role='installer' WHERE invite_code='TEST-02';
SET LOCAL ROLE authenticated;
SELECT * FROM accept_invite_for_current_user('token-02',NULL);
RESET ROLE;
SELECT pg_temp.check_ok((SELECT count(*)=1 FROM company_members WHERE user_id='27000000-0000-0000-0000-000000000003'), 'legacy existing account repaired without deleting auth user');
SET LOCAL ROLE anon;
SELECT pg_temp.expect_error($q$SELECT * FROM complete_pending_invite_for_current_user()$q$,'permission denied');
SELECT pg_temp.expect_error($q$SELECT * FROM accept_invite_for_current_user('token-02',NULL)$q$,'permission denied');
RESET ROLE;
ROLLBACK;
