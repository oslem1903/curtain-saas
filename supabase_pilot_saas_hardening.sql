-- =========================================================================================
-- PERDE SAAS PILOT HARDENING MIGRATION
-- Version: 2026-04-30
--
-- PURPOSE
-- - Prepare the existing project for pilot SaaS usage without deleting existing data.
-- - Add tenant, invite, license/trial and update-notification infrastructure.
-- - Add security helper functions that will be used by RLS policies in the next hardening step.
--
-- IMPORTANT BACKUP RECOMMENDATION BEFORE RUNNING
-- 1) Supabase Dashboard > Database > Backups: create/download a backup if available on your plan.
-- 2) Supabase SQL Editor: export key tables before running this migration:
--    companies, profiles, company_members, customers, orders, order_items, appointments,
--    payments, income, expenses, suppliers, supplier_payments, transactions, employees.
-- 3) Do not run destructive SQL against pilot/customer data. This file does not DROP tables,
--    does not TRUNCATE tables and does not remove columns.
--
-- SAFETY
-- - Uses CREATE TABLE IF NOT EXISTS and ADD COLUMN IF NOT EXISTS.
-- - Existing rows are preserved.
-- - Existing RLS policies are not dropped in this stage.
-- - This file prepares helper functions and schema. Apply stricter RLS policies in a later,
--   reviewed step after confirming current data/company memberships.
-- =========================================================================================

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------------------
-- Generic helpers
-- -----------------------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.add_column_if_table_exists(
  p_table_name text,
  p_column_name text,
  p_column_definition text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('public.' || p_table_name) is not null then
    execute format(
      'alter table public.%I add column if not exists %I %s',
      p_table_name,
      p_column_name,
      p_column_definition
    );
  end if;
end;
$$;

create or replace function public.run_if_table_exists(
  p_table_name text,
  p_sql text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('public.' || p_table_name) is not null then
    execute p_sql;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------------------
-- Core SaaS account tables
-- -----------------------------------------------------------------------------------------

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text,
  created_at timestamptz not null default now()
);

select public.add_column_if_table_exists('companies', 'owner_id', 'uuid');
select public.add_column_if_table_exists('companies', 'logo_url', 'text');
select public.add_column_if_table_exists('companies', 'subscription_plan', 'text default ''trial''');
select public.add_column_if_table_exists('companies', 'max_users', 'integer default 3');
select public.add_column_if_table_exists('companies', 'enabled_modules', 'text[] default ''{orders,customers,appointments}''');
select public.add_column_if_table_exists('companies', 'branch_limit', 'integer default 1');
select public.add_column_if_table_exists('companies', 'trial_ends_at', 'timestamptz');
select public.add_column_if_table_exists('companies', 'plan_status', 'text default ''trial''');
select public.add_column_if_table_exists('companies', 'trial_start', 'timestamptz');
select public.add_column_if_table_exists('companies', 'trial_end', 'timestamptz');
select public.add_column_if_table_exists('companies', 'is_pilot', 'boolean not null default false');
select public.add_column_if_table_exists('companies', 'is_active', 'boolean not null default true');
select public.add_column_if_table_exists('companies', 'read_only', 'boolean not null default false');
select public.add_column_if_table_exists('companies', 'suspended_at', 'timestamptz');
select public.add_column_if_table_exists('companies', 'suspended_reason', 'text');
select public.add_column_if_table_exists('companies', 'created_by', 'uuid');
select public.add_column_if_table_exists('companies', 'updated_by', 'uuid');
select public.add_column_if_table_exists('companies', 'updated_at', 'timestamptz');

update public.companies
set
  subscription_plan = coalesce(subscription_plan, 'starter'),
  max_users = coalesce(max_users, case when subscription_plan in ('enterprise', 'lifetime') then 999 when subscription_plan = 'pro' then 15 else 3 end),
  branch_limit = coalesce(branch_limit, case when subscription_plan in ('enterprise', 'lifetime') then 999 else 1 end),
  enabled_modules = coalesce(
    enabled_modules,
    case
      when subscription_plan in ('enterprise', 'lifetime') then array['orders','customers','appointments','accounting','suppliers','expenses','profit','branches','reports','catalogs','staff']
      when subscription_plan = 'pro' then array['orders','customers','appointments','accounting','suppliers','expenses','profit','catalogs','staff']
      else array['orders','customers','appointments']
    end
  ),
  trial_start = coalesce(trial_start, created_at, now()),
  trial_end = coalesce(trial_end, trial_ends_at, created_at + interval '7 days', now() + interval '7 days'),
  plan_status = coalesce(plan_status, subscription_plan, 'trial'),
  updated_at = coalesce(updated_at, now())
where true;

drop trigger if exists trg_companies_updated_at on public.companies;
create trigger trg_companies_updated_at
before update on public.companies
for each row execute function public.set_updated_at();

create table if not exists public.profiles (
  user_id uuid primary key,
  created_at timestamptz not null default now()
);

select public.add_column_if_table_exists('profiles', 'email', 'text');
select public.add_column_if_table_exists('profiles', 'full_name', 'text');
select public.add_column_if_table_exists('profiles', 'role', 'text default ''installer''');
select public.add_column_if_table_exists('profiles', 'is_active', 'boolean not null default true');
select public.add_column_if_table_exists('profiles', 'last_login_at', 'timestamptz');
select public.add_column_if_table_exists('profiles', 'bound_device_id', 'text');
select public.add_column_if_table_exists('profiles', 'is_locked', 'boolean not null default false');
select public.add_column_if_table_exists('profiles', 'updated_at', 'timestamptz');

update public.profiles
set
  role = case
    when lower(coalesce(role, '')) in ('superadmin', 'super', 'super yonetici', 'süper yönetici') then 'super_admin'
    when lower(coalesce(role, '')) in ('manager', 'yonetici', 'yönetici', 'owner') then 'admin'
    when lower(coalesce(role, '')) in ('accounting', 'muhasebe', 'muhasebeci') then 'accountant'
    when lower(coalesce(role, '')) in ('staff', 'personel', 'montaj', 'montajci', 'montajcı') then 'installer'
    when lower(coalesce(role, '')) in ('olcu', 'ölçü') then 'measurement'
    else coalesce(nullif(role, ''), 'installer')
  end,
  updated_at = coalesce(updated_at, now())
where true;

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create table if not exists public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'installer',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

select public.add_column_if_table_exists('company_members', 'role', 'text default ''installer''');
select public.add_column_if_table_exists('company_members', 'is_active', 'boolean not null default true');
select public.add_column_if_table_exists('company_members', 'last_login_at', 'timestamptz');
select public.add_column_if_table_exists('company_members', 'created_by', 'uuid');
select public.add_column_if_table_exists('company_members', 'updated_by', 'uuid');
select public.add_column_if_table_exists('company_members', 'updated_at', 'timestamptz');

create unique index if not exists company_members_company_user_uidx
on public.company_members(company_id, user_id);

create index if not exists idx_company_members_user_active
on public.company_members(user_id, is_active);

create index if not exists idx_company_members_company_role
on public.company_members(company_id, role);

drop trigger if exists trg_company_members_updated_at on public.company_members;
create trigger trg_company_members_updated_at
before update on public.company_members
for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------------------
-- Invitation-token system. This replaces open/self signup for pilot usage.
-- -----------------------------------------------------------------------------------------

create table if not exists public.user_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text not null,
  role text not null,
  token text not null unique default encode(extensions.gen_random_bytes(32), 'hex'),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_at timestamptz,
  invited_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  constraint user_invites_role_check check (role in ('admin', 'accountant', 'installer', 'measurement'))
);

