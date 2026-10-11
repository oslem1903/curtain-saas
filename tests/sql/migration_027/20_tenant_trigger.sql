-- LOCAL fixture test: restrictive tenant trigger remains installed.
\set ON_ERROR_STOP on
BEGIN;
CREATE TRIGGER trg_company_members_tenant_write BEFORE INSERT OR UPDATE ON public.company_members
FOR EACH ROW EXECUTE FUNCTION public.enforce_company_members_tenant_write();
SELECT set_config('request.jwt.claim.sub','',true);
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES ('27000000-0000-0000-0000-000000000007','tenant@example.test',now());
INSERT INTO companies(id,name,plan_status,max_users) VALUES ('27000000-0000-0000-0000-000000000107','Tenant trigger','active',3);
INSERT INTO user_invites(company_id,email,role,token,invite_code,expires_at)
VALUES ('27000000-0000-0000-0000-000000000107','tenant@example.test','admin','tenant-token','TENANT',now()+interval '1 day');
SELECT set_config('request.jwt.claim.sub','27000000-0000-0000-0000-000000000007',true);
SET LOCAL ROLE authenticated;
SELECT * FROM accept_invite_code_for_current_user('tenant@example.test','TENANT','Tenant test');
SELECT * FROM accept_invite_code_for_current_user('tenant@example.test','TENANT','Tenant test');
RESET ROLE;
DO $$ BEGIN
IF (SELECT count(*) FROM company_members WHERE user_id='27000000-0000-0000-0000-000000000007')<>1
 OR (SELECT owner_id FROM companies WHERE id='27000000-0000-0000-0000-000000000107') IS DISTINCT FROM '27000000-0000-0000-0000-000000000007'::uuid
THEN RAISE EXCEPTION 'FAIL tenant trigger/owner'; END IF;
RAISE NOTICE 'PASS: restrictive tenant trigger, first admin owner and retry'; END $$;
ROLLBACK;
