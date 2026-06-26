-- Fixes: Could not find the function public.provision_trial_admin(...) in the schema cache
-- Run this in Supabase SQL Editor, then wait a few seconds and try again.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role text DEFAULT 'installer';

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS subscription_plan text DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz DEFAULT (now() + interval '7 days');

DROP FUNCTION IF EXISTS public.provision_trial_admin(text, text, integer, text);
DROP FUNCTION IF EXISTS public.provision_trial_admin(text, text, integer);

CREATE OR REPLACE FUNCTION public.provision_trial_admin(
  p_email text,
  p_password text,
  p_trial_days integer DEFAULT 7,
  p_company_name text DEFAULT 'PerdePRO'
)
RETURNS TABLE (
  created_user_id uuid,
  created_company_id uuid,
  email text,
  trial_ends_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $func$
DECLARE
  v_actor_role text;
  v_user_id uuid;
  v_company_id uuid;
  v_trial_days integer;
  v_trial_ends_at timestamptz;
BEGIN
  SELECT role INTO v_actor_role
  FROM public.profiles p
  WHERE p.user_id = auth.uid();

  IF COALESCE(v_actor_role, '') <> 'super_admin' THEN
    RAISE EXCEPTION 'Bu islemi sadece super yonetici yapabilir.';
  END IF;

  IF p_email IS NULL OR position('@' in p_email) = 0 THEN
    RAISE EXCEPTION 'Gecerli e-posta girin.';
  END IF;

  IF p_password IS NULL OR length(p_password) < 6 THEN
    RAISE EXCEPTION 'Sifre en az 6 karakter olmali.';
  END IF;

  v_trial_days := greatest(1, least(coalesce(p_trial_days, 7), 365));
  v_trial_ends_at := now() + make_interval(days => v_trial_days);

  SELECT id INTO v_user_id
  FROM auth.users
  WHERE lower(auth.users.email) = lower(p_email)
  LIMIT 1;

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();

    INSERT INTO auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      confirmation_token,
      recovery_token,
      email_change,
      email_change_token_new,
      email_change_token_current,
      email_change_confirm_status,
      reauthentication_token,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      is_sso_user,
      is_anonymous
    )
    VALUES (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      lower(p_email),
      extensions.crypt(p_password, extensions.gen_salt('bf'::text)),
      now(),
      '',
      '',
      '',
      '',
      '',
      0,
      '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', split_part(p_email, '@', 1), 'role', 'admin'),
      now(),
      now(),
      false,
      false
    );

    INSERT INTO auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    )
    VALUES (
      gen_random_uuid(),
      v_user_id,
      v_user_id::text,
      jsonb_build_object('sub', v_user_id::text, 'email', lower(p_email)),
      'email',
      now(),
      now(),
      now()
    )
    ON CONFLICT DO NOTHING;
  ELSE
    UPDATE auth.users
    SET encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf'::text)),
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        confirmation_token = coalesce(confirmation_token, ''),
        recovery_token = coalesce(recovery_token, ''),
        email_change = coalesce(email_change, ''),
        email_change_token_new = coalesce(email_change_token_new, ''),
        email_change_token_current = coalesce(email_change_token_current, ''),
        email_change_confirm_status = coalesce(email_change_confirm_status, 0),
        reauthentication_token = coalesce(reauthentication_token, ''),
        raw_app_meta_data = coalesce(raw_app_meta_data, '{"provider":"email","providers":["email"]}'::jsonb),
        raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb),
        is_sso_user = coalesce(is_sso_user, false),
        is_anonymous = coalesce(is_anonymous, false),
        updated_at = now()
    WHERE id = v_user_id;
  END IF;

  UPDATE auth.identities ai
  SET provider_id = v_user_id::text,
      identity_data = jsonb_build_object(
        'sub', v_user_id::text,
        'email', lower(p_email),
        'email_verified', true,
        'phone_verified', false
      ),
      last_sign_in_at = coalesce(ai.last_sign_in_at, now()),
      updated_at = now()
  WHERE ai.user_id = v_user_id
    AND ai.provider = 'email';

  IF NOT EXISTS (
    SELECT 1
    FROM auth.identities ai
    WHERE ai.user_id = v_user_id
      AND ai.provider = 'email'
  ) THEN
    INSERT INTO auth.identities (
      id,
      user_id,
      provider_id,
      identity_data,
      provider,
      last_sign_in_at,
      created_at,
      updated_at
    )
    VALUES (
      gen_random_uuid(),
      v_user_id,
      v_user_id::text,
      jsonb_build_object(
        'sub', v_user_id::text,
        'email', lower(p_email),
        'email_verified', true,
        'phone_verified', false
      ),
      'email',
      now(),
      now(),
      now()
    );
  END IF;

  SELECT cm.company_id INTO v_company_id
  FROM public.company_members cm
  WHERE cm.user_id = v_user_id
  LIMIT 1;

  IF v_company_id IS NULL THEN
    INSERT INTO public.companies (name, owner_id, subscription_plan, trial_ends_at)
    VALUES (coalesce(nullif(p_company_name, ''), 'PerdePRO'), v_user_id, 'trial', v_trial_ends_at)
    RETURNING id INTO v_company_id;

    INSERT INTO public.company_members (company_id, user_id, role)
    VALUES (v_company_id, v_user_id, 'admin');
  ELSE
    UPDATE public.companies
    SET name = coalesce(nullif(p_company_name, ''), name),
        subscription_plan = 'trial',
        trial_ends_at = v_trial_ends_at
    WHERE id = v_company_id;

    UPDATE public.company_members
    SET role = 'admin'
    WHERE company_members.company_id = v_company_id
      AND company_members.user_id = v_user_id;
  END IF;

  INSERT INTO public.profiles (user_id, email, full_name, role)
  VALUES (v_user_id, lower(p_email), split_part(p_email, '@', 1), 'admin')
  ON CONFLICT (user_id)
  DO UPDATE SET email = excluded.email, role = 'admin';

  RETURN QUERY
  SELECT v_user_id, v_company_id, lower(p_email), v_trial_ends_at;
