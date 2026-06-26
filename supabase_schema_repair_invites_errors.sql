-- Curtain SaaS schema repair: invites, auth trigger, error logs and super-admin screens.
-- Safe to run more than once. It does not delete customer data.
--
-- Fixes:
-- 1) Invite/join flow "Database error finding user" caused by old auth triggers/role constraints.
-- 2) Mobile management "column error_logs.message does not exist".
-- 3) Missing columns used by current super-admin support/mobile/version screens.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Generic token helper. Keeps invite token generation independent from the
-- exact schema where pgcrypto is installed.
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

-- Safety: if a previous interrupted repair left a table with disabled user
-- triggers, turn them back on before starting the idempotent repair.
select public.set_user_triggers_if_table_exists('companies', true);
select public.set_user_triggers_if_table_exists('profiles', true);
select public.set_user_triggers_if_table_exists('company_members', true);
select public.set_user_triggers_if_table_exists('user_invites', true);
select public.set_user_triggers_if_table_exists('error_logs', true);
select public.set_user_triggers_if_table_exists('support_tickets', true);
select public.set_user_triggers_if_table_exists('app_updates', true);
select public.set_user_triggers_if_table_exists('app_devices', true);
select public.set_user_triggers_if_table_exists('notifications', true);

-- ---------------------------------------------------------------------------
-- Core tables/columns used by auth, invite and tenant context.
-- ---------------------------------------------------------------------------

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text,
  created_at timestamptz not null default now()
);

alter table public.companies add column if not exists owner_id uuid;
alter table public.companies add column if not exists subscription_plan text default 'starter';
alter table public.companies add column if not exists plan_status text default 'trial';
alter table public.companies add column if not exists trial_start timestamptz default now();
alter table public.companies add column if not exists trial_end timestamptz;
alter table public.companies add column if not exists trial_ends_at timestamptz;
alter table public.companies add column if not exists is_pilot boolean not null default false;
alter table public.companies add column if not exists is_active boolean not null default true;
alter table public.companies add column if not exists read_only boolean not null default false;
alter table public.companies add column if not exists max_users integer default 3;
alter table public.companies add column if not exists enabled_modules text[] default array['orders','customers','appointments'];
alter table public.companies add column if not exists branch_limit integer default 1;
alter table public.companies add column if not exists created_by uuid;
alter table public.companies add column if not exists updated_by uuid;
alter table public.companies add column if not exists updated_at timestamptz;

select public.set_user_triggers_if_table_exists('companies', false);

update public.companies
set
  subscription_plan = coalesce(subscription_plan, 'starter'),
  plan_status = coalesce(plan_status, 'trial'),
  trial_start = coalesce(trial_start, created_at, now()),
  trial_end = coalesce(trial_end, trial_ends_at),
  trial_ends_at = coalesce(trial_ends_at, trial_end),
  max_users = coalesce(max_users, 3),
  branch_limit = coalesce(branch_limit, 1),
  enabled_modules = coalesce(enabled_modules, array['orders','customers','appointments']),
  updated_at = coalesce(updated_at, now());

select public.set_user_triggers_if_table_exists('companies', true);

alter table public.companies drop constraint if exists companies_plan_status_chk;
alter table public.companies
  add constraint companies_plan_status_chk
  check (plan_status in ('active', 'trial', 'expired', 'suspended', 'lifetime'));

alter table public.companies drop constraint if exists companies_subscription_plan_chk;
alter table public.companies
  add constraint companies_subscription_plan_chk
  check (subscription_plan in ('starter', 'pro', 'enterprise', 'lifetime', 'trial'));

