-- Rollback 030: yeni super-admin RPC'lerini kaldirir.
-- Firma iletisim e-postalari, uye iliskileri ve audit_logs korunur.
BEGIN;
DROP FUNCTION IF EXISTS public.claim_pending_invites_for_current_user();
DROP FUNCTION IF EXISTS public.super_admin_assign_user_to_company(text,uuid,text,boolean);
DROP FUNCTION IF EXISTS public.super_admin_create_company_invite(uuid,text,text);
DROP FUNCTION IF EXISTS public.super_admin_update_company_details(uuid,text,text,text,text,integer,boolean,boolean);
DROP FUNCTION IF EXISTS public.super_admin_link_company_user(uuid,uuid,text,boolean);
DROP FUNCTION IF EXISTS public.super_admin_list_company_members(uuid);
DROP FUNCTION IF EXISTS public.super_admin_search_accounts_by_email(text);
NOTIFY pgrst,'reload schema';
COMMIT;