END;
$func$;

GRANT EXECUTE ON FUNCTION public.provision_trial_admin(text, text, integer, text) TO authenticated;

DROP FUNCTION IF EXISTS public.extend_company_trial(uuid, integer);

CREATE OR REPLACE FUNCTION public.extend_company_trial(
  p_company_id uuid,
  p_extra_days integer DEFAULT 7
)
RETURNS TABLE (
  extended_company_id uuid,
  new_trial_ends_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $extend$
DECLARE
  v_actor_role text;
  v_extra_days integer;
  v_current_ends_at timestamptz;
  v_new_ends_at timestamptz;
BEGIN
  SELECT p.role INTO v_actor_role
  FROM public.profiles p
  WHERE p.user_id = auth.uid();

  IF COALESCE(v_actor_role, '') <> 'super_admin' THEN
    RAISE EXCEPTION 'Bu islemi sadece super yonetici yapabilir.';
  END IF;

  IF p_company_id IS NULL THEN
    RAISE EXCEPTION 'Sirket secilemedi.';
  END IF;

  v_extra_days := greatest(1, least(coalesce(p_extra_days, 7), 365));

  SELECT c.trial_ends_at INTO v_current_ends_at
  FROM public.companies c
  WHERE c.id = p_company_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sirket bulunamadi.';
  END IF;

  v_new_ends_at := greatest(coalesce(v_current_ends_at, now()), now()) + make_interval(days => v_extra_days);

  UPDATE public.companies c
  SET subscription_plan = 'trial',
      trial_ends_at = v_new_ends_at
  WHERE c.id = p_company_id;

  RETURN QUERY
  SELECT p_company_id, v_new_ends_at;
END;
$extend$;

GRANT EXECUTE ON FUNCTION public.extend_company_trial(uuid, integer) TO authenticated;

NOTIFY pgrst, 'reload schema';