create index if not exists idx_user_invites_token_unused
on public.user_invites(token)
where used_at is null;

create index if not exists idx_user_invites_company_email
on public.user_invites(company_id, lower(email));

drop trigger if exists trg_user_invites_updated_at on public.user_invites;
create trigger trg_user_invites_updated_at
before update on public.user_invites
for each row execute function public.set_updated_at();

-- Keep legacy employee invite fields during transition. Do not delete old codes yet.
select public.add_column_if_table_exists('employees', 'invite_code', 'text');
select public.add_column_if_table_exists('employees', 'target_role', 'text');
select public.add_column_if_table_exists('employees', 'user_id', 'uuid');
select public.add_column_if_table_exists('employees', 'is_active', 'boolean not null default true');
select public.add_column_if_table_exists('employees', 'created_by', 'uuid');
select public.add_column_if_table_exists('employees', 'updated_by', 'uuid');
select public.add_column_if_table_exists('employees', 'updated_at', 'timestamptz');

-- -----------------------------------------------------------------------------------------
-- Tenant metadata columns on business tables. Safe additive changes only.
-- -----------------------------------------------------------------------------------------

select public.add_column_if_table_exists('customers', 'company_id', 'uuid');
select public.add_column_if_table_exists('customers', 'created_by', 'uuid');
select public.add_column_if_table_exists('customers', 'updated_by', 'uuid');
select public.add_column_if_table_exists('customers', 'updated_at', 'timestamptz');
select public.add_column_if_table_exists('customers', 'deleted_at', 'timestamptz');

select public.add_column_if_table_exists('orders', 'company_id', 'uuid');
select public.add_column_if_table_exists('orders', 'assigned_to', 'uuid');
select public.add_column_if_table_exists('orders', 'assigned_user_id', 'uuid');
select public.add_column_if_table_exists('orders', 'created_by', 'uuid');
select public.add_column_if_table_exists('orders', 'updated_by', 'uuid');
select public.add_column_if_table_exists('orders', 'updated_at', 'timestamptz');
select public.add_column_if_table_exists('orders', 'deleted_at', 'timestamptz');

select public.add_column_if_table_exists('order_items', 'company_id', 'uuid');
select public.add_column_if_table_exists('order_items', 'created_by', 'uuid');
select public.add_column_if_table_exists('order_items', 'updated_by', 'uuid');
select public.add_column_if_table_exists('order_items', 'updated_at', 'timestamptz');
select public.add_column_if_table_exists('order_items', 'deleted_at', 'timestamptz');

select public.add_column_if_table_exists('appointments', 'company_id', 'uuid');
select public.add_column_if_table_exists('appointments', 'scheduled_at', 'timestamptz');
select public.add_column_if_table_exists('appointments', 'start_at', 'timestamptz');
select public.add_column_if_table_exists('appointments', 'assigned_to', 'uuid');
select public.add_column_if_table_exists('appointments', 'assigned_user_id', 'uuid');
select public.add_column_if_table_exists('appointments', 'assigned_role', 'text');
select public.add_column_if_table_exists('appointments', 'created_by', 'uuid');
select public.add_column_if_table_exists('appointments', 'updated_by', 'uuid');
select public.add_column_if_table_exists('appointments', 'updated_at', 'timestamptz');
select public.add_column_if_table_exists('appointments', 'deleted_at', 'timestamptz');
select public.add_column_if_table_exists('appointments', 'done', 'boolean not null default false');
select public.add_column_if_table_exists('appointments', 'done_at', 'timestamptz');

do $$
begin
  if to_regclass('public.appointments') is not null then
    update public.appointments
    set scheduled_at = coalesce(scheduled_at, start_at)
    where scheduled_at is null
      and start_at is not null;
  end if;
end;
$$;

select public.add_column_if_table_exists('payments', 'company_id', 'uuid');
select public.add_column_if_table_exists('payments', 'created_by', 'uuid');
select public.add_column_if_table_exists('payments', 'updated_by', 'uuid');
select public.add_column_if_table_exists('payments', 'updated_at', 'timestamptz');
select public.add_column_if_table_exists('payments', 'deleted_at', 'timestamptz');

