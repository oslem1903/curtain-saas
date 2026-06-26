-- Curtain SaaS Auth Schema 500 Fix
-- Purpose:
-- - Fix Supabase Auth signIn/signUp HTTP 500 "Database error querying schema".
-- - Diagnose and repair auth.users triggers, auth hook functions, profiles/company_members/user_invites.
-- - Safe to run more than once. Does not delete existing users or customer data.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- 0) BEFORE DIAGNOSTICS
-- ---------------------------------------------------------------------------

select
  'BEFORE auth.users triggers' as section,
  t.tgname as trigger_name,
  case when (t.tgtype & 4) = 4 then 'insert' else 'other' end as event_type,
  case when (t.tgtype & 2) = 2 then 'before' else 'after' end as timing,
  n.nspname || '.' || p.proname as function_name,
  p.prosecdef as security_definer,
  coalesce(array_to_string(p.proconfig, ', '), '') as function_config
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
join pg_namespace n on n.oid = p.pronamespace
where t.tgrelid = 'auth.users'::regclass
  and not t.tgisinternal
order by t.tgname;

select
  'BEFORE profiles triggers' as section,
  t.tgname as trigger_name,
  n.nspname || '.' || p.proname as function_name,
  p.prosecdef as security_definer,
  coalesce(array_to_string(p.proconfig, ', '), '') as function_config
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
join pg_namespace n on n.oid = p.pronamespace
where t.tgrelid = 'public.profiles'::regclass
  and not t.tgisinternal
order by t.tgname;

select
  'BEFORE auth-like functions' as section,
  n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as function_signature,
  p.prosecdef as security_definer,
  coalesce(array_to_string(p.proconfig, ', '), '') as function_config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'auth')
  and (
    p.proname ilike '%handle_new_user%'
    or p.proname ilike '%create_profile%'
    or p.proname ilike '%custom_access%'
    or p.proname ilike '%access_token%'
    or p.proname ilike '%claims%'
    or p.proname ilike '%hook%'
    or p.proname ilike '%signup%'
  )
order by n.nspname, p.proname;

-- ---------------------------------------------------------------------------
-- 1) REPAIR LOG TABLE
-- ---------------------------------------------------------------------------

create table if not exists public.auth_repair_log (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  user_id uuid,
  email text,
  message text,
  sqlstate text,
  detail text,
  hint text,
  created_at timestamptz not null default now()
);

create index if not exists idx_auth_repair_log_created
on public.auth_repair_log(created_at desc);

-- ---------------------------------------------------------------------------
-- 2) REQUIRED CORE TABLE/COLUMN SHAPE
-- ---------------------------------------------------------------------------

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text,
  created_at timestamptz not null default now()
);

alter table public.companies add column if not exists owner_id uuid;
alter table public.companies add column if not exists is_active boolean not null default true;
alter table public.companies add column if not exists plan_status text default 'trial';
alter table public.companies add column if not exists read_only boolean not null default false;
alter table public.companies add column if not exists trial_end timestamptz;
alter table public.companies add column if not exists trial_ends_at timestamptz;
alter table public.companies add column if not exists updated_by uuid;
alter table public.companies add column if not exists updated_at timestamptz;

