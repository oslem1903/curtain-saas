-- Salt okunur: migration 030 RPC'leri, guvenlik tanimi ve execute grantlerini dogrular.
SELECT p.oid::regprocedure AS function_name,p.prosecdef AS security_definer,
       has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_can_execute,
       has_function_privilege('anon',p.oid,'EXECUTE') AS anon_can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN (
  'super_admin_search_accounts_by_email','super_admin_list_company_members',
  'super_admin_link_company_user','super_admin_update_company_details',
  'super_admin_create_company_invite','super_admin_assign_user_to_company','claim_pending_invites_for_current_user'
)
ORDER BY p.proname;

SELECT count(*) AS active_members
FROM public.company_members WHERE coalesce(is_active,true);