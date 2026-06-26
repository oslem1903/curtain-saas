-- Mail + code invite flow for customer account onboarding.
-- Run this in Supabase SQL Editor after the existing SaaS invite migrations.

create extension if not exists pgcrypto with schema extensions;

alter table public.user_invites add column if not exists invite_code text;

create unique index if not exists user_invites_invite_code_uidx
on public.user_invites(invite_code)
where invite_code is not null;

create index if not exists idx_user_invites_email_code_unused
on public.user_invites(lower(email), invite_code)
where used_at is null;

create or replace function public.generate_invite_code()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  loop
    v_code := upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 3) || '-' || substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 3));
    exit when not exists (
      select 1 from public.user_invites where invite_code = v_code
    );
  end loop;
  return v_code;
end;
$$;

update public.user_invites
set invite_code = public.generate_invite_code()
where invite_code is null
  and used_at is null;

drop function if exists public.create_company_invite(uuid, text, text, integer);

create or replace function public.create_company_invite(
  p_company_id uuid,
  p_email text,
  p_role text,
  p_expires_in_days integer default 7
)
returns table(invite_id uuid, token text, invite_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := lower(coalesce(p_role, ''));
  v_invite_id uuid;
  v_token text;
  v_invite_code text;
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
  v_invite_code := public.generate_invite_code();
  v_expires_at := now() + make_interval(days => greatest(1, least(coalesce(p_expires_in_days, 7), 30)));

  insert into public.user_invites(company_id, email, role, token, invite_code, expires_at, invited_by)
  values (p_company_id, lower(trim(p_email)), v_role, v_token, v_invite_code, v_expires_at, auth.uid())
  returning id into v_invite_id;

  return query select v_invite_id, v_token, v_invite_code, v_expires_at;
end;
$$;

grant execute on function public.create_company_invite(uuid, text, text, integer) to authenticated;

drop function if exists public.create_company_with_owner_invite(text, text, integer, boolean);

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
  invite_code text,
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
  v_invite_code text;
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
  v_invite_code := public.generate_invite_code();
  v_expires_at := now() + make_interval(days => least(v_trial_days, 30));

  insert into public.companies(
    name, subscription_plan, max_users, enabled_modules, branch_limit, plan_status,
    trial_start, trial_end, trial_ends_at, is_pilot, is_active, read_only, created_by
  )
  values (
    trim(p_company_name), 'starter', 3, array['orders','customers','appointments'],
    1, 'trial', now(), v_trial_end, v_trial_end, coalesce(p_is_pilot, false), true, false, auth.uid()
  )
  returning id into v_company_id;

  insert into public.user_invites(company_id, email, role, token, invite_code, expires_at, invited_by)
  values (v_company_id, lower(trim(p_owner_email)), 'admin', v_token, v_invite_code, v_expires_at, auth.uid())
  returning id into v_invite_id;

  return query select v_company_id, v_invite_id, v_token, v_invite_code, v_expires_at, v_trial_end;
end;
$$;

grant execute on function public.create_company_with_owner_invite(text, text, integer, boolean) to authenticated;

create or replace function public.get_invite_by_email_code(p_email text, p_code text)
returns table(
  invite_id uuid,
  company_id uuid,
  company_name text,
  email text,
  role text,
  expires_at timestamptz,
  used_at timestamptz,
  invite_code text
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.company_id, c.name, i.email, i.role, i.expires_at, i.used_at, i.invite_code
  from public.user_invites i
  join public.companies c on c.id = i.company_id
  where lower(i.email) = lower(trim(p_email))
    and upper(replace(i.invite_code, ' ', '')) = upper(replace(trim(p_code), ' ', ''))
  order by i.created_at desc
  limit 1
$$;

grant execute on function public.get_invite_by_email_code(text, text) to anon, authenticated;

drop function if exists public.accept_invite_code_for_current_user(text, text, text);

create or replace function public.accept_invite_code_for_current_user(
  p_email text,
  p_code text,
  p_full_name text default null
)
returns table(company_id uuid, role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_invite record;
  v_company record;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  select lower(email) into v_user_email
  from auth.users
  where id = v_user_id
  limit 1;

  if v_user_email is null then
    raise exception 'Kullanici e-postasi bulunamadi.';
  end if;

  if lower(trim(p_email)) <> v_user_email then
    raise exception 'Kod farkli bir e-posta adresi icin girildi.';
  end if;

  select * into v_invite
  from public.user_invites
  where lower(email) = v_user_email
    and upper(replace(invite_code, ' ', '')) = upper(replace(trim(p_code), ' ', ''))
  order by created_at desc
  limit 1;

  if v_invite.id is null then
    raise exception 'Davet kodu bulunamadi veya gecersiz.';
  end if;

  if v_invite.used_at is not null then
    raise exception 'Bu davet kodu daha once kullanilmis.';
  end if;

  if v_invite.expires_at < now() then
    raise exception 'Davet kodunun suresi dolmus.';
  end if;

  if v_invite.role not in ('admin', 'accountant', 'installer', 'measurement') then
    raise exception 'Davet rolu gecersiz.';
  end if;

  select * into v_company
  from public.companies
  where id = v_invite.company_id
  limit 1;

  if v_company.id is null then
    raise exception 'Davet edilen firma bulunamadi.';
  end if;

  if coalesce(v_company.is_active, true) = false
     or coalesce(v_company.plan_status, 'trial') = 'suspended' then
    raise exception 'Firma aktif degil. Lutfen yonetici ile iletisime gecin.';
  end if;

  insert into public.profiles(user_id, email, full_name, role, is_active)
  values (v_user_id, v_user_email, coalesce(nullif(trim(p_full_name), ''), split_part(v_user_email, '@', 1)), v_invite.role, true)
  on conflict (user_id)
  do update set
    email = excluded.email,
    role = excluded.role,
    is_active = true,
    updated_at = now();

  insert into public.company_members(company_id, user_id, role, is_active, created_by)
  values (v_invite.company_id, v_user_id, v_invite.role, true, v_invite.invited_by)
  on conflict (company_id, user_id)
  do update set
    role = excluded.role,
    is_active = true,
    updated_by = v_invite.invited_by,
    updated_at = now();

  if v_invite.role = 'admin' then
    update public.companies
    set owner_id = coalesce(owner_id, v_user_id),
        updated_by = v_invite.invited_by,
        updated_at = now()
    where id = v_invite.company_id
      and owner_id is null;
  end if;

  update public.user_invites
  set used_at = now(),
      updated_at = now()
  where id = v_invite.id
    and used_at is null;

  return query select v_invite.company_id, v_invite.role;
end;
$$;

grant execute on function public.accept_invite_code_for_current_user(text, text, text) to authenticated;