select public.add_column_if_table_exists('income', 'company_id', 'uuid');
select public.add_column_if_table_exists('income', 'created_by', 'uuid');
select public.add_column_if_table_exists('income', 'updated_by', 'uuid');
select public.add_column_if_table_exists('income', 'updated_at', 'timestamptz');
select public.add_column_if_table_exists('income', 'deleted_at', 'timestamptz');

select public.add_column_if_table_exists('expenses', 'company_id', 'uuid');
select public.add_column_if_table_exists('expenses', 'created_by', 'uuid');
select public.add_column_if_table_exists('expenses', 'updated_by', 'uuid');
select public.add_column_if_table_exists('expenses', 'updated_at', 'timestamptz');
select public.add_column_if_table_exists('expenses', 'deleted_at', 'timestamptz');

select public.add_column_if_table_exists('suppliers', 'company_id', 'uuid');
select public.add_column_if_table_exists('suppliers', 'created_by', 'uuid');
select public.add_column_if_table_exists('suppliers', 'updated_by', 'uuid');
select public.add_column_if_table_exists('suppliers', 'updated_at', 'timestamptz');
select public.add_column_if_table_exists('suppliers', 'deleted_at', 'timestamptz');

create table if not exists public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  supplier_id uuid,
  amount numeric not null default 0,
  payment_date timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now()
);

select public.add_column_if_table_exists('supplier_payments', 'created_by', 'uuid');
select public.add_column_if_table_exists('supplier_payments', 'updated_by', 'uuid');
select public.add_column_if_table_exists('supplier_payments', 'updated_at', 'timestamptz');
select public.add_column_if_table_exists('supplier_payments', 'deleted_at', 'timestamptz');

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  type text,
  amount numeric not null default 0,
  note text,
  created_at timestamptz not null default now()
);

select public.add_column_if_table_exists('transactions', 'source_table', 'text');
select public.add_column_if_table_exists('transactions', 'source_id', 'uuid');
select public.add_column_if_table_exists('transactions', 'created_by', 'uuid');
select public.add_column_if_table_exists('transactions', 'updated_by', 'uuid');
select public.add_column_if_table_exists('transactions', 'updated_at', 'timestamptz');
select public.add_column_if_table_exists('transactions', 'deleted_at', 'timestamptz');

-- Useful indexes for tenant filtering. They are safe if tables exist.
select public.run_if_table_exists('customers', 'create index if not exists idx_customers_company_id on public.customers(company_id) where deleted_at is null');
select public.run_if_table_exists('orders', 'create index if not exists idx_orders_company_id on public.orders(company_id) where deleted_at is null');
select public.run_if_table_exists('order_items', 'create index if not exists idx_order_items_company_id on public.order_items(company_id) where deleted_at is null');
select public.run_if_table_exists('appointments', 'create index if not exists idx_appointments_company_id on public.appointments(company_id) where deleted_at is null');
select public.run_if_table_exists('appointments', 'create index if not exists idx_appointments_assigned on public.appointments(company_id, assigned_to, assigned_user_id) where deleted_at is null');
select public.run_if_table_exists('payments', 'create index if not exists idx_payments_company_id on public.payments(company_id) where deleted_at is null');
select public.run_if_table_exists('income', 'create index if not exists idx_income_company_id on public.income(company_id) where deleted_at is null');
select public.run_if_table_exists('expenses', 'create index if not exists idx_expenses_company_id on public.expenses(company_id) where deleted_at is null');
select public.run_if_table_exists('suppliers', 'create index if not exists idx_suppliers_company_id on public.suppliers(company_id) where deleted_at is null');
select public.run_if_table_exists('supplier_payments', 'create index if not exists idx_supplier_payments_company_id on public.supplier_payments(company_id) where deleted_at is null');
select public.run_if_table_exists('transactions', 'create index if not exists idx_transactions_company_id on public.transactions(company_id) where deleted_at is null');

