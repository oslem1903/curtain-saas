-- 038 PRECHECK (SALT OKUNUR): "ekip uyesi" rolu eklemeden once prod'daki rol bagimliliklarini listeler.
-- Hicbir sey degistirmez. SQL Editor'da calistirip sonuclari paylasin.

-- 1) Rol listesi kisitlari (yeni rol buraya eklenmeli)
SELECT conrelid::regclass AS tablo, conname, pg_get_constraintdef(oid) AS tanim
FROM pg_constraint
WHERE contype = 'c' AND pg_get_constraintdef(oid) ILIKE '%role%'
  AND connamespace = 'public'::regnamespace
ORDER BY 1, 2;

-- 2) Rol adina bakan RLS politikalari (yeni rol bunlardan nasil etkilenir?)
SELECT schemaname, tablename, policyname, cmd,
       left(coalesce(qual, ''), 300) AS using_expr,
       left(coalesce(with_check, ''), 300) AS check_expr
FROM pg_policies
WHERE schemaname = 'public'
  AND (coalesce(qual, '') ~* '(role|is_admin_or_accounting|is_company_admin|current_app_role)'
    OR coalesce(with_check, '') ~* '(role|is_admin_or_accounting|is_company_admin|current_app_role)')
ORDER BY tablename, policyname;

-- 3) Rol kontrolu yapan fonksiyonlar
SELECT p.proname, left(pg_get_functiondef(p.oid), 1200) AS tanim
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('current_app_role','current_company_id','is_company_member','is_company_admin',
                    'is_admin_or_accounting','get_invite_by_token','get_invite_by_email_code',
                    'create_company_invite','protect_profile_privileged_fields',
                    'enforce_company_members_tenant_write')
ORDER BY p.proname;

-- 4) Solo firmalarin kullanici limiti
SELECT package_code, subscription_plan, max_users, count(*) AS firma_sayisi
FROM public.companies
GROUP BY 1, 2, 3
ORDER BY 4 DESC;