create table if not exists public.profiles (
  user_id uuid primary key,
  created_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists role text default 'installer';
alter table public.profiles add column if not exists is_active boolean not null default true;
alter table public.profiles add column if not exists last_login_at timestamptz;
alter table public.profiles add column if not exists updated_at timestamptz;

select public.set_user_triggers_if_table_exists('profiles', false);

update public.profiles
set role = case
  when lower(coalesce(role, '')) in ('superadmin', 'super', 'super yonetici', 'super_admin') then 'super_admin'
  when lower(coalesce(role, '')) in ('owner', 'manager', 'yonetici', 'admin') then 'admin'
  when lower(coalesce(role, '')) in ('accounting', 'muhasebe', 'muhasebeci', 'accountant') then 'accountant'
  when lower(coalesce(role, '')) in ('staff', 'personel', 'personnel', 'montaj', 'montajci', 'installer') then 'installer'
  when lower(coalesce(role, '')) in ('olcu', 'measurement') then 'measurement'
  else coalesce(nullif(role, ''), 'installer')
end;

select public.set_user_triggers_if_table_exists('profiles', true);

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles
  add constraint profiles_role_check
  check (role in ('super_admin', 'admin', 'accountant', 'installer', 'measurement', 'personnel'));

create index if not exists idx_profiles_email on public.profiles(lower(email));

create table if not exists public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'installer',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.company_members add column if not exists role text default 'installer';
alter table public.company_members add column if not exists is_active boolean not null default true;
alter table public.company_members add column if not exists last_login_at timestamptz;
alter table public.company_members add column if not exists created_by uuid;
alter table public.company_members add column if not exists updated_by uuid;
alter table public.company_members add column if not exists updated_at timestamptz;

select public.set_user_triggers_if_table_exists('company_members', false);

update public.company_members
set role = case
  when lower(coalesce(role, '')) in ('owner', 'manager', 'yonetici', 'admin') then 'admin'
  when lower(coalesce(role, '')) in ('accounting', 'muhasebe', 'muhasebeci', 'accountant') then 'accountant'
  when lower(coalesce(role, '')) in ('staff', 'personel', 'personnel', 'montaj', 'montajci', 'installer') then 'installer'
  when lower(coalesce(role, '')) in ('olcu', 'measurement') then 'measurement'
  else coalesce(nullif(role, ''), 'installer')
end;

select public.set_user_triggers_if_table_exists('company_members', true);

alter table public.company_members drop constraint if exists company_members_role_check;
alter table public.company_members
  add constraint company_members_role_check
  check (role in ('admin', 'accountant', 'installer', 'measurement', 'personnel'));

create unique index if not exists company_members_company_user_uidx
on public.company_members(company_id, user_id);

create index if not exists idx_company_members_user_active
on public.company_members(user_id, is_active);

create index if not exists idx_company_members_company_role
on public.company_members(company_id, role);

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
    else coalesce(nullif(role, ''), 'installer')
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

create unique index if not exists user_invites_token_uidx on public.user_invites(token);
create index if not exists idx_user_invites_token_unused on public.user_invites(token) where used_at is null;
create index if not exists idx_user_invites_company_email on public.user_invites(company_id, (lower(email)));

-- ---------------------------------------------------------------------------
-- Safe Auth trigger. Old trigger versions could fail on role constraints and
-- make Supabase Auth return "Database error finding user".
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select t.tgname
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
    where t.tgrelid = 'auth.users'::regclass
      and not t.tgisinternal
      and n.nspname = 'public'
      and p.proname in ('handle_new_user', 'create_profile_for_user')
  loop
    execute format('drop trigger if exists %I on auth.users', r.tgname);
  end loop;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
drop trigger if exists handle_new_user on auth.users;
drop trigger if exists on_auth_user_created_profile on auth.users;
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
-- Auth/role helper RPCs.
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

create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select cm.company_id
  from public.company_members cm
  where cm.user_id = auth.uid()
    and coalesce(cm.is_active, true) = true
  order by cm.created_at asc
  limit 1
$$;

create or replace function public.is_company_member(p_company_id uuid)
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
  )
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
      and cm.role in ('admin')
  )
$$;

create or replace function public.get_current_auth_context()
returns table(
  user_id uuid,
  email text,
  role text,
  is_active boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.id,
    lower(u.email),
    p.role,
    coalesce(p.is_active, true)
  from auth.users u
  left join public.profiles p
    on p.user_id = u.id
    or lower(p.email) = lower(u.email)
  where u.id = auth.uid()
  order by case when p.user_id = u.id then 0 else 1 end
  limit 1
$$;

grant execute on function public.get_current_auth_context() to authenticated;

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
  v_invite record;
  v_company record;
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

  if v_role not in ('admin', 'accountant', 'installer', 'measurement') then
    raise exception 'Gecersiz rol.';
  end if;

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
  v_token text := public.generate_invite_token();
  v_trial_days integer := greatest(1, least(coalesce(p_trial_days, 7), 365));
  v_trial_end timestamptz := now() + make_interval(days => greatest(1, least(coalesce(p_trial_days, 7), 365)));
  v_expires_at timestamptz := now() + make_interval(days => least(v_trial_days, 30));
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
    created_by,
    updated_at
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
    auth.uid(),
    now()
  )
  returning id into v_company_id;

  insert into public.user_invites(company_id, email, role, token, expires_at, invited_by)
  values (v_company_id, lower(trim(p_owner_email)), 'admin', v_token, v_expires_at, auth.uid())
  returning id into v_invite_id;

  return query select v_company_id, v_invite_id, v_token, v_expires_at, v_trial_end;
