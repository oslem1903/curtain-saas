-- 038 GERI ALMA. Ekip uyelerini (is_owner=false) once pasife alir; kayitlari silmez.
-- accept_verified_invite icin supabase_migration_027_verified_invite_completion.sql dosyasini yeniden calistirin
-- (027, fonksiyonlari CREATE OR REPLACE ile yeniden kurar).
BEGIN;
UPDATE public.company_members SET is_active = false WHERE NOT is_owner;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['company_members','user_invites','billing_payments','billing_subscriptions','billing_test_companies','companies'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_owner_only_write ON public.%I', t);
    END IF;
  END LOOP;
END $$;

DROP FUNCTION IF EXISTS public.list_company_team(uuid);
DROP FUNCTION IF EXISTS public.update_team_member(uuid, uuid, text[], boolean);
DROP FUNCTION IF EXISTS public.revoke_team_invite(uuid);
DROP FUNCTION IF EXISTS public.create_team_invite(uuid, text, text[]);
DROP FUNCTION IF EXISTS public.team_valid_modules(uuid, text[]);
DROP FUNCTION IF EXISTS public.enforce_owner_only_write();
DROP FUNCTION IF EXISTS public.is_company_owner(uuid);

-- Kolonlar bilerek silinmez (veri kaybi olmasin); eski kod bunlari yok sayar.
-- Solo max_users 3'e geri alinmaz: ekip uyeleri varsa limit asilir.
NOTIFY pgrst, 'reload schema';
COMMIT;
