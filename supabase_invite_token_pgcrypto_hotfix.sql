-- Fix invite token generation when pgcrypto functions live in the extensions schema.
-- Run this in Supabase SQL Editor.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter table public.user_invites
  alter column token set default encode(extensions.gen_random_bytes(32), 'hex');

create or replace function public.create_company_invite(
  p_company_id uuid,
  p_email text,
  p_role text,
  p_expires_in_days integer default 7
)
returns table(invite_id uuid, token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := lower(coalesce(p_role, ''));
  v_invite_id uuid;
  v_token text;
  v_expires_at timestamptz;
begin
  if not public.is_super_admin() and not public.is_company_admin(p_company_id) then
    raise exception 'Bu daveti olusturma yetkiniz yok.';
  end if;

  if not public.is_super_admin() and v_role = 'admin' then
    raise exception 'Firma yoneticisi yeni admin olusturamaz.';
  end if;

  if v_role not in ('admin', 'accountant', 'installer', 'measurement') then
    raise exception 'Gecersiz rol.';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires_at := now() + make_interval(days => greatest(1, least(coalesce(p_expires_in_days, 7), 30)));

  insert into public.user_invites(company_id, email, role, token, expires_at, invited_by)
  values (p_company_id, lower(trim(p_email)), v_role, v_token, v_expires_at, auth.uid())
  returning id into v_invite_id;

  return query select v_invite_id, v_token, v_expires_at;
end;
$$;

grant execute on function public.create_company_invite(uuid, text, text, integer) to authenticated;

create or replace function public.create_company_with_owner_invite(
  p_company_name text,
  p_owner_email text,
  p_trial_days integer default 7,
  p_is_pilot boolean default false
)
returns table(
  company_id uuid,
  invite_id uuid,
  token text,
  expires_at timestamptz,
  trial_end timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_invite_id uuid;
  v_token text;
  v_expires_at timestamptz;
  v_trial_days integer := greatest(1, least(coalesce(p_trial_days, 7), 365));
  v_trial_end timestamptz := now() + make_interval(days => greatest(1, least(coalesce(p_trial_days, 7), 365)));
begin
  if not public.is_super_admin() then
    raise exception 'Sadece super admin firma ve ilk yonetici daveti olusturabilir.';
  end if;

  if nullif(trim(p_company_name), '') is null then
    raise exception 'Firma adi zorunludur.';
  end if;

  if nullif(trim(p_owner_email), '') is null or position('@' in p_owner_email) = 0 then
    raise exception 'Gecerli bir yonetici e-postasi girin.';
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires_at := now() + make_interval(days => least(v_trial_days, 30));

  insert into public.companies(
    name,
    subscription_plan,
    max_users,
    enabled_modules,
    branch_limit,
    plan_status,
    trial_start,
    trial_end,
    trial_ends_at,
    is_pilot,
    is_active,
    read_only,
    created_by
  )
  values (
    trim(p_company_name),
    'starter',
    3,
    array['orders','customers','appointments'],
    1,
    'trial',
    now(),
    v_trial_end,
    v_trial_end,
    coalesce(p_is_pilot, false),
    true,
    false,
    auth.uid()
  )
  returning id into v_company_id;

  insert into public.user_invites(company_id, email, role, token, expires_at, invited_by)
  values (v_company_id, lower(trim(p_owner_email)), 'admin', v_token, v_expires_at, auth.uid())
  returning id into v_invite_id;

  return query select v_company_id, v_invite_id, v_token, v_expires_at, v_trial_end;
end;
$$;

grant execute on function public.create_company_with_owner_invite(text, text, integer, boolean) to authenticated;

-- Quick check:
select encode(extensions.gen_random_bytes(4), 'hex') as pgcrypto_ok;