create table if not exists public.profiles (
  user_id uuid primary key,
  email text,
  full_name text,
  role text default 'installer',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists role text default 'installer';
alter table public.profiles add column if not exists is_active boolean not null default true;
alter table public.profiles add column if not exists created_at timestamptz default now();
alter table public.profiles add column if not exists updated_at timestamptz;

create table if not exists public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'installer',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table public.company_members add column if not exists role text default 'installer';
alter table public.company_members add column if not exists is_active boolean not null default true;
alter table public.company_members add column if not exists created_at timestamptz default now();
alter table public.company_members add column if not exists updated_at timestamptz;
alter table public.company_members add column if not exists created_by uuid;
alter table public.company_members add column if not exists updated_by uuid;

create table if not exists public.user_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  role text not null,
  token text not null unique,
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_at timestamptz,
  invited_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table public.user_invites add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.user_invites add column if not exists email text;
alter table public.user_invites add column if not exists role text;
alter table public.user_invites add column if not exists token text;
alter table public.user_invites add column if not exists expires_at timestamptz default (now() + interval '7 days');
alter table public.user_invites add column if not exists used_at timestamptz;
alter table public.user_invites add column if not exists invited_by uuid;
alter table public.user_invites add column if not exists created_at timestamptz default now();
alter table public.user_invites add column if not exists updated_at timestamptz;

-- Normalize role values without deleting rows.
update public.profiles
set role = case
  when lower(coalesce(role, '')) in ('superadmin', 'super', 'super_admin', 'super yonetici', 'super yönetici') then 'super_admin'
  when lower(coalesce(role, '')) in ('owner', 'manager', 'yonetici', 'yönetici', 'admin') then 'admin'
  when lower(coalesce(role, '')) in ('accounting', 'muhasebe', 'muhasebeci', 'accountant') then 'accountant'
  when lower(coalesce(role, '')) in ('staff', 'personel', 'personnel', 'montaj', 'montajci', 'montajcı', 'installer') then 'installer'
  when lower(coalesce(role, '')) in ('olcu', 'ölçü', 'measurement') then 'measurement'
  else 'installer'
end
where role is null
   or lower(coalesce(role, '')) not in ('super_admin', 'admin', 'accountant', 'installer', 'measurement', 'personnel');

update public.company_members
set role = case
  when lower(coalesce(role, '')) in ('owner', 'manager', 'yonetici', 'yönetici', 'admin') then 'admin'
  when lower(coalesce(role, '')) in ('accounting', 'muhasebe', 'muhasebeci', 'accountant') then 'accountant'
  when lower(coalesce(role, '')) in ('staff', 'personel', 'personnel', 'montaj', 'montajci', 'montajcı', 'installer') then 'installer'
  when lower(coalesce(role, '')) in ('olcu', 'ölçü', 'measurement') then 'measurement'
  else 'installer'
end
where role is null
   or lower(coalesce(role, '')) not in ('admin', 'accountant', 'installer', 'measurement', 'personnel');

update public.user_invites
set
  email = lower(trim(email)),
  role = case
    when lower(coalesce(role, '')) in ('owner', 'manager', 'yonetici', 'yönetici', 'admin') then 'admin'
    when lower(coalesce(role, '')) in ('accounting', 'muhasebe', 'muhasebeci', 'accountant') then 'accountant'
    when lower(coalesce(role, '')) in ('staff', 'personel', 'personnel', 'montaj', 'montajci', 'montajcı', 'installer') then 'installer'
    when lower(coalesce(role, '')) in ('olcu', 'ölçü', 'measurement') then 'measurement'
    else 'installer'
  end,
  expires_at = coalesce(expires_at, now() + interval '7 days'),
  created_at = coalesce(created_at, now())
where true;

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('super_admin', 'admin', 'accountant', 'installer', 'measurement', 'personnel'));

alter table public.company_members drop constraint if exists company_members_role_check;
alter table public.company_members
  add constraint company_members_role_check
  check (role in ('admin', 'accountant', 'installer', 'measurement', 'personnel'));

alter table public.user_invites drop constraint if exists user_invites_role_check;
alter table public.user_invites
  add constraint user_invites_role_check
  check (role in ('admin', 'accountant', 'installer', 'measurement'));

create unique index if not exists company_members_company_user_uidx
on public.company_members(company_id, user_id);

create unique index if not exists user_invites_token_uidx
on public.user_invites(token);

create index if not exists idx_user_invites_company_email
on public.user_invites(company_id, lower(email));

-- ---------------------------------------------------------------------------
-- 3) SAFE UTILITY FUNCTIONS WITH EXPLICIT search_path + SECURITY DEFINER
-- ---------------------------------------------------------------------------

create or replace function public.generate_invite_token()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_token text;
begin
  begin
    execute 'select encode(extensions.gen_random_bytes(32), ''hex'')' into v_token;
    return v_token;
  exception when undefined_function or invalid_schema_name then
    execute 'select encode(gen_random_bytes(32), ''hex'')' into v_token;
    return v_token;
  end;
end;
$$;

alter table public.user_invites alter column token set default public.generate_invite_token();

update public.user_invites
set token = public.generate_invite_token()
where token is null or token = '';

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(p.role, ''))
  from public.profiles p
  where p.user_id = auth.uid()
  limit 1
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_app_role() = 'super_admin'
$$;

create or replace function public.is_company_admin(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_members cm
    where cm.user_id = auth.uid()
      and cm.company_id = p_company_id
      and coalesce(cm.is_active, true) = true
      and cm.role = 'admin'
  )
$$;

-- ---------------------------------------------------------------------------
-- 4) REMOVE BROKEN TRIGGERS SAFELY
-- ---------------------------------------------------------------------------

-- Auth signIn/signUp must never be blocked by an old custom auth.users trigger.
do $$
declare
  r record;
