-- Super yonetici paneli kurulumu
-- SQL Editor'daki her seyi silin, bu dosyanin tamamini yapistirin ve Run'a basin.
-- Asagidaki e-postayi kendi super yonetici giris e-postanizla degistirin.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role text DEFAULT 'installer';

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS subscription_plan text DEFAULT 'trial',
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz DEFAULT (now() + interval '7 days');

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

UPDATE public.profiles SET role = 'installer' WHERE role IN ('staff', 'montaj', 'montajci', 'montajcı');
UPDATE public.profiles SET role = 'admin' WHERE role IN ('manager', 'yönetici', 'yonetici');
UPDATE public.profiles SET role = 'accountant' WHERE role IN ('muhasebe', 'muhasebeci');

ALTER TABLE public.profiles
ADD CONSTRAINT profiles_role_check
CHECK (role IN ('super_admin', 'admin', 'accountant', 'installer'));

CREATE OR REPLACE FUNCTION public.provision_trial_admin(
  p_email text,
  p_password text,
  p_trial_days integer DEFAULT 7,
  p_company_name text DEFAULT 'PerdePRO'
)
RETURNS TABLE (
  user_id uuid,
  company_id uuid,
  email text,
  trial_ends_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $func$
DECLARE
  v_actor_role text;
  v_user_id uuid;
  v_company_id uuid;
  v_trial_days integer;
  v_trial_ends_at timestamptz;
BEGIN
  SELECT role INTO v_actor_role
  FROM public.profiles
  WHERE user_id = auth.uid();

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
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    )
    VALUES (
      v_user_id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      lower(p_email),
      crypt(p_password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', split_part(p_email, '@', 1), 'role', 'admin'),
      now(),
      now()
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
    SET encrypted_password = crypt(p_password, gen_salt('bf')),
        email_confirmed_at = coalesce(email_confirmed_at, now()),
        updated_at = now()
    WHERE id = v_user_id;
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
    SET subscription_plan = 'trial',
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

-- Kendi hesabinizi super_admin yapin.
-- Buradaki e-postayi kendi giris e-postanizla degistirin.
DO $admin$
DECLARE
  v_super_email text := 'ofis@maca.com.tr';
  v_super_user_id uuid;
BEGIN
  SELECT id INTO v_super_user_id
  FROM auth.users
  WHERE lower(email) = lower(v_super_email)
  LIMIT 1;

  IF v_super_user_id IS NULL THEN
    RAISE EXCEPTION 'Super yonetici e-postasi auth.users icinde bulunamadi: %', v_super_email;
  END IF;

  INSERT INTO public.profiles (user_id, email, role)
  VALUES (v_super_user_id, lower(v_super_email), 'super_admin')
  ON CONFLICT (user_id)
  DO UPDATE SET email = excluded.email, role = 'super_admin';
END;
$admin$;