-- -----------------------------------------------------------------------------------------
-- Support, error, audit and update/version tables
-- -----------------------------------------------------------------------------------------

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  user_id uuid,
  title text,
  message text,
  category text default 'general',
  priority text default 'normal',
  status text default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists public.error_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  user_id uuid,
  message text,
  stack text,
  path text,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  actor_user_id uuid,
  action text not null,
  entity_table text,
  entity_id uuid,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.app_updates (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  title text not null,
  description text,
  created_at timestamptz not null default now()
);

alter table public.app_updates add column if not exists version text;
alter table public.app_updates add column if not exists title text;
alter table public.app_updates add column if not exists description text;
alter table public.app_updates add column if not exists release_date timestamptz default now();
alter table public.app_updates add column if not exists forced_update boolean not null default false;
alter table public.app_updates add column if not exists force_update boolean not null default false;
alter table public.app_updates add column if not exists update_type text default 'general';
alter table public.app_updates add column if not exists target_type text default 'all_companies';
alter table public.app_updates add column if not exists target_company_ids uuid[] not null default '{}';
alter table public.app_updates add column if not exists status text not null default 'draft';
alter table public.app_updates add column if not exists published_at timestamptz;
alter table public.app_updates add column if not exists created_by uuid;
alter table public.app_updates add column if not exists updated_at timestamptz;

update public.app_updates
set
  release_date = coalesce(release_date, published_at, created_at, now()),
  forced_update = coalesce(forced_update, force_update, false),
  force_update = coalesce(force_update, forced_update, false),
  status = coalesce(status, 'draft')
where true;

create index if not exists idx_app_updates_published
on public.app_updates(status, published_at, release_date);

create table if not exists public.app_update_reads (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.app_updates(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  user_id uuid not null,
  read_at timestamptz not null default now(),
  unique(update_id, user_id)
);

select public.add_column_if_table_exists('notifications', 'company_id', 'uuid');
select public.add_column_if_table_exists('notifications', 'related_update_id', 'uuid');
select public.add_column_if_table_exists('notifications', 'is_read', 'boolean not null default false');
select public.add_column_if_table_exists('notifications', 'created_at', 'timestamptz default now()');

-- -----------------------------------------------------------------------------------------
-- Tenant/security helper functions for app and upcoming RLS policies
-- -----------------------------------------------------------------------------------------

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
  join public.companies c on c.id = cm.company_id
  where cm.user_id = auth.uid()
    and cm.is_active = true
    and coalesce(c.is_active, true) = true
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
    join public.companies c on c.id = cm.company_id
    where cm.user_id = auth.uid()
      and cm.company_id = p_company_id
      and cm.is_active = true
      and coalesce(c.is_active, true) = true
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
      and cm.is_active = true
      and cm.role in ('owner', 'admin')
  )
$$;

create or replace function public.is_company_accounting(p_company_id uuid)
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
      and cm.is_active = true
      and cm.role in ('owner', 'admin', 'accountant')
  )
$$;

create or replace function public.is_company_writable(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.companies c
    where c.id = p_company_id
      and coalesce(c.is_active, true) = true
      and coalesce(c.read_only, false) = false
      and coalesce(c.plan_status, 'trial') not in ('suspended', 'expired')
      and (
        coalesce(c.is_pilot, false) = true
        or coalesce(c.plan_status, 'trial') = 'active'
        or coalesce(c.plan_status, 'trial') = 'lifetime'
        or (
          coalesce(c.plan_status, 'trial') = 'trial'
          and coalesce(c.trial_end, c.trial_ends_at, now() + interval '1 day') >= now()
        )
      )
  )
$$;