end;
$$;

grant execute on function public.create_company_with_owner_invite(text, text, integer, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Error logs and support tickets. Keep legacy and current column names in sync.
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
alter table public.error_logs add column if not exists action_name text;
alter table public.error_logs add column if not exists user_agent text;
alter table public.error_logs add column if not exists browser_info jsonb;
alter table public.error_logs add column if not exists device_info jsonb;
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

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  user_id uuid,
  title text,
  description text,
  status text default 'open',
  priority text default 'medium',
  category text default 'other',
  page_url text,
  screenshot_url text,
  internal_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now()
);

alter table public.support_tickets add column if not exists company_id uuid references public.companies(id) on delete set null;
alter table public.support_tickets add column if not exists user_id uuid;
alter table public.support_tickets add column if not exists title text;
alter table public.support_tickets add column if not exists description text;
alter table public.support_tickets add column if not exists message text;
alter table public.support_tickets add column if not exists status text default 'open';
alter table public.support_tickets add column if not exists priority text default 'medium';
alter table public.support_tickets add column if not exists category text default 'other';
alter table public.support_tickets add column if not exists page_url text;
alter table public.support_tickets add column if not exists screenshot_url text;
alter table public.support_tickets add column if not exists internal_note text;
alter table public.support_tickets add column if not exists created_at timestamptz default now();
alter table public.support_tickets add column if not exists updated_at timestamptz default now();
alter table public.support_tickets add column if not exists resolved_at timestamptz;
alter table public.support_tickets add column if not exists resolved_by uuid;

select public.set_user_triggers_if_table_exists('support_tickets', false);

update public.support_tickets
set
  description = coalesce(description, message, 'Açıklama yok.'),
  message = coalesce(message, description),
  title = coalesce(nullif(title, ''), left(coalesce(description, message, 'Destek talebi'), 120)),
  status = case when status in ('open', 'in_progress', 'resolved', 'closed') then status else 'open' end,
  priority = case when priority in ('low', 'medium', 'high', 'urgent') then priority else 'medium' end,
  category = case when category in ('bug', 'question', 'request', 'payment', 'other') then category else 'other' end,
  updated_at = coalesce(updated_at, now());

select public.set_user_triggers_if_table_exists('support_tickets', true);

create or replace function public.sync_support_ticket_fields()
returns trigger
language plpgsql
as $$
begin
  new.description := coalesce(new.description, new.message, 'Açıklama yok.');
  new.message := coalesce(new.message, new.description);
  new.title := coalesce(nullif(new.title, ''), left(new.description, 120), 'Destek talebi');
  new.status := coalesce(new.status, 'open');
  new.priority := coalesce(new.priority, 'medium');
  new.category := coalesce(new.category, 'other');
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_support_tickets_sync_fields on public.support_tickets;
create trigger trg_support_tickets_sync_fields
before insert or update on public.support_tickets
for each row execute function public.sync_support_ticket_fields();

alter table public.support_tickets drop constraint if exists support_tickets_status_check;
alter table public.support_tickets
  add constraint support_tickets_status_check
  check (status in ('open', 'in_progress', 'resolved', 'closed'));

alter table public.support_tickets drop constraint if exists support_tickets_priority_check;
alter table public.support_tickets
  add constraint support_tickets_priority_check
  check (priority in ('low', 'medium', 'high', 'urgent'));

alter table public.support_tickets drop constraint if exists support_tickets_category_check;
alter table public.support_tickets
  add constraint support_tickets_category_check
  check (category in ('bug', 'question', 'request', 'payment', 'other'));