begin
  for r in
    select tgname
    from pg_trigger
    where tgrelid = 'auth.users'::regclass
      and not tgisinternal
  loop
    execute format('drop trigger if exists %I on auth.users', r.tgname);
  end loop;
end $$;

-- These tenant-write triggers do not belong on auth/profile/invite plumbing.
do $$
declare
  r record;
begin
  for r in
    select t.tgname, c.relname
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace cn on cn.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace pn on pn.oid = p.pronamespace
    where cn.nspname = 'public'
      and c.relname in ('profiles', 'company_members', 'user_invites')
      and not t.tgisinternal
      and (
        t.tgname ilike '%tenant_write%'
        or p.proname in ('enforce_tenant_write', 'check_user_signup')
      )
  loop
    execute format('drop trigger if exists %I on public.%I', r.tgname, r.relname);
  end loop;
end $$;

-- Keep only harmless updated_at triggers on the auth-related public tables.
drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_company_members_updated_at on public.company_members;
create trigger trg_company_members_updated_at
before update on public.company_members
for each row execute function public.set_updated_at();

drop trigger if exists trg_user_invites_updated_at on public.user_invites;
create trigger trg_user_invites_updated_at
before update on public.user_invites
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5) RECREATE SAFE Auth trigger function
-- ---------------------------------------------------------------------------

drop function if exists public.handle_new_user();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text := lower(coalesce(new.email, ''));
  v_full_name text := coalesce(new.raw_user_meta_data->>'full_name', split_part(v_email, '@', 1), '');
  v_role text := lower(coalesce(new.raw_user_meta_data->>'role', 'installer'));
  v_detail text;
  v_hint text;
begin
  if v_role not in ('super_admin', 'admin', 'accountant', 'installer', 'measurement', 'personnel') then
    v_role := 'installer';
  end if;

  begin
    insert into public.profiles(user_id, email, full_name, role, is_active, updated_at)
    values (new.id, v_email, nullif(v_full_name, ''), v_role, true, now())
    on conflict (user_id)
    do update set
      email = coalesce(excluded.email, public.profiles.email),
      full_name = coalesce(excluded.full_name, public.profiles.full_name),
      is_active = coalesce(public.profiles.is_active, true),
      updated_at = now();
  exception when others then
    get stacked diagnostics
      v_detail = pg_exception_detail,
      v_hint = pg_exception_hint;

    begin
      insert into public.auth_repair_log(source, user_id, email, message, sqlstate, detail, hint)
      values ('handle_new_user', new.id, v_email, sqlerrm, sqlstate, v_detail, v_hint);
    exception when others then
      null;
    end;
  end;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- 6) SAFE custom access token hook
-- ---------------------------------------------------------------------------
-- If Supabase Auth Hooks points to public.custom_access_token_hook, a broken
-- function here can break signIn with HTTP 500 "Database error querying schema".
-- This implementation returns the event unchanged and cannot block login.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  return coalesce(event, '{}'::jsonb);
exception when others then
  return coalesce(event, '{}'::jsonb);
end;
$$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    revoke all on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
    grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7) INVITE/JOIN RPCS
-- ---------------------------------------------------------------------------

create or replace function public.get_invite_by_token(p_token text)
returns table(
  invite_id uuid,
  company_id uuid,
  company_name text,
  email text,
  role text,
  expires_at timestamptz,
  used_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select i.id, i.company_id, c.name, lower(i.email), i.role, i.expires_at, i.used_at
  from public.user_invites i
  join public.companies c on c.id = i.company_id
  where i.token = p_token
  limit 1
$$;

grant execute on function public.get_invite_by_token(text) to anon, authenticated;

create or replace function public.accept_invite_for_current_user(
  p_token text,
  p_full_name text default null
)
returns table(company_id uuid, role text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_invite public.user_invites%rowtype;
  v_company public.companies%rowtype;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  if nullif(v_user_email, '') is null then
    select lower(email) into v_user_email
    from auth.users
    where id = v_user_id
    limit 1;
  end if;

  if nullif(v_user_email, '') is null then
    raise exception 'Kullanici e-postasi bulunamadi.';
  end if;

  select * into v_invite
  from public.user_invites
  where token = p_token
  limit 1
  for update;

  if v_invite.id is null then
    raise exception 'Davet bulunamadi veya gecersiz.';
  end if;

  if lower(v_invite.email) <> v_user_email then
    raise exception 'Bu davet farkli bir e-posta adresi icin olusturulmus.';
  end if;

  if v_invite.expires_at < now() then
    raise exception 'Davet suresi dolmus.';
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

  if v_invite.used_at is not null then
    if exists (
      select 1
      from public.company_members cm
      where cm.company_id = v_invite.company_id
        and cm.user_id = v_user_id
    ) then
      return query select v_invite.company_id, v_invite.role;
      return;
    end if;

    raise exception 'Bu davet daha once kullanilmis.';
  end if;

  insert into public.profiles(user_id, email, full_name, role, is_active, updated_at)
  values (
    v_user_id,
    v_user_email,
    coalesce(nullif(trim(p_full_name), ''), split_part(v_user_email, '@', 1)),
    v_invite.role,
    true,
    now()
  )
  on conflict (user_id)
  do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    role = excluded.role,
    is_active = true,
    updated_at = now();

  insert into public.company_members(company_id, user_id, role, is_active, created_by, updated_at)
  values (v_invite.company_id, v_user_id, v_invite.role, true, v_invite.invited_by, now())
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

grant execute on function public.accept_invite_for_current_user(text, text) to authenticated;

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
  v_email text := lower(trim(coalesce(p_email, '')));
  v_invite_id uuid;
  v_token text := public.generate_invite_token();
  v_expires_at timestamptz := now() + make_interval(days => greatest(1, least(coalesce(p_expires_in_days, 7), 30)));
begin
  if not public.is_super_admin() and not public.is_company_admin(p_company_id) then
    raise exception 'Bu daveti olusturma yetkiniz yok.';
  end if;

  if not public.is_super_admin() and v_role = 'admin' then
    raise exception 'Firma yoneticisi yeni admin olusturamaz.';
  end if;

  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'Gecerli bir e-posta adresi girin.';
  end if;

  if v_role not in ('admin', 'accountant', 'installer', 'measurement') then
    raise exception 'Gecersiz rol.';
  end if;

  update public.user_invites
  set used_at = coalesce(used_at, now()),
      updated_at = now()
  where company_id = p_company_id
    and lower(email) = v_email
    and role = v_role
    and used_at is null;

  insert into public.user_invites(company_id, email, role, token, expires_at, invited_by)
  values (p_company_id, v_email, v_role, v_token, v_expires_at, auth.uid())
  returning id into v_invite_id;

  return query select v_invite_id, v_token, v_expires_at;
end;
$$;

grant execute on function public.create_company_invite(uuid, text, text, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 8) FINAL DIAGNOSTICS / HEALTH CHECKS
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';

select
  'AFTER auth.users triggers' as section,
  t.tgname as trigger_name,
  case when (t.tgtype & 4) = 4 then 'insert' else 'other' end as event_type,
  case when (t.tgtype & 2) = 2 then 'before' else 'after' end as timing,
  n.nspname || '.' || p.proname as function_name,
  p.prosecdef as security_definer,
  coalesce(array_to_string(p.proconfig, ', '), '') as function_config
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
join pg_namespace n on n.oid = p.pronamespace
where t.tgrelid = 'auth.users'::regclass
  and not t.tgisinternal
order by t.tgname;

select
  'AFTER profiles/company_members/user_invites triggers' as section,
  c.relname as table_name,
  t.tgname as trigger_name,
  n.nspname || '.' || p.proname as function_name,
  p.prosecdef as security_definer,
  coalesce(array_to_string(p.proconfig, ', '), '') as function_config
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace cn on cn.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
join pg_namespace n on n.oid = p.pronamespace
where cn.nspname = 'public'
  and c.relname in ('profiles', 'company_members', 'user_invites')
  and not t.tgisinternal
order by c.relname, t.tgname;

select
  'auth hook function ready' as check_name,
  to_regprocedure('public.custom_access_token_hook(jsonb)') is not null as ok;

select
  'invite RPCs ready' as check_name,
  to_regprocedure('public.get_invite_by_token(text)') is not null
  and to_regprocedure('public.accept_invite_for_current_user(text,text)') is not null
  and to_regprocedure('public.create_company_invite(uuid,text,text,integer)') is not null as ok;

select
  'role constraints clean' as check_name,
  not exists (
    select 1 from public.profiles
    where role not in ('super_admin', 'admin', 'accountant', 'installer', 'measurement', 'personnel')
  )
  and not exists (
    select 1 from public.company_members
    where role not in ('admin', 'accountant', 'installer', 'measurement', 'personnel')
  )
  and not exists (
    select 1 from public.user_invites
    where role not in ('admin', 'accountant', 'installer', 'measurement')
  ) as ok;

select
  'recent auth repair logs' as section,
  source,
  email,
  message,
  sqlstate,
  created_at
from public.auth_repair_log
order by created_at desc
limit 20;
