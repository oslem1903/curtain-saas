-- Uretimdeki mevcut yapinin depodaki en guncel surumlerinden derlenmis kopyasi
create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text, created_at timestamptz not null default now(),
  owner_id uuid, logo_url text,
  subscription_plan text default 'trial', max_users integer default 3, max_devices integer,
  enabled_modules text[] default '{orders,customers,appointments}', package_code text default 'starter',
  branch_limit integer default 1, trial_ends_at timestamptz, plan_status text default 'trial',
  trial_start timestamptz, trial_end timestamptz, is_pilot boolean not null default false,
  is_active boolean not null default true, read_only boolean not null default false,
  created_by uuid, updated_by uuid, updated_at timestamptz,
  onboarding_completed boolean not null default false, onboarding_completed_at timestamptz,
  subscription_status text not null default 'trial', license_expires_at timestamptz,
  constraint companies_plan_status_chk check (plan_status in ('active','trial','expired','suspended','lifetime')),
  constraint companies_subscription_plan_chk check (subscription_plan in ('starter','pro','enterprise','lifetime','trial')),
  constraint subscription_status_check check (subscription_status in ('trial','active','suspended','expired','cancelled'))
);
create table public.profiles (
  user_id uuid primary key, email text, full_name text,
  role text default 'installer', is_active boolean default true,
  created_at timestamptz not null default now(), updated_at timestamptz,
  constraint profiles_role_check check (role in ('super_admin','admin','accountant','installer','measurement','personnel'))
);
create table public.company_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null, role text not null default 'installer',
  is_active boolean not null default true, created_at timestamptz not null default now(),
  created_by uuid, updated_by uuid, updated_at timestamptz,
  unique (company_id, user_id)
);
create table public.user_invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email text, role text, token text, invite_code text, expires_at timestamptz,
  used_at timestamptz, invited_by uuid, created_at timestamptz default now(), updated_at timestamptz
);
create table public.customers (id uuid primary key default gen_random_uuid(), company_id uuid references public.companies(id), name text);
create table public.orders (id uuid primary key default gen_random_uuid(), company_id uuid references public.companies(id), customer_id uuid, total numeric);
create table public.order_items (id uuid primary key default gen_random_uuid(), order_id uuid, qty int); -- company_id yok
create table public.support_tickets (id uuid primary key default gen_random_uuid(), company_id uuid, subject text);

create or replace function public.current_app_role() returns text language sql stable security definer set search_path=public as $$
  select lower(coalesce(p.role,'')) from public.profiles p where p.user_id = auth.uid() limit 1 $$;
create or replace function public.is_super_admin() returns boolean language sql stable security definer set search_path=public as $$
  select coalesce(public.current_app_role() = 'super_admin', false) $$;
create or replace function public.is_company_member(p_company_id uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists (select 1 from public.company_members cm where cm.user_id = auth.uid() and cm.company_id = p_company_id and coalesce(cm.is_active,true)) $$;
create or replace function public.is_company_admin(p_company_id uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists (select 1 from public.company_members cm where cm.user_id = auth.uid() and cm.company_id = p_company_id and coalesce(cm.is_active,true) and cm.role in ('admin')) $$;
create or replace function public.is_company_accounting(p_company_id uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists (select 1 from public.company_members cm where cm.user_id = auth.uid() and cm.company_id = p_company_id and coalesce(cm.is_active,true) and cm.role in ('admin','accountant')) $$;
