-- Repairs the Supabase Auth row for the generated admin user.
-- Run this after replacing the email/password below if needed.

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

UPDATE auth.users u
SET encrypted_password = extensions.crypt('123456', extensions.gen_salt('bf'::text)),
    email_confirmed_at = coalesce(u.email_confirmed_at, now()),
    confirmation_token = coalesce(u.confirmation_token, ''),
    recovery_token = coalesce(u.recovery_token, ''),
    email_change = coalesce(u.email_change, ''),
    email_change_token_new = coalesce(u.email_change_token_new, ''),
    email_change_token_current = coalesce(u.email_change_token_current, ''),
    email_change_confirm_status = coalesce(u.email_change_confirm_status, 0),
    reauthentication_token = coalesce(u.reauthentication_token, ''),
    raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
    raw_user_meta_data = coalesce(u.raw_user_meta_data, '{}'::jsonb),
    is_sso_user = coalesce(u.is_sso_user, false),
    is_anonymous = coalesce(u.is_anonymous, false),
    updated_at = now()
WHERE lower(u.email) = lower('storingtekstli@gmail.com');

UPDATE auth.identities i
SET provider_id = u.id::text,
    identity_data = jsonb_build_object(
      'sub', u.id::text,
      'email', lower(u.email),
      'email_verified', true,
      'phone_verified', false
    ),
    provider = 'email',
    last_sign_in_at = coalesce(i.last_sign_in_at, now()),
    updated_at = now()
FROM auth.users u
WHERE i.user_id = u.id
  AND lower(u.email) = lower('storingtekstli@gmail.com')
  AND i.provider = 'email';

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
SELECT
  gen_random_uuid(),
  u.id,
  u.id::text,
  jsonb_build_object(
    'sub', u.id::text,
    'email', lower(u.email),
    'email_verified', true,
    'phone_verified', false
  ),
  'email',
  now(),
  now(),
  now()
FROM auth.users u
WHERE lower(u.email) = lower('storingtekstli@gmail.com')
  AND NOT EXISTS (
    SELECT 1
    FROM auth.identities i
    WHERE i.user_id = u.id
      AND i.provider = 'email'
  );

UPDATE public.profiles p
SET role = 'admin',
    email = lower('storingtekstli@gmail.com')
FROM auth.users u
WHERE p.user_id = u.id
  AND lower(u.email) = lower('storingtekstli@gmail.com');

UPDATE public.company_members cm
SET role = 'admin'
FROM auth.users u
WHERE cm.user_id = u.id
  AND lower(u.email) = lower('storingtekstli@gmail.com');

NOTIFY pgrst, 'reload schema';
