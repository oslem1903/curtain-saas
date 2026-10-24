-- 038: Firma ekip uyeleri (e-posta daveti, kullanici basina modul, sahip-kilidi).
-- Once 038_precheck_readonly.sql; temel: 024-027, 030. PROD'A UYGULAMADAN ONCE ONAY GEREKIR.
--
-- Tasarim:
--  * Ekip uyesi DB'de mevcut 'admin' rolunu alir (tum veri politikalari ayni calisir).
--  * company_members.is_owner = firma sahibi. Mevcut tum uyeler sahip sayilir (default true).
--  * Ekip uyesi (is_owner=false) companies / company_members / user_invites / billing_*
--    tablolarina DOGRUDAN yazamaz (tetikleyici). Yonetim islemleri SECURITY DEFINER RPC'lerdendir.
--  * Modul kisiti (allowed_modules) menu ve rota seviyesinde uygulanir; veri kilidi DEGILDIR.
--  * Solo firmalarda kullanici sinirina 3 ekip uyesi eklenir (3 -> 4).
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.is_super_admin()') IS NULL
     OR to_regprocedure('public.company_subscription_allows_write(uuid)') IS NULL
     OR to_regprocedure('public.accept_verified_invite(uuid,text)') IS NULL THEN
    RAISE EXCEPTION '038 prerequisites missing: apply 024-027 first';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 1) Kolonlar