create index if not exists idx_support_tickets_company_status
on public.support_tickets(company_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- App update/device/notification columns used by the current UI.
-- ---------------------------------------------------------------------------

create table if not exists public.app_updates (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  title text not null,
  description text,
  created_at timestamptz not null default now()
);

alter table public.app_updates add column if not exists update_type text default 'general';
alter table public.app_updates add column if not exists target_type text default 'all_companies';
alter table public.app_updates add column if not exists target_company_ids uuid[] not null default '{}';
alter table public.app_updates add column if not exists status text not null default 'draft';
alter table public.app_updates add column if not exists force_update boolean not null default false;
alter table public.app_updates add column if not exists forced_update boolean not null default false;
alter table public.app_updates add column if not exists download_url text;
alter table public.app_updates add column if not exists windows_download_url text;
alter table public.app_updates add column if not exists android_download_url text;
alter table public.app_updates add column if not exists published_at timestamptz;
alter table public.app_updates add column if not exists release_date timestamptz default now();
alter table public.app_updates add column if not exists created_by uuid;
alter table public.app_updates add column if not exists updated_at timestamptz;

select public.set_user_triggers_if_table_exists('app_updates', false);

update public.app_updates
set
  update_type = coalesce(update_type, 'general'),
  target_type = coalesce(target_type, 'all_companies'),
  target_company_ids = coalesce(target_company_ids, '{}'),
  status = coalesce(status, 'draft'),
  forced_update = coalesce(forced_update, force_update, false),
  force_update = coalesce(force_update, forced_update, false),
  release_date = coalesce(release_date, published_at, created_at, now());

select public.set_user_triggers_if_table_exists('app_updates', true);

create table if not exists public.app_devices (
  id text primary key,
  company_id uuid references public.companies(id) on delete cascade,
  user_id uuid,
  app_version text not null default '0.0.0',
  platform text not null default 'web',
  device_name text,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_devices add column if not exists company_id uuid references public.companies(id) on delete cascade;
alter table public.app_devices add column if not exists user_id uuid;
alter table public.app_devices add column if not exists app_version text not null default '0.0.0';
alter table public.app_devices add column if not exists platform text not null default 'web';
alter table public.app_devices add column if not exists device_name text;
alter table public.app_devices add column if not exists last_seen_at timestamptz not null default now();
alter table public.app_devices add column if not exists created_at timestamptz not null default now();
alter table public.app_devices add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_app_devices_company_version on public.app_devices(company_id, app_version);
create index if not exists idx_app_devices_last_seen on public.app_devices(last_seen_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  user_id uuid,
  title text not null,
  message text not null,
  type text not null default 'info',
  related_update_id uuid,
  related_ticket_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications add column if not exists company_id uuid;
alter table public.notifications add column if not exists user_id uuid;
alter table public.notifications add column if not exists title text;
alter table public.notifications add column if not exists message text;
alter table public.notifications add column if not exists type text default 'info';
alter table public.notifications add column if not exists related_update_id uuid;
alter table public.notifications add column if not exists related_ticket_id uuid;
alter table public.notifications add column if not exists is_read boolean not null default false;
alter table public.notifications add column if not exists created_at timestamptz not null default now();

create index if not exists idx_notifications_user_read
on public.notifications(user_id, is_read, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS policies for repaired SaaS tables.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.company_members enable row level security;
alter table public.user_invites enable row level security;
alter table public.support_tickets enable row level security;
alter table public.error_logs enable row level security;
alter table public.app_updates enable row level security;
alter table public.app_devices enable row level security;
alter table public.notifications enable row level security;

drop policy if exists profiles_select_scope on public.profiles;
create policy profiles_select_scope
on public.profiles
for select
to authenticated
using (
  public.is_super_admin()
  or user_id = auth.uid()
  or exists (
    select 1
    from public.company_members cm_self
    join public.company_members cm_target
      on cm_target.company_id = cm_self.company_id
    where cm_self.user_id = auth.uid()
      and cm_target.user_id = profiles.user_id
  )
);

drop policy if exists profiles_update_self_or_super on public.profiles;
create policy profiles_update_self_or_super
on public.profiles
for update
to authenticated
using (public.is_super_admin() or user_id = auth.uid())
with check (public.is_super_admin() or user_id = auth.uid());

drop policy if exists companies_select_by_role on public.companies;
create policy companies_select_by_role
on public.companies
for select
to authenticated
using (public.is_super_admin() or public.is_company_member(id));

drop policy if exists companies_update_admin_or_super on public.companies;
create policy companies_update_admin_or_super
on public.companies
for update
to authenticated
using (public.is_super_admin() or public.is_company_admin(id))
with check (public.is_super_admin() or public.is_company_admin(id));

drop policy if exists companies_insert_super_admin_only on public.companies;
create policy companies_insert_super_admin_only
on public.companies
for insert
to authenticated
with check (public.is_super_admin());

drop policy if exists company_members_select_scope on public.company_members;
create policy company_members_select_scope
on public.company_members
for select
to authenticated
using (
  public.is_super_admin()
  or user_id = auth.uid()
  or public.is_company_member(company_id)
);

drop policy if exists company_members_write_admin on public.company_members;
create policy company_members_write_admin
on public.company_members
for all
to authenticated
using (public.is_super_admin() or public.is_company_admin(company_id))
with check (public.is_super_admin() or public.is_company_admin(company_id));

drop policy if exists user_invites_select_creator_or_admin on public.user_invites;
create policy user_invites_select_creator_or_admin
on public.user_invites
for select
to authenticated
using (
  public.is_super_admin()
  or invited_by = auth.uid()
  or public.is_company_admin(company_id)
);

drop policy if exists user_invites_insert_authorized on public.user_invites;
create policy user_invites_insert_authorized
on public.user_invites
for insert
to authenticated
with check (
  public.is_super_admin()
  or public.is_company_admin(company_id)
);

drop policy if exists user_invites_update_authorized on public.user_invites;
create policy user_invites_update_authorized
on public.user_invites
for update
to authenticated
using (
  public.is_super_admin()
  or invited_by = auth.uid()
  or public.is_company_admin(company_id)
)
with check (
  public.is_super_admin()
  or invited_by = auth.uid()
  or public.is_company_admin(company_id)
);

drop policy if exists support_tickets_scope on public.support_tickets;
create policy support_tickets_scope
on public.support_tickets
for all
to authenticated
using (
  public.is_super_admin()
  or company_id = public.current_company_id()
  or user_id = auth.uid()
)
with check (
  public.is_super_admin()
  or company_id = public.current_company_id()
  or user_id = auth.uid()
);

drop policy if exists error_logs_scope on public.error_logs;
create policy error_logs_scope
on public.error_logs
for all
to authenticated
using (
  public.is_super_admin()
  or company_id = public.current_company_id()
  or user_id = auth.uid()
)
with check (
  public.is_super_admin()
  or company_id = public.current_company_id()
  or user_id = auth.uid()
);

drop policy if exists app_updates_select_scope on public.app_updates;
create policy app_updates_select_scope
on public.app_updates
for select
to authenticated
using (
  public.is_super_admin()
  or (
    status = 'published'
    and (
      target_type = 'all_companies'
      or public.current_company_id() = any(target_company_ids)
    )
  )
);

drop policy if exists app_updates_write_super_admin on public.app_updates;
create policy app_updates_write_super_admin
on public.app_updates
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

drop policy if exists app_devices_scope on public.app_devices;
create policy app_devices_scope
on public.app_devices
for all
to authenticated
using (
  public.is_super_admin()
  or company_id = public.current_company_id()
  or user_id = auth.uid()
)
with check (
  public.is_super_admin()
  or company_id = public.current_company_id()
  or user_id = auth.uid()
);

drop policy if exists notifications_scope on public.notifications;
create policy notifications_scope
on public.notifications
for all
to authenticated
using (
  public.is_super_admin()
  or user_id = auth.uid()
  or company_id = public.current_company_id()
)
with check (
  public.is_super_admin()
  or user_id = auth.uid()
  or company_id = public.current_company_id()
);

-- Safety: all repair/backfill updates are done, so make sure user triggers are on.
select public.set_user_triggers_if_table_exists('companies', true);
select public.set_user_triggers_if_table_exists('profiles', true);
select public.set_user_triggers_if_table_exists('company_members', true);
select public.set_user_triggers_if_table_exists('user_invites', true);
select public.set_user_triggers_if_table_exists('error_logs', true);
select public.set_user_triggers_if_table_exists('support_tickets', true);
select public.set_user_triggers_if_table_exists('app_updates', true);
select public.set_user_triggers_if_table_exists('app_devices', true);
select public.set_user_triggers_if_table_exists('notifications', true);

-- ---------------------------------------------------------------------------
-- Quick checks after running in Supabase SQL Editor.
-- ---------------------------------------------------------------------------

select 'error_logs.message' as check_name,
       exists (
         select 1 from information_schema.columns
         where table_schema = 'public' and table_name = 'error_logs' and column_name = 'message'
       ) as ok;

select 'invite functions' as check_name,
       to_regprocedure('public.get_invite_by_token(text)') is not null
       and to_regprocedure('public.accept_invite_for_current_user(text,text)') is not null as ok;

select 'role constraints ready' as check_name,
       count(*) filter (where role not in ('super_admin', 'admin', 'accountant', 'installer', 'measurement', 'personnel')) = 0 as ok
from public.profiles;