create or replace function public.require_company_writable(p_company_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_company_writable(p_company_id) then
    raise exception 'Firma lisansi aktif degil veya sadece okuma modunda.';
  end if;
end;
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

-- -----------------------------------------------------------------------------------------
-- Access policies for company creation and invite rows.
-- Normal users cannot create companies directly. Invites are created through audited RPCs.
-- -----------------------------------------------------------------------------------------

alter table public.companies enable row level security;
alter table public.user_invites enable row level security;

drop policy if exists companies_select_by_role on public.companies;
create policy companies_select_by_role
on public.companies
for select
to authenticated
using (
  public.is_super_admin()
  or public.is_company_member(id)
);

drop policy if exists companies_insert_super_admin_only on public.companies;
create policy companies_insert_super_admin_only
on public.companies
for insert
to authenticated
with check (public.is_super_admin());

drop policy if exists companies_update_allowed_roles on public.companies;
create policy companies_update_allowed_roles
on public.companies
for update
to authenticated
using (
  public.is_super_admin()
  or public.is_company_admin(id)
)
with check (
  public.is_super_admin()
  or public.is_company_admin(id)
);

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

drop policy if exists user_invites_insert_via_authorized_roles on public.user_invites;
create policy user_invites_insert_via_authorized_roles
on public.user_invites
for insert
to authenticated
with check (
  public.is_super_admin()
  or (
    public.is_company_admin(company_id)
    and role in ('accountant', 'installer', 'measurement')
  )
);

drop policy if exists user_invites_update_creator_or_super_admin on public.user_invites;
create policy user_invites_update_creator_or_super_admin
on public.user_invites
for update
to authenticated
using (
  public.is_super_admin()
  or invited_by = auth.uid()
  or lower(email) = lower(coalesce((auth.jwt() ->> 'email'), ''))
)
with check (
  public.is_super_admin()
  or invited_by = auth.uid()
  or lower(email) = lower(coalesce((auth.jwt() ->> 'email'), ''))
);

-- -----------------------------------------------------------------------------------------
-- Super admin RPC placeholders for next code step.
-- Functions are idempotent and require super_admin role.
-- -----------------------------------------------------------------------------------------

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

-- Validate invite without consuming it. Used by /join/:token screen.
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
  select i.id, i.company_id, c.name, i.email, i.role, i.expires_at, i.used_at
  from public.user_invites i
  join public.companies c on c.id = i.company_id
  where i.token = p_token
  limit 1
$$;

grant execute on function public.get_invite_by_token(text) to anon, authenticated;

-- Consume invite after Supabase Auth user exists. This is the secure server-side step used
-- by /join/:token. It validates token, expiry, email, company and role before linking user.
create or replace function public.accept_invite_for_current_user(
  p_token text,
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

  select * into v_invite
  from public.user_invites
  where token = p_token
  limit 1;

  if v_invite.id is null then
    raise exception 'Davet bulunamadi veya gecersiz.';
  end if;

  if v_invite.used_at is not null then
    raise exception 'Bu davet daha once kullanilmis.';
  end if;

  if v_invite.expires_at < now() then
    raise exception 'Davet suresi dolmus.';
  end if;

  if lower(v_invite.email) <> v_user_email then
    raise exception 'Bu davet farkli bir e-posta adresi icin olusturulmus.';
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

grant execute on function public.accept_invite_for_current_user(text, text) to authenticated;

-- -----------------------------------------------------------------------------------------
-- Post-migration health checks. Run manually after migration.
-- -----------------------------------------------------------------------------------------

-- 1) Rows without company_id in tenant tables:
-- select 'customers' as table_name, count(*) from public.customers where company_id is null
-- union all select 'orders', count(*) from public.orders where company_id is null
-- union all select 'appointments', count(*) from public.appointments where company_id is null;
--
-- 2) Users without company membership:
-- select p.user_id, p.email, p.role
-- from public.profiles p
-- left join public.company_members cm on cm.user_id = p.user_id
-- where p.role <> 'super_admin' and cm.user_id is null;
--
-- 3) Trial/license status:
-- select id, name, plan_status, trial_start, trial_end, is_pilot, is_active, read_only
-- from public.companies
-- order by created_at desc;
