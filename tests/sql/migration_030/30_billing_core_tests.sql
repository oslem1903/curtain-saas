-- LOCAL TEST DATABASE ONLY. supabase_migration_032_billing_core_DRAFT.sql sonrasi.
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
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
('32000000-0000-0000-0000-000000000001','ca@example.test',now()),
('32000000-0000-0000-0000-000000000002','cb@example.test',now());
INSERT INTO public.profiles(user_id,email,full_name,role,is_active) VALUES
('32000000-0000-0000-0000-000000000001','ca@example.test','A','admin',true),
('32000000-0000-0000-0000-000000000002','cb@example.test','B','admin',true)
ON CONFLICT (user_id) DO UPDATE SET role='admin';
INSERT INTO public.companies(id,name,plan_status,max_users,trial_ends_at) VALUES
('32000000-0000-0000-0000-000000000101','Billing A','trial',5,now()-interval '1 day'),
('32000000-0000-0000-0000-000000000102','Billing B','trial',5,now()+interval '3 days'),
('32000000-0000-0000-0000-000000000103','Suspended','suspended',5,now()+interval '3 days');
INSERT INTO public.company_members(company_id,user_id,role,is_active) VALUES
('32000000-0000-0000-0000-000000000101','32000000-0000-0000-0000-000000000001','admin',true),
('32000000-0000-0000-0000-000000000102','32000000-0000-0000-0000-000000000002','admin',true);
INSERT INTO public.billing_plans(code,name,period,price_minor,currency,package_code) VALUES
('solo_monthly','Solo Aylik','month',99900,'TRY','solo'),
('solo_yearly','Solo Yillik','year',999000,'TRY','solo');

-- 0) sureleri dolmus firma: yazma kapali
SELECT pg_temp.ok(NOT public.company_subscription_allows_write('32000000-0000-0000-0000-000000000101'),'expired trial: write closed before payment');

-- 1) istemci cagiramaz / yazamaz
SELECT set_config('request.jwt.claim.sub','32000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.err($q$SELECT public.billing_apply_charge('iyzico','e0','32000000-0000-0000-0000-000000000101','solo_monthly','p0',99900,'TRY')$q$,'permission denied');
SELECT pg_temp.err($q$INSERT INTO public.billing_subscriptions(company_id,plan_code,channel,status) VALUES ('32000000-0000-0000-0000-000000000101','solo_monthly','manual','active')$q$,'permission denied');
SELECT pg_temp.err($q$UPDATE public.companies SET plan_status='active', license_expires_at=now()+interval '5 years' WHERE id='32000000-0000-0000-0000-000000000101'$q$,'super admin');
RESET ROLE;
SELECT pg_temp.ok(NOT public.company_subscription_allows_write('32000000-0000-0000-0000-000000000101'),'client could not open access');

-- 2) sunucu (service_role, auth.uid() NULL): basarisiz odeme erisim vermez
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
SELECT public.billing_record_failure('iyzico','evt-fail-1','32000000-0000-0000-0000-000000000101','card_declined') AS f \gset
RESET ROLE;
SELECT pg_temp.ok(NOT public.company_subscription_allows_write('32000000-0000-0000-0000-000000000101'),'failed payment: no access');

-- 3) tutar uyusmazligi reddedilir
SET LOCAL ROLE service_role;
SELECT public.billing_apply_charge('iyzico','evt-bad','32000000-0000-0000-0000-000000000101','solo_monthly','pay-bad',100,'TRY') AS bad \gset
RESET ROLE;
SELECT pg_temp.ok(:'bad'::jsonb->>'reason'='amount_mismatch' AND NOT public.company_subscription_allows_write('32000000-0000-0000-0000-000000000101'),'amount mismatch rejected, no access');

-- 4) basarili odeme: erisim acilir, donem 1 ay
SET LOCAL ROLE service_role;
SELECT public.billing_apply_charge('iyzico','evt-ok-1','32000000-0000-0000-0000-000000000101','solo_monthly','pay-1',99900,'TRY','sub-ref-1') AS ok1 \gset
RESET ROLE;
SELECT pg_temp.ok(:'ok1'::jsonb->>'status'='applied','charge applied');
SELECT pg_temp.ok(public.company_subscription_allows_write('32000000-0000-0000-0000-000000000101'),'successful payment: access opens (no re-login needed)');
SELECT pg_temp.ok((SELECT license_expires_at BETWEEN now()+interval '27 days' AND now()+interval '32 days' AND plan_status='active' FROM public.companies WHERE id='32000000-0000-0000-0000-000000000101'),'monthly period end ~1 month');
CREATE TEMP TABLE end1 AS SELECT license_expires_at e FROM public.companies WHERE id='32000000-0000-0000-0000-000000000101';
GRANT SELECT ON end1 TO PUBLIC;

