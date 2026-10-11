-- Salt okunur: 030 icin gerekli kimlik, firma ve audit semasini dogrular.
SELECT table_name,column_name,data_type
FROM information_schema.columns
WHERE table_schema='public'
  AND ((table_name='companies' AND column_name IN ('id','email','name','owner_id','updated_by','updated_at'))
    OR (table_name='profiles' AND column_name IN ('user_id','email','full_name','role','is_active'))
    OR (table_name='company_members' AND column_name IN ('id','company_id','user_id','role','is_active','created_by','updated_by','updated_at'))
    OR (table_name='user_invites' AND column_name IN ('id','company_id','email','role','token','invite_code','expires_at','invited_by','used_at','created_at','updated_at')))
ORDER BY table_name,ordinal_position;

SELECT to_regprocedure('public.super_admin_require()') AS super_admin_guard,
       to_regprocedure('public.super_admin_log_access_change(uuid,text,jsonb,jsonb,text)') AS audit_helper,
  to_regprocedure('public.create_company_invite(uuid,text,text,integer)') AS existing_invite_flow,
  pg_get_function_result(to_regprocedure('public.create_company_invite(uuid,text,text,integer)')) AS invite_result_shape,
  to_regclass('public.companies') AS companies_table,
  to_regclass('public.company_members') AS company_members_table,
  to_regclass('public.user_invites') AS user_invites_table;