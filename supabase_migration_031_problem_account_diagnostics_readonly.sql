-- Salt okunur hesap teshisi. Supabase SQL Editor'da yetkili yonetici calistirir.
-- HULYA isim eslesmelerinin TAMAMINI listeler; ayni isimli hesaplardan biri secilmez.
-- Parola, refresh token, davet tokeni ve tam davet kodu raporlanmaz.
WITH targets AS (
  SELECT 'hülya-name-match'::text AS source, u.id
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.user_id=u.id
  WHERE coalesce(p.full_name,'') ILIKE '%hülya%'
     OR coalesce(p.full_name,'') ILIKE '%hulya%'
     OR coalesce(u.raw_user_meta_data->>'full_name','') ILIKE '%hülya%'
     OR coalesce(u.raw_user_meta_data->>'full_name','') ILIKE '%hulya%'
  UNION ALL
  SELECT 'apple-review-email',u.id
  FROM auth.users u
  WHERE lower(trim(u.email))='test0924064036@gmail.com'
  UNION ALL
  SELECT 'playwright-possible-test-signup',u.id
  FROM auth.users u
  WHERE lower(trim(u.email))='existing@example.test'
)
SELECT t.source,u.id AS auth_user_id,lower(u.email) AS auth_email,u.email_confirmed_at,
       p.user_id AS profile_user_id,p.email AS profile_email,p.full_name,p.role AS profile_role,p.is_active AS profile_active,
       coalesce(m.memberships,'[]'::jsonb) AS memberships,
       coalesce(i.invites,'[]'::jsonb) AS invites
FROM targets t
JOIN auth.users u ON u.id=t.id
LEFT JOIN public.profiles p ON p.user_id=u.id
LEFT JOIN LATERAL (
  SELECT jsonb_agg(jsonb_build_object(
    'company_id',c.id,'company_name',c.name,'member_role',m.role,
    'member_active',coalesce(m.is_active,true),'company_active',coalesce(c.is_active,true),
    'plan_status',c.plan_status,'package_code',c.package_code,'read_only',coalesce(c.read_only,false),
    'trial_started_at',coalesce(c.trial_started_at,c.trial_start),'trial_ends_at',c.trial_ends_at,
    'is_special_access',coalesce(c.is_pilot,false),'special_access_until',c.pilot_until)
    ORDER BY coalesce(m.is_active,true) DESC,m.created_at) AS memberships
  FROM public.company_members m JOIN public.companies c ON c.id=m.company_id
  WHERE m.user_id=u.id
) m ON true
LEFT JOIN LATERAL (
  SELECT jsonb_agg(jsonb_build_object(
    'invite_id',x.id,'company_id',x.company_id,'company_name',c.name,'invite_email',lower(x.email),
    'role',x.role,'expires_at',x.expires_at,'used_at',x.used_at,
    'provided_code_matches',upper(regexp_replace(coalesce(x.invite_code,''),'[^A-Za-z0-9]','','g'))='631660')
    ORDER BY x.created_at DESC) AS invites
  FROM public.user_invites x LEFT JOIN public.companies c ON c.id=x.company_id
  WHERE lower(trim(x.email))=lower(trim(u.email))
    AND (t.source<>'apple-review-email' OR upper(regexp_replace(coalesce(x.invite_code,''),'[^A-Za-z0-9]','','g'))='631660')
) i ON true
ORDER BY t.source,u.id;

-- Profile/email mismatch candidates. No auto-merge or row update is performed.
SELECT p.user_id AS profile_user_id,u.id AS auth_user_id,p.email AS profile_email,lower(u.email) AS auth_email,p.full_name,p.role,p.is_active
FROM public.profiles p JOIN auth.users u ON lower(trim(p.email))=lower(trim(u.email))
WHERE p.user_id IS DISTINCT FROM u.id
  AND (p.full_name ILIKE '%hülya%' OR p.full_name ILIKE '%hulya%' OR lower(u.email)='test0924064036@gmail.com')
ORDER BY lower(u.email),p.user_id;