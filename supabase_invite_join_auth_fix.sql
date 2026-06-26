-- Curtain SaaS targeted invite/join auth fix.
-- Run this in Supabase SQL Editor after supabase_schema_repair_invites_errors.sql.
-- Safe to run more than once. It does not delete customer/company/order data.
--
-- Fixes targeted here:
-- 1) Auth signup "Database error finding user" from old auth.users triggers.
-- 2) Invite accept flow for existing auth users and repeated invites.
-- 3) Role/profile/company_members constraints used by invite/join.
-- 4) Diagnostics for checking the exact invite state from SQL Editor.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

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

create or replace function public.set_user_triggers_if_table_exists(
  p_table_name text,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('public.' || p_table_name) is null then
    return;
  end if;

  execute format(
    'alter table public.%I %s trigger user',
    p_table_name,
    case when p_enabled then 'enable' else 'disable' end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Core columns and constraints required by join.
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
alter table public.companies add column if not exists updated_by uuid;
alter table public.companies add column if not exists updated_at timestamptz;

select public.set_user_triggers_if_table_exists('companies', false);

update public.companies
set
  is_active = coalesce(is_active, true),
  plan_status = coalesce(plan_status, 'trial'),
  read_only = coalesce(read_only, false),
  updated_at = coalesce(updated_at, now());

select public.set_user_triggers_if_table_exists('companies', true);

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

select public.set_user_triggers_if_table_exists('profiles', false);

update public.profiles
set role = case
  when lower(coalesce(role, '')) in ('superadmin', 'super', 'super_admin') then 'super_admin'
  when lower(coalesce(role, '')) in ('owner', 'manager', 'yonetici', 'admin') then 'admin'
  when lower(coalesce(role, '')) in ('accounting', 'muhasebe', 'muhasebeci', 'accountant') then 'accountant'
  when lower(coalesce(role, '')) in ('staff', 'personel', 'personnel', 'montaj', 'montajci', 'installer') then 'installer'
  when lower(coalesce(role, '')) in ('olcu', 'measurement') then 'measurement'
  else 'installer'
end;

select public.set_user_triggers_if_table_exists('profiles', true);

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('super_admin', 'admin', 'accountant', 'installer', 'measurement', 'personnel'));

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

select public.set_user_triggers_if_table_exists('company_members', false);

update public.company_members
set role = case
  when lower(coalesce(role, '')) in ('owner', 'manager', 'yonetici', 'admin') then 'admin'
  when lower(coalesce(role, '')) in ('accounting', 'muhasebe', 'muhasebeci', 'accountant') then 'accountant'
  when lower(coalesce(role, '')) in ('staff', 'personel', 'personnel', 'montaj', 'montajci', 'installer') then 'installer'
  when lower(coalesce(role, '')) in ('olcu', 'measurement') then 'measurement'
  else 'installer'
end;

select public.set_user_triggers_if_table_exists('company_members', true);

alter table public.company_members drop constraint if exists company_members_role_check;
alter table public.company_members
  add constraint company_members_role_check
  check (role in ('admin', 'accountant', 'installer', 'measurement', 'personnel'));

create unique index if not exists company_members_company_user_uidx
on public.company_members(company_id, user_id);

create table if not exists public.user_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  role text not null,
  token text not null unique default public.generate_invite_token(),
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

select public.set_user_triggers_if_table_exists('user_invites', false);

update public.user_invites
set
  email = lower(trim(email)),
  role = case
    when lower(coalesce(role, '')) in ('owner', 'manager', 'yonetici', 'admin') then 'admin'
    when lower(coalesce(role, '')) in ('accounting', 'muhasebe', 'muhasebeci', 'accountant') then 'accountant'
    when lower(coalesce(role, '')) in ('staff', 'personel', 'personnel', 'montaj', 'montajci', 'installer') then 'installer'
    when lower(coalesce(role, '')) in ('olcu', 'measurement') then 'measurement'
    else 'installer'
  end,
  token = coalesce(nullif(token, ''), public.generate_invite_token()),
  expires_at = coalesce(expires_at, now() + interval '7 days'),
  created_at = coalesce(created_at, now());

select public.set_user_triggers_if_table_exists('user_invites', true);

alter table public.user_invites alter column token set default public.generate_invite_token();
alter table public.user_invites alter column expires_at set default (now() + interval '7 days');

alter table public.user_invites drop constraint if exists user_invites_role_check;
alter table public.user_invites
  add constraint user_invites_role_check
  check (role in ('admin', 'accountant', 'installer', 'measurement'));

-- Remove old unique email/company constraints that blocked repeated invites.
do $$
declare
  r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.user_invites'::regclass
      and c.contype = 'u'
      and c.conname <> 'user_invites_token_key'
      and pg_get_constraintdef(c.oid) ilike '%email%'
  loop
    execute format('alter table public.user_invites drop constraint if exists %I', r.conname);
  end loop;
end $$;

do $$
declare
  r record;
begin
  for r in
    select i.indexrelid::regclass::text as index_name
    from pg_index i
    join pg_class t on t.oid = i.indrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_class idx on idx.oid = i.indexrelid
    where n.nspname = 'public'
      and t.relname = 'user_invites'
      and i.indisunique
      and not i.indisprimary
      and pg_get_indexdef(i.indexrelid) ilike '%email%'
      and pg_get_indexdef(i.indexrelid) not ilike '%token%'
  loop
    execute format('drop index if exists %s', r.index_name);
  end loop;
end $$;

create unique index if not exists user_invites_token_uidx on public.user_invites(token);
create index if not exists idx_user_invites_company_email on public.user_invites(company_id, (lower(email)));
create index if not exists idx_user_invites_token_unused on public.user_invites(token) where used_at is null;

-- ---------------------------------------------------------------------------
-- Replace every custom auth.users trigger with a safe non-blocking trigger.
-- This is the main fix for Supabase Auth returning "Database error finding user".
-- ---------------------------------------------------------------------------

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
begin
  if v_role not in ('super_admin', 'admin', 'accountant', 'installer', 'measurement', 'personnel') then
    v_role := 'installer';
  end if;

  insert into public.profiles(user_id, email, full_name, role, is_active, updated_at)
  values (new.id, v_email, nullif(v_full_name, ''), v_role, true, now())
  on conflict (user_id)
  do update set
    email = coalesce(excluded.email, public.profiles.email),
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    is_active = coalesce(public.profiles.is_active, true),
    updated_at = now();

  return new;
exception when others then
  raise warning 'handle_new_user skipped for %: %', new.id, sqlerrm;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Helper role functions used by policies and invite creation.
-- ---------------------------------------------------------------------------

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

-- Validate invite without consuming it.
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

  -- Avoid collisions and confusion: keep only the latest unused invite for
  -- the same company/email/role active. Old links become consumed.
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
-- Mobile/super-admin error log compatibility.
-- ---------------------------------------------------------------------------

create table if not exists public.error_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  user_id uuid,
  message text,
  created_at timestamptz not null default now()
);

alter table public.error_logs add column if not exists company_id uuid references public.companies(id) on delete set null;
alter table public.error_logs add column if not exists user_id uuid;
alter table public.error_logs add column if not exists message text;
alter table public.error_logs add column if not exists error_message text;
alter table public.error_logs add column if not exists stack text;
alter table public.error_logs add column if not exists error_stack text;
alter table public.error_logs add column if not exists path text;
alter table public.error_logs add column if not exists page_url text;
alter table public.error_logs add column if not exists app_version text default '0.0.0';
alter table public.error_logs add column if not exists created_at timestamptz default now();
alter table public.error_logs add column if not exists is_resolved boolean not null default false;
alter table public.error_logs add column if not exists resolved_by uuid;
alter table public.error_logs add column if not exists resolved_at timestamptz;
alter table public.error_logs add column if not exists internal_note text;

select public.set_user_triggers_if_table_exists('error_logs', false);

update public.error_logs
set
  message = coalesce(message, error_message, 'Hata bildirimi'),
  error_message = coalesce(error_message, message, 'Hata bildirimi'),
  stack = coalesce(stack, error_stack),
  error_stack = coalesce(error_stack, stack),
  path = coalesce(path, page_url),
  page_url = coalesce(page_url, path),
  app_version = coalesce(app_version, '0.0.0');

select public.set_user_triggers_if_table_exists('error_logs', true);

create or replace function public.sync_error_log_message_fields()
returns trigger
language plpgsql
as $$
begin
  new.message := coalesce(new.message, new.error_message, 'Hata bildirimi');
  new.error_message := coalesce(new.error_message, new.message, 'Hata bildirimi');
  new.stack := coalesce(new.stack, new.error_stack);
  new.error_stack := coalesce(new.error_stack, new.stack);
  new.path := coalesce(new.path, new.page_url);
  new.page_url := coalesce(new.page_url, new.path);
  new.app_version := coalesce(new.app_version, '0.0.0');
  return new;
end;
$$;

drop trigger if exists trg_error_logs_sync_fields on public.error_logs;
create trigger trg_error_logs_sync_fields
before insert or update on public.error_logs
for each row execute function public.sync_error_log_message_fields();

create index if not exists idx_error_logs_company_created
on public.error_logs(company_id, created_at desc);

create index if not exists idx_error_logs_version_created
on public.error_logs(app_version, created_at desc);

-- ---------------------------------------------------------------------------
-- SQL Editor diagnostics. Use this when a join link fails.
-- ---------------------------------------------------------------------------

create or replace function public.debug_invite_join_state(
  p_email text,
  p_token text
)
returns table(check_name text, ok boolean, details text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_invite public.user_invites%rowtype;
  v_auth_user_id uuid;
begin
  select * into v_invite
  from public.user_invites
  where token = p_token
  limit 1;

  select id into v_auth_user_id
  from auth.users
  where lower(email) = v_email
  order by created_at desc
  limit 1;

  return query
  select 'auth.users exists', v_auth_user_id is not null, coalesce(v_auth_user_id::text, 'auth user yok');

  return query
  select 'invite exists', v_invite.id is not null, coalesce(v_invite.id::text, 'davet yok');

  return query
  select 'invite email matches',
         v_invite.id is not null and lower(v_invite.email) = v_email,
         coalesce(v_invite.email, 'davet e-postasi yok');

  return query
  select 'invite usable',
         v_invite.id is not null and v_invite.used_at is null and v_invite.expires_at >= now(),
         case
           when v_invite.id is null then 'davet yok'
           when v_invite.used_at is not null then 'kullanilmis: ' || v_invite.used_at::text
           when v_invite.expires_at < now() then 'suresi dolmus: ' || v_invite.expires_at::text
           else 'kullanilabilir'
         end;

  return query
  select 'profile exists',
         exists (select 1 from public.profiles where lower(email) = v_email or user_id = v_auth_user_id),
         coalesce(v_email, '');

  return query
  select 'company member exists',
         exists (
           select 1
           from public.company_members cm
           where cm.user_id = v_auth_user_id
             and cm.company_id = v_invite.company_id
         ),
         coalesce(v_invite.company_id::text, 'firma yok');
end;
$$;

grant execute on function public.debug_invite_join_state(text, text) to authenticated;

-- Make sure migration-time trigger toggles are restored even after re-runs.
select public.set_user_triggers_if_table_exists('companies', true);
select public.set_user_triggers_if_table_exists('profiles', true);
select public.set_user_triggers_if_table_exists('company_members', true);
select public.set_user_triggers_if_table_exists('user_invites', true);
select public.set_user_triggers_if_table_exists('error_logs', true);

-- Quick checks after running:
select 'auth trigger count' as check_name,
       count(*) = 1 as ok,
       string_agg(tgname, ', ' order by tgname) as details
from pg_trigger
where tgrelid = 'auth.users'::regclass
  and not tgisinternal;

select 'invite functions' as check_name,
       to_regprocedure('public.get_invite_by_token(text)') is not null
       and to_regprocedure('public.accept_invite_for_current_user(text,text)') is not null
       and to_regprocedure('public.create_company_invite(uuid,text,text,integer)') is not null as ok;

select 'error_logs.message' as check_name,
       exists (
         select 1
         from information_schema.columns
         where table_schema = 'public'
           and table_name = 'error_logs'
           and column_name = 'message'
       ) as ok;
