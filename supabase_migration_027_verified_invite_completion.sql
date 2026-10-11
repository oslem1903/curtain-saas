-- 027: E-posta onayindan sonra, mevcut Auth hesabi ile guvenli davet tamamlama.
-- Once 027_precheck_readonly.sql; gerekli temel: 024, 025, 026 ve davet kodu semasi.
-- RLS politikalari, Auth dogrulama ayarlari ve mevcut hesaplar degistirilmez.
BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.enforce_company_members_tenant_write()') IS NULL
     OR to_regprocedure('public.company_subscription_allows_write(uuid)') IS NULL
     OR to_regprocedure('public.protect_profile_privileged_fields()') IS NULL THEN
    RAISE EXCEPTION '027 prerequisites missing: inspect migrations 024-026 first';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.company_members'::regclass AND contype IN ('u', 'p')
      AND pg_get_constraintdef(oid) = 'UNIQUE (company_id, user_id)'
  ) THEN
    RAISE EXCEPTION '027 requires UNIQUE (company_id, user_id); inspect duplicates, do not delete users';
  END IF;
END $$;

ALTER TABLE public.user_invites ADD COLUMN IF NOT EXISTS accepted_by uuid REFERENCES auth.users(id);

-- Ic yardimci yalnizca asagidaki SECURITY DEFINER sarmalayicilardan cagrilir.
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

  -- Ayni davete paralel istekleri sirala. Auth ID istemciden alinmaz.
  SELECT i.* INTO v_invite FROM public.user_invites i WHERE i.id = p_invite_id FOR UPDATE;
  IF v_invite.id IS NULL THEN RAISE EXCEPTION 'INVITE_INVALID'; END IF;
  IF lower(trim(v_invite.email)) IS DISTINCT FROM v_email THEN RAISE EXCEPTION 'INVITE_EMAIL_MISMATCH'; END IF;
  IF v_invite.role IS NULL OR v_invite.role NOT IN ('admin','accountant','installer','measurement') THEN
    RAISE EXCEPTION 'INVITE_INVALID';
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = v_uid AND p.is_active = false) THEN
    RAISE EXCEPTION 'PROFILE_INACTIVE';
  END IF;

  -- Farkli davetlerle ayni firmaya paralel katilimda kota yarisi olmasin.
  SELECT c.* INTO v_company FROM public.companies c WHERE c.id = v_invite.company_id FOR UPDATE;
  IF v_company.id IS NULL THEN RAISE EXCEPTION 'COMPANY_UNAVAILABLE'; END IF;
  SELECT m.* INTO v_member FROM public.company_members m
  WHERE m.company_id = v_invite.company_id AND m.user_id = v_uid FOR UPDATE;

  IF v_invite.used_at IS NOT NULL THEN
    -- Tekrar denemek rol degistirmez, pasif kullaniciyi yeniden acmaz.
    -- Eski davetlerde accepted_by bos olabilir; mevcut uyelik zorunludur.
    IF (v_invite.accepted_by IS NOT NULL AND v_invite.accepted_by <> v_uid) OR  v_member.user_id IS NULL THEN
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
  IF  v_member.user_id IS NOT NULL AND NOT coalesce(v_member.is_active, false) THEN
    RAISE EXCEPTION 'MEMBER_INACTIVE';
  END IF;
  IF  v_member.user_id IS NULL AND v_company.max_users IS NOT NULL AND (
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

  INSERT INTO public.company_members(company_id, user_id, role, is_active, created_by, updated_at)
  VALUES (v_invite.company_id, v_uid, v_invite.role, true, v_invite.invited_by, now())
  ON CONFLICT (company_id, user_id) DO UPDATE SET
    role = excluded.role, updated_by = v_invite.invited_by, updated_at = now();

  IF v_invite.role = 'admin' THEN
    UPDATE public.companies c SET owner_id = v_uid, updated_by = v_invite.invited_by, updated_at = now()
    WHERE c.id = v_invite.company_id AND c.owner_id IS NULL;
  END IF;
  UPDATE public.user_invites i SET used_at = now(), accepted_by = v_uid, updated_at = now()
  WHERE i.id = v_invite.id;
  RETURN QUERY SELECT v_invite.company_id, v_invite.role::text;
END $$;
REVOKE ALL ON FUNCTION public.accept_verified_invite(uuid, text) FROM PUBLIC, anon, authenticated;

-- Eski surumlerde OUT kolon isimleri farkli oldugu icin sarmalayicilari yeniden kur.
DROP FUNCTION IF EXISTS public.accept_invite_code_for_current_user(text, text, text);
DROP FUNCTION IF EXISTS public.accept_invite_for_current_user(text, text);
CREATE FUNCTION public.accept_invite_code_for_current_user(p_email text, p_code text, p_full_name text DEFAULT NULL)
RETURNS TABLE(accepted_company_id uuid, accepted_role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid; v_email text;
BEGIN
  SELECT lower(trim(u.email)) INTO v_email FROM auth.users u WHERE u.id = auth.uid();
  IF v_email IS NULL OR lower(trim(p_email)) IS DISTINCT FROM v_email THEN RAISE EXCEPTION 'INVITE_EMAIL_MISMATCH'; END IF;
  SELECT i.id INTO v_id FROM public.user_invites i
  WHERE lower(trim(i.email)) = v_email
    AND upper(replace(i.invite_code, ' ', '')) = upper(replace(trim(p_code), ' ', ''))
    AND nullif(trim(p_code), '') IS NOT NULL
  ORDER BY i.created_at DESC LIMIT 1;
  RETURN QUERY SELECT * FROM public.accept_verified_invite(v_id, p_full_name);
  -- Yeni bir daveti elle kabul etmek, onceki suresi dolmus bekleyen daveti de tamamlar.
  UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data - 'perdepro_invite' WHERE id = auth.uid();
END $$;
CREATE FUNCTION public.accept_invite_for_current_user(p_token text, p_full_name text DEFAULT NULL)
RETURNS TABLE(accepted_company_id uuid, accepted_role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_id uuid;
BEGIN
  SELECT i.id INTO v_id FROM public.user_invites i WHERE i.token = p_token AND nullif(p_token, '') IS NOT NULL;
  RETURN QUERY SELECT * FROM public.accept_verified_invite(v_id, p_full_name);
  -- Yeni bir daveti elle kabul etmek, onceki suresi dolmus bekleyen daveti de tamamlar.
  UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data - 'perdepro_invite' WHERE id = auth.uid();
END $$;
REVOKE ALL ON FUNCTION public.accept_invite_code_for_current_user(text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.accept_invite_for_current_user(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_invite_code_for_current_user(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_invite_for_current_user(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_pending_invite_for_current_user()
RETURNS TABLE(accepted_company_id uuid, accepted_role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE v_meta jsonb; v_email text; v_result record;
BEGIN
  -- Metadata yalnizca davet kanitini tasir; ID, firma, rol veya onay bilgisine guvenilmez.
  SELECT u.raw_user_meta_data, u.email INTO v_meta, v_email FROM auth.users u WHERE u.id = auth.uid() FOR UPDATE;
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'EMAIL_NOT_VERIFIED'; END IF;
  IF v_meta->'perdepro_invite' IS NULL OR v_meta->'perdepro_invite' = 'null'::jsonb THEN RETURN; END IF;
  IF nullif(v_meta->'perdepro_invite'->>'token', '') IS NOT NULL THEN
    SELECT * INTO v_result FROM public.accept_invite_for_current_user(v_meta->'perdepro_invite'->>'token', v_meta->>'full_name');
  ELSIF nullif(v_meta->'perdepro_invite'->>'code', '') IS NOT NULL THEN
    SELECT * INTO v_result FROM public.accept_invite_code_for_current_user(v_email, v_meta->'perdepro_invite'->>'code', v_meta->>'full_name');
  ELSE RAISE EXCEPTION 'INVITE_INVALID'; END IF;
  -- Uyelik + davet + bekleyen isaretinin temizlenmesi ayni transaction icinde.
  UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data - 'perdepro_invite' WHERE id = auth.uid();
  RETURN QUERY SELECT v_result.accepted_company_id::uuid, v_result.accepted_role::text;
END $$;
REVOKE ALL ON FUNCTION public.complete_pending_invite_for_current_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_pending_invite_for_current_user() TO authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
