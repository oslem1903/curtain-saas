-- LOCAL TEST DATABASE ONLY. Sure bitimi: dogrudan API (RLS + tetikleyici) davranisi.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.ok(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; RAISE NOTICE 'PASS: %', label; END $$;
CREATE FUNCTION pg_temp.err(stmt text, expected text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; EXCEPTION WHEN OTHERS THEN
    IF position(expected IN sqlerrm) > 0 THEN RAISE NOTICE 'PASS rejects: %', left(sqlerrm,70); RETURN; END IF;
    RAISE EXCEPTION 'Unexpected error: % (expected %)', sqlerrm, expected;
  END;
  RAISE EXCEPTION 'FAIL: expected rejection %', expected;
END $$;
INSERT INTO auth.users(id,email,email_confirmed_at,raw_user_meta_data) VALUES
('31000000-0000-0000-0000-000000000001','exp@example.test',now(),'{}'),
('31000000-0000-0000-0000-000000000002','live@example.test',now(),'{}'),
('31000000-0000-0000-0000-000000000003','pilot@example.test',now(),'{}'),
('31000000-0000-0000-0000-000000000004','sa@example.test',now(),'{}'),
('31000000-0000-0000-0000-000000000005','newhire@example.test',now(),'{}');
INSERT INTO public.profiles(user_id,email,full_name,role,is_active) VALUES
('31000000-0000-0000-0000-000000000001','exp@example.test','E','admin',true),
('31000000-0000-0000-0000-000000000002','live@example.test','L','admin',true),
('31000000-0000-0000-0000-000000000003','pilot@example.test','P','admin',true),
('31000000-0000-0000-0000-000000000004','sa@example.test','SA','super_admin',true),
('31000000-0000-0000-0000-000000000005','newhire@example.test','N','installer',true)
ON CONFLICT (user_id) DO UPDATE SET role=excluded.role;
INSERT INTO public.companies(id,name,plan_status,max_users,is_pilot,pilot_until,trial_ends_at) VALUES
('31000000-0000-0000-0000-000000000101','Expired Co','trial',5,false,NULL,now()-interval '1 second'),
('31000000-0000-0000-0000-000000000102','Live Co','trial',5,false,NULL,now()+interval '1 minute'),
('31000000-0000-0000-0000-000000000103','Apple-like Co','trial',5,true,NULL,now()-interval '30 days');
INSERT INTO public.company_members(company_id,user_id,role,is_active) VALUES
('31000000-0000-0000-0000-000000000101','31000000-0000-0000-0000-000000000001','admin',true),
('31000000-0000-0000-0000-000000000102','31000000-0000-0000-0000-000000000002','admin',true),
('31000000-0000-0000-0000-000000000103','31000000-0000-0000-0000-000000000003','admin',true);
INSERT INTO public.customers(id,company_id) VALUES
('31000000-0000-0000-0000-000000000201','31000000-0000-0000-0000-000000000101'),
('31000000-0000-0000-0000-000000000202','31000000-0000-0000-0000-000000000102');
CREATE TEMP TABLE t0 AS SELECT id,trial_ends_at,is_pilot FROM public.companies WHERE id::text LIKE '31000000%';
GRANT SELECT ON t0 TO PUBLIC;

-- Suresi dolan normal hesap: okuma acik, dogrudan yazma kapali, lisans alanini degistiremez
SELECT set_config('request.jwt.claim.sub','31000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT count(*) AS read_n FROM public.customers WHERE company_id='31000000-0000-0000-0000-000000000101' \gset
SELECT pg_temp.err($q$INSERT INTO public.customers(company_id) VALUES ('31000000-0000-0000-0000-000000000101')$q$,'lisans');
WITH u AS (UPDATE public.customers SET id=id WHERE id='31000000-0000-0000-0000-000000000201' RETURNING 1) SELECT count(*) AS upd_n FROM u \gset
WITH d AS (DELETE FROM public.customers WHERE id='31000000-0000-0000-0000-000000000201' RETURNING 1) SELECT count(*) AS del_n FROM d \gset
SELECT pg_temp.err($q$UPDATE public.companies SET trial_ends_at=now()+interval '30 days' WHERE id='31000000-0000-0000-0000-000000000101'$q$,'super admin');
SELECT pg_temp.err($q$UPDATE public.companies SET is_pilot=true WHERE id='31000000-0000-0000-0000-000000000101'$q$,'super admin');
RESET ROLE;
SELECT pg_temp.ok(:read_n=1,'expired company can still read its data');
SELECT pg_temp.ok(:upd_n=0 AND :del_n=0,'expired company cannot update/delete via direct API');
SELECT pg_temp.ok((SELECT count(*)=1 FROM public.customers WHERE id='31000000-0000-0000-0000-000000000201'),'data unchanged');

-- Sinir: bitis ani gecmis firma kapali, +1 dk firma acik; yazma kapisi sunucu saatiyle karar verir
SELECT pg_temp.ok(NOT public.company_subscription_allows_write('31000000-0000-0000-0000-000000000101'),'1s past end: write closed');
SELECT pg_temp.ok(public.company_subscription_allows_write('31000000-0000-0000-0000-000000000102'),'before end: write open');
SELECT set_config('request.jwt.claim.sub','31000000-0000-0000-0000-000000000004',true);
UPDATE public.companies SET trial_ends_at=now()-interval '1 microsecond' WHERE id='31000000-0000-0000-0000-000000000102';
SELECT pg_temp.ok(NOT public.company_subscription_allows_write('31000000-0000-0000-0000-000000000102'),'immediately after end: write closed');

-- Yeni calisan eklemek denemeyi yenilemez
SELECT set_config('request.jwt.claim.sub','31000000-0000-0000-0000-000000000004',true);
SET LOCAL ROLE authenticated;
SELECT public.super_admin_assign_user_to_company('newhire@example.test','31000000-0000-0000-0000-000000000101','installer') AS rr \gset
RESET ROLE;
SELECT pg_temp.ok((SELECT trial_ends_at=(SELECT trial_ends_at FROM t0 WHERE id='31000000-0000-0000-0000-000000000101') FROM public.companies WHERE id='31000000-0000-0000-0000-000000000101'),'adding employee does not renew trial');
SELECT pg_temp.ok(NOT public.company_subscription_allows_write('31000000-0000-0000-0000-000000000101'),'still closed after adding employee');

-- Ozel erisim (Apple inceleme hesabi benzeri) yazilabilir kalir; normal kullanici kendine veremez
SELECT pg_temp.ok(public.company_subscription_allows_write('31000000-0000-0000-0000-000000000103'),'special access company stays writable');
SELECT set_config('request.jwt.claim.sub','31000000-0000-0000-0000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.err($q$UPDATE public.companies SET is_pilot=true, pilot_until=NULL WHERE id='31000000-0000-0000-0000-000000000102'$q$,'super admin');
RESET ROLE;
SELECT pg_temp.ok((SELECT NOT is_pilot FROM public.companies WHERE id='31000000-0000-0000-0000-000000000102'),'normal user could not self-grant special access');
ROLLBACK;