-- ---------------------------------------------------------------------------
ALTER TABLE public.company_members ADD COLUMN IF NOT EXISTS is_owner boolean NOT NULL DEFAULT true;
ALTER TABLE public.company_members ADD COLUMN IF NOT EXISTS allowed_modules text[];
ALTER TABLE public.user_invites ADD COLUMN IF NOT EXISTS is_team_member boolean NOT NULL DEFAULT false;
ALTER TABLE public.user_invites ADD COLUMN IF NOT EXISTS allowed_modules text[];
ALTER TABLE public.user_invites ALTER COLUMN invite_code DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- 2) Sahip denetimi
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_company_owner(p_company_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT coalesce(public.is_super_admin(), false) OR EXISTS (
    SELECT 1 FROM public.company_members m
    WHERE m.company_id = p_company_id AND m.user_id = auth.uid()
      AND coalesce(m.is_active, true) AND m.is_owner
  )
$$;
REVOKE ALL ON FUNCTION public.is_company_owner(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_company_owner(uuid) TO authenticated;

-- INVOKER: current_user, DML'i yapan rolu gosterir. Dogrudan API yazimi 'authenticated',
-- SECURITY DEFINER RPC icindeki yazim fonksiyon sahibi olarak gelir ve gecer.
CREATE OR REPLACE FUNCTION public.enforce_owner_only_write()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp
AS $$
DECLARE v_row jsonb; v_company text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') OR auth.uid() IS NULL THEN
    RETURN coalesce(NEW, OLD);
  END IF;
  v_row := to_jsonb(coalesce(NEW, OLD));
  v_company := CASE TG_TABLE_NAME WHEN 'companies' THEN v_row->>'id' ELSE v_row->>'company_id' END;
  IF v_company IS NULL OR NOT public.is_company_owner(v_company::uuid) THEN
    RAISE EXCEPTION 'OWNER_ONLY: bu islemi yalnizca firma sahibi yapabilir.' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['company_members','user_invites','billing_payments','billing_subscriptions','billing_test_companies'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_owner_only_write ON public.%I', t);
      EXECUTE format('CREATE TRIGGER trg_owner_only_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.enforce_owner_only_write()', t);
    END IF;
  END LOOP;
  -- companies: ekleme (self-service RPC) etkilenmez; yalnizca guncelleme/silme.
  DROP TRIGGER IF EXISTS trg_owner_only_write ON public.companies;
  CREATE TRIGGER trg_owner_only_write BEFORE UPDATE OR DELETE ON public.companies
    FOR EACH ROW EXECUTE FUNCTION public.enforce_owner_only_write();
END $$;

-- ---------------------------------------------------------------------------
-- 3) Davet kabulu: ekip uyesi sahip OLMAZ, modulleri davetten gelir
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_verified_invite(p_invite_id uuid, p_full_name text DEFAULT NULL)
RETURNS TABLE(accepted_company_id uuid, accepted_role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_confirmed timestamptz;
  v_invite public.user_invites%rowtype;
  v_company public.companies%rowtype;
  v_member public.company_members%rowtype;
BEGIN
  SELECT lower(trim(u.email)), u.email_confirmed_at INTO v_email, v_confirmed
  FROM auth.users u WHERE u.id = v_uid FOR UPDATE;
  IF v_uid IS NULL OR v_email IS NULL OR v_confirmed IS NULL THEN
    RAISE EXCEPTION 'EMAIL_NOT_VERIFIED';
  END IF;

  SELECT i.* INTO v_invite FROM public.user_invites i WHERE i.id = p_invite_id FOR UPDATE;
  IF v_invite.id IS NULL THEN RAISE EXCEPTION 'INVITE_INVALID'; END IF;
  IF lower(trim(v_invite.email)) IS DISTINCT FROM v_email THEN RAISE EXCEPTION 'INVITE_EMAIL_MISMATCH'; END IF;
  IF v_invite.role IS NULL OR v_invite.role NOT IN ('admin','accountant','installer','measurement') THEN
    RAISE EXCEPTION 'INVITE_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = v_uid AND p.is_active = false) THEN
    RAISE EXCEPTION 'PROFILE_INACTIVE';
  END IF;

  SELECT c.* INTO v_company FROM public.companies c WHERE c.id = v_invite.company_id FOR UPDATE;
  IF v_company.id IS NULL THEN RAISE EXCEPTION 'COMPANY_UNAVAILABLE'; END IF;
  SELECT m.* INTO v_member FROM public.company_members m
  WHERE m.company_id = v_invite.company_id AND m.user_id = v_uid FOR UPDATE;

  IF v_invite.used_at IS NOT NULL THEN
    IF (v_invite.accepted_by IS NOT NULL AND v_invite.accepted_by <> v_uid) OR v_member.user_id IS NULL THEN
      RAISE EXCEPTION 'INVITE_USED';
    END IF;
    IF NOT coalesce(v_member.is_active, false) THEN RAISE EXCEPTION 'MEMBER_INACTIVE'; END IF;
    RETURN QUERY SELECT v_member.company_id, v_member.role::text;
    RETURN;
  END IF;
  IF v_invite.expires_at IS NULL OR v_invite.expires_at <= now() THEN RAISE EXCEPTION 'INVITE_EXPIRED'; END IF;
  IF NOT coalesce(v_company.is_active, false) OR coalesce(v_company.read_only, false)
     OR v_company.plan_status = 'suspended'
     OR NOT coalesce(public.company_subscription_allows_write(v_company.id), false) THEN
    RAISE EXCEPTION 'COMPANY_UNAVAILABLE';
  END IF;
  IF v_member.user_id IS NOT NULL AND NOT coalesce(v_member.is_active, false) THEN
    RAISE EXCEPTION 'MEMBER_INACTIVE';
  END IF;
  IF v_member.user_id IS NULL AND v_company.max_users IS NOT NULL AND (
    SELECT count(DISTINCT m.user_id) FROM public.company_members m
    WHERE m.company_id = v_company.id AND coalesce(m.is_active, true)
  ) >= v_company.max_users THEN RAISE EXCEPTION 'MEMBER_LIMIT'; END IF;

  INSERT INTO public.profiles(user_id, email, full_name, role, is_active, updated_at)
  VALUES (v_uid, v_email, left(coalesce(nullif(trim(p_full_name), ''), split_part(v_email, '@', 1)), 120), v_invite.role, true, now())
  ON CONFLICT (user_id) DO UPDATE SET
    email = excluded.email,
    full_name = coalesce(public.profiles.full_name, excluded.full_name),
    role = CASE WHEN public.profiles.role = 'super_admin' THEN public.profiles.role ELSE excluded.role END,
    updated_at = now();

  INSERT INTO public.company_members(company_id, user_id, role, is_active, created_by, updated_at, is_owner, allowed_modules)
  VALUES (v_invite.company_id, v_uid, v_invite.role, true, v_invite.invited_by, now(),
          NOT v_invite.is_team_member,
          CASE WHEN v_invite.is_team_member THEN v_invite.allowed_modules ELSE NULL END)
  ON CONFLICT (company_id, user_id) DO UPDATE SET
    role = excluded.role, updated_by = v_invite.invited_by, updated_at = now(),
    -- Mevcut sahip, ekip daveti ile dusurulmez.
    is_owner = public.company_members.is_owner OR excluded.is_owner,
    allowed_modules = CASE WHEN public.company_members.is_owner THEN public.company_members.allowed_modules
                           ELSE excluded.allowed_modules END;

  IF v_invite.role = 'admin' AND NOT v_invite.is_team_member THEN
    UPDATE public.companies c SET owner_id = v_uid, updated_by = v_invite.invited_by, updated_at = now()
    WHERE c.id = v_invite.company_id AND c.owner_id IS NULL;
  END IF;
  UPDATE public.user_invites i SET used_at = now(), accepted_by = v_uid, updated_at = now()
  WHERE i.id = v_invite.id;
  RETURN QUERY SELECT v_invite.company_id, v_invite.role::text;
END $$;
REVOKE ALL ON FUNCTION public.accept_verified_invite(uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) Yonetim RPC'leri (yalnizca firma sahibi / super admin)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.team_valid_modules(p_company_id uuid, p_modules text[])
RETURNS text[] LANGUAGE plpgsql STABLE SET search_path = public, pg_temp
AS $$
DECLARE
  v_known text[] := ARRAY['measurements','orders','customers','appointments','suppliers','installation','collections',
                          'accounting','reports','expenses','profit','staff','catalogs','vehicles','commissions','warehouse','branches'];
  v_company_modules text[];
  v_clean text[];
BEGIN
  SELECT c.enabled_modules INTO v_company_modules FROM public.companies c WHERE c.id = p_company_id;
  SELECT coalesce(array_agg(DISTINCT m ORDER BY m), ARRAY[]::text[]) INTO v_clean
  FROM unnest(coalesce(p_modules, ARRAY[]::text[])) AS m WHERE m = ANY (v_known);
  IF cardinality(v_clean) = 0 THEN RAISE EXCEPTION 'MODULES_REQUIRED'; END IF;
  IF cardinality(v_clean) <> cardinality(ARRAY(SELECT DISTINCT unnest(coalesce(p_modules, ARRAY[]::text[])))) THEN
    RAISE EXCEPTION 'MODULE_INVALID';
  END IF;
  IF coalesce(cardinality(v_company_modules), 0) > 0
     AND EXISTS (SELECT 1 FROM unnest(v_clean) m WHERE NOT (m = ANY (v_company_modules))) THEN
    RAISE EXCEPTION 'MODULE_NOT_IN_PLAN';
  END IF;
  RETURN v_clean;
END $$;

CREATE OR REPLACE FUNCTION public.create_team_invite(p_company_id uuid, p_email text, p_modules text[])
RETURNS TABLE(invite_id uuid, token text, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_email text := lower(trim(coalesce(p_email, '')));
  v_company public.companies%rowtype;
  v_modules text[];
  v_tok text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_exp timestamptz := now() + interval '7 days';
  v_id uuid;
  v_taken integer;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_company_owner(p_company_id) THEN RAISE EXCEPTION 'OWNER_ONLY'; END IF;
  IF v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' THEN RAISE EXCEPTION 'EMAIL_INVALID'; END IF;
  SELECT c.* INTO v_company FROM public.companies c WHERE c.id = p_company_id FOR UPDATE;
  IF v_company.id IS NULL THEN RAISE EXCEPTION 'COMPANY_UNAVAILABLE'; END IF;
  IF NOT coalesce(v_company.is_active, false) OR coalesce(v_company.read_only, false)
     OR NOT coalesce(public.company_subscription_allows_write(p_company_id), false) THEN
    RAISE EXCEPTION 'COMPANY_UNAVAILABLE';
  END IF;
  v_modules := public.team_valid_modules(p_company_id, p_modules);

  IF EXISTS (
    SELECT 1 FROM public.company_members m JOIN auth.users u ON u.id = m.user_id
    WHERE m.company_id = p_company_id AND coalesce(m.is_active, true) AND lower(trim(u.email)) = v_email
  ) THEN RAISE EXCEPTION 'ALREADY_MEMBER'; END IF;

  -- Ayni e-postaya bekleyen davet varsa yenilenir (kota ikinci kez dusmez).
  SELECT i.id INTO v_id FROM public.user_invites i
  WHERE i.company_id = p_company_id AND lower(trim(i.email)) = v_email AND i.used_at IS NULL AND i.is_team_member
  ORDER BY i.created_at DESC LIMIT 1 FOR UPDATE;

  IF v_id IS NULL THEN
    SELECT (SELECT count(DISTINCT m.user_id) FROM public.company_members m
            WHERE m.company_id = p_company_id AND coalesce(m.is_active, true))
         + (SELECT count(*) FROM public.user_invites i
            WHERE i.company_id = p_company_id AND i.used_at IS NULL AND i.expires_at > now()) INTO v_taken;
    IF v_company.max_users IS NOT NULL AND v_taken >= v_company.max_users THEN RAISE EXCEPTION 'MEMBER_LIMIT'; END IF;
    INSERT INTO public.user_invites(company_id, email, role, token, invite_code, expires_at, invited_by, is_team_member, allowed_modules)
    VALUES (p_company_id, v_email, 'admin', v_tok, NULL, v_exp, auth.uid(), true, v_modules)
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.user_invites i SET token = v_tok, expires_at = v_exp, allowed_modules = v_modules,
      invited_by = auth.uid(), updated_at = now() WHERE i.id = v_id;
  END IF;
  RETURN QUERY SELECT v_id, v_tok, v_exp;
END $$;

CREATE OR REPLACE FUNCTION public.revoke_team_invite(p_invite_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_company uuid;
BEGIN
  SELECT i.company_id INTO v_company FROM public.user_invites i
  WHERE i.id = p_invite_id AND i.used_at IS NULL AND i.is_team_member;
  IF v_company IS NULL THEN RAISE EXCEPTION 'INVITE_INVALID'; END IF;
  IF auth.uid() IS NULL OR NOT public.is_company_owner(v_company) THEN RAISE EXCEPTION 'OWNER_ONLY'; END IF;
  DELETE FROM public.user_invites WHERE id = p_invite_id;
END $$;

CREATE OR REPLACE FUNCTION public.update_team_member(p_company_id uuid, p_user_id uuid, p_modules text[], p_is_active boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_member public.company_members%rowtype;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_company_owner(p_company_id) THEN RAISE EXCEPTION 'OWNER_ONLY'; END IF;
  SELECT m.* INTO v_member FROM public.company_members m
  WHERE m.company_id = p_company_id AND m.user_id = p_user_id FOR UPDATE;
  IF v_member.user_id IS NULL OR v_member.is_owner THEN RAISE EXCEPTION 'MEMBER_INVALID'; END IF;
  UPDATE public.company_members m SET
    allowed_modules = CASE WHEN p_modules IS NULL THEN m.allowed_modules ELSE public.team_valid_modules(p_company_id, p_modules) END,
    is_active = coalesce(p_is_active, m.is_active),
    updated_by = auth.uid(), updated_at = now()
  WHERE m.company_id = p_company_id AND m.user_id = p_user_id;
END $$;

CREATE OR REPLACE FUNCTION public.list_company_team(p_company_id uuid)
RETURNS TABLE(kind text, user_id uuid, invite_id uuid, email text, full_name text, is_owner boolean,
              is_active boolean, allowed_modules text[], expires_at timestamptz, joined_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_company_owner(p_company_id) THEN RAISE EXCEPTION 'OWNER_ONLY'; END IF;
  RETURN QUERY
    SELECT 'member'::text, m.user_id, NULL::uuid, lower(trim(u.email))::text, p.full_name::text, m.is_owner,
           coalesce(m.is_active, true), m.allowed_modules, NULL::timestamptz, m.created_at
    FROM public.company_members m
    JOIN auth.users u ON u.id = m.user_id
    LEFT JOIN public.profiles p ON p.user_id = m.user_id
    WHERE m.company_id = p_company_id
    UNION ALL
    SELECT 'invite'::text, NULL::uuid, i.id, lower(trim(i.email))::text, NULL::text, false,
           true, i.allowed_modules, i.expires_at, i.created_at
    FROM public.user_invites i
    WHERE i.company_id = p_company_id AND i.is_team_member AND i.used_at IS NULL;
END $$;

REVOKE ALL ON FUNCTION public.team_valid_modules(uuid, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_team_invite(uuid, text, text[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.revoke_team_invite(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_team_member(uuid, uuid, text[], boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_company_team(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.team_valid_modules(uuid, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_team_invite(uuid, text, text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_team_invite(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_team_member(uuid, uuid, text[], boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.list_company_team(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5) Solo kullanici siniri: sahip + 3 ekip uyesi
--    (Elle ozellestirilmis degerler -- ornegin 100 -- degismez.)
-- ---------------------------------------------------------------------------
UPDATE public.companies SET max_users = 4
WHERE lower(coalesce(package_code, '')) IN ('solo', 'solo_perdeci') AND max_users = 3;
UPDATE public.self_signup_settings SET max_users = 4
WHERE lower(coalesce(package_code, '')) IN ('solo', 'solo_perdeci') AND max_users = 3;

NOTIFY pgrst, 'reload schema';
COMMIT;