-- 5) tekrar gelen bildirim (ayni event / ayni odeme) cift uzatma yapmaz
SET LOCAL ROLE service_role;
SELECT public.billing_apply_charge('iyzico','evt-ok-1','32000000-0000-0000-0000-000000000101','solo_monthly','pay-1',99900,'TRY','sub-ref-1') AS dup1 \gset
SELECT public.billing_apply_charge('iyzico','evt-ok-1-retry','32000000-0000-0000-0000-000000000101','solo_monthly','pay-1',99900,'TRY','sub-ref-1') AS dup2 \gset
RESET ROLE;
SELECT pg_temp.ok(:'dup1'::jsonb->>'status'='duplicate' AND :'dup2'::jsonb->>'status'='duplicate','duplicate notifications ignored');
SELECT pg_temp.ok((SELECT license_expires_at = (SELECT e FROM end1) FROM public.companies WHERE id='32000000-0000-0000-0000-000000000101'),'no double extension');
SELECT pg_temp.ok((SELECT count(*)=1 FROM public.billing_payments WHERE company_id='32000000-0000-0000-0000-000000000101' AND status='succeeded'),'exactly one payment row');

-- 6) yeni (farkli) odeme donemi mevcut bitisten uzatir (yenileme)
SET LOCAL ROLE service_role;
SELECT public.billing_apply_charge('iyzico','evt-ok-2','32000000-0000-0000-0000-000000000101','solo_monthly','pay-2',99900,'TRY','sub-ref-1') AS ok2 \gset
RESET ROLE;
SELECT pg_temp.ok((SELECT license_expires_at > (SELECT e FROM end1)+interval '27 days' FROM public.companies WHERE id='32000000-0000-0000-0000-000000000101'),'renewal extends from current period end');
SELECT pg_temp.ok((SELECT count(*)=1 FROM public.billing_subscriptions WHERE company_id='32000000-0000-0000-0000-000000000101' AND status='active'),'single live subscription per company');

-- 7) farkli kanal ayni firmaya: tek abonelik korunur
SET LOCAL ROLE service_role;
SELECT public.billing_apply_charge('google_play','gp-evt-1','32000000-0000-0000-0000-000000000101','solo_yearly','gp-pay-1',999000,'TRY','gp-token-1') AS gp \gset
RESET ROLE;
SELECT pg_temp.ok((SELECT count(*)=1 FROM public.billing_subscriptions WHERE company_id='32000000-0000-0000-0000-000000000101' AND status='active'),'cross-channel still one live subscription');

-- 8) firma izolasyonu: B, A'nin abonelik/odeme kaydini goremez
SELECT set_config('request.jwt.claim.sub','32000000-0000-0000-0000-000000000002',true);
SET LOCAL ROLE authenticated;
SELECT count(*) AS leak_s FROM public.billing_subscriptions WHERE company_id='32000000-0000-0000-0000-000000000101' \gset
SELECT count(*) AS leak_p FROM public.billing_payments WHERE company_id='32000000-0000-0000-0000-000000000101' \gset
RESET ROLE;
SELECT pg_temp.ok(:leak_s=0 AND :leak_p=0,'other company cannot read subscriptions/payments');
SELECT set_config('request.jwt.claim.sub','32000000-0000-0000-0000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT count(*) AS own_p FROM public.billing_payments WHERE company_id='32000000-0000-0000-0000-000000000101' \gset
RESET ROLE;
SELECT pg_temp.ok(:own_p>=2,'own company admin can read payments');

SELECT set_config('request.jwt.claim.sub','',true);
-- 9) iptal: donem sonuna kadar erisim surer; iade: erisim kapanir; askiya alinmis firma yeniden acilmaz
SET LOCAL ROLE service_role;
SELECT public.billing_apply_cancel('iyzico','evt-cancel-1','32000000-0000-0000-0000-000000000101') AS cn \gset
RESET ROLE;
SELECT pg_temp.ok(public.company_subscription_allows_write('32000000-0000-0000-0000-000000000101'),'canceled: access continues until period end');
SET LOCAL ROLE service_role;
SELECT public.billing_apply_refund('google_play','gp-ref-1','32000000-0000-0000-0000-000000000101','gp-pay-1') AS rf \gset
SELECT public.billing_apply_refund('google_play','gp-ref-1','32000000-0000-0000-0000-000000000101','gp-pay-1') AS rf2 \gset
RESET ROLE;
SELECT pg_temp.ok(:'rf'::jsonb->>'status'='applied' AND :'rf2'::jsonb->>'status'='duplicate','refund applied once');
SELECT pg_temp.ok(NOT public.company_subscription_allows_write('32000000-0000-0000-0000-000000000101'),'refund closes access');
SET LOCAL ROLE service_role;
SELECT public.billing_apply_charge('iyzico','evt-susp','32000000-0000-0000-0000-000000000103','solo_monthly','pay-s',99900,'TRY') AS sp \gset
RESET ROLE;
SELECT pg_temp.ok(:'sp'::jsonb->>'reason'='company_suspended','suspended company not reactivated by payment');
ROLLBACK;
