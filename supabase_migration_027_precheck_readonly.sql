-- Salt okunur: SQL Editor'da migration 027 ONCESINDE inceleyin.
-- Canli veritabanina bu oturumda baglanilmadi. Bu dosya hicbir sey yazmaz.
SELECT n.nspname, c.relname, c.relrowsecurity, c.relforcerowsecurity
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('profiles','company_members','user_invites','companies');
SELECT table_name,column_name,data_type FROM information_schema.columns
WHERE table_schema IN ('public','auth') AND table_name IN ('users','profiles','company_members','user_invites')
AND column_name IN ('id','user_id','company_id','email','role','email_confirmed_at','used_at','accepted_by','expires_at','is_active')
ORDER BY table_name,ordinal_position;
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid IN ('public.profiles'::regclass,'public.company_members'::regclass,'public.user_invites'::regclass);
SELECT tablename,policyname,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname='public' AND tablename IN ('profiles','company_members','user_invites','companies');
SELECT tgrelid::regclass, tgname, pg_get_triggerdef(oid) FROM pg_trigger
WHERE tgrelid IN ('auth.users'::regclass,'public.profiles'::regclass,'public.company_members'::regclass,'public.user_invites'::regclass) AND NOT tgisinternal;
SELECT p.oid::regprocedure, p.prosecdef, p.proacl, pg_get_functiondef(p.oid)
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('handle_new_user','get_current_auth_context','accept_invite_for_current_user','accept_invite_code_for_current_user','enforce_company_members_tenant_write','company_subscription_allows_write','protect_profile_privileged_fields');

-- Sorunlu e-postayi girin. Kod/token/oturum sirri raporlanmaz.
WITH target AS (SELECT lower(trim('SORUNLU_EPOSTA_BURAYA')) AS email)
SELECT u.id AS auth_user_id,u.email,u.email_confirmed_at,
 p.user_id AS profile_user_id,p.role AS profile_role,p.is_active AS profile_active,
 i.id AS invite_id,i.company_id AS invited_company,i.role AS invited_role,i.expires_at,i.used_at,
 m.id AS membership_id,m.user_id AS member_user_id,m.company_id AS member_company,m.role AS member_role,m.is_active AS member_active
FROM target t LEFT JOIN auth.users u ON lower(trim(u.email))=t.email
LEFT JOIN public.profiles p ON p.user_id=u.id
LEFT JOIN public.user_invites i ON lower(trim(i.email))=t.email
LEFT JOIN public.company_members m ON m.user_id=u.id AND m.company_id=i.company_id;

-- Yanlis Auth ID'sine bagli olabilecek e-posta profilleri (teshis, otomatik birlestirme yok).
SELECT p.user_id AS profile_user_id,u.id AS auth_user_id,p.email
FROM public.profiles p JOIN auth.users u ON lower(trim(p.email))=lower(trim(u.email))
WHERE p.user_id IS DISTINCT FROM u.id;
SELECT company_id,user_id,count(*) FROM public.company_members GROUP BY company_id,user_id HAVING count(*)>1;
