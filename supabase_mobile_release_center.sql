-- Mobile/version release center backing tables.
-- Run in Supabase SQL Editor before using the production mobile management screen.

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

alter table public.app_devices enable row level security;

create index if not exists idx_app_devices_company_version on public.app_devices(company_id, app_version);
create index if not exists idx_app_devices_last_seen on public.app_devices(last_seen_at desc);

drop policy if exists app_devices_select_scope on public.app_devices;
create policy app_devices_select_scope
on public.app_devices
for select
to authenticated
using (
  public.is_super_admin()
  or company_id = public.current_company_id()
  or user_id = auth.uid()
);

drop policy if exists app_devices_upsert_scope on public.app_devices;
create policy app_devices_upsert_scope
on public.app_devices
for insert
to authenticated
with check (
  public.is_super_admin()
  or company_id = public.current_company_id()
  or user_id = auth.uid()
);

drop policy if exists app_devices_update_scope on public.app_devices;
create policy app_devices_update_scope
on public.app_devices
for update
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

alter table public.app_updates add column if not exists forced_update boolean not null default false;
alter table public.app_updates add column if not exists release_date timestamptz default now();
alter table public.app_updates add column if not exists download_url text;
alter table public.app_updates add column if not exists windows_download_url text;
alter table public.app_updates add column if not exists android_download_url text;

create table if not exists public.app_update_reads (
  id uuid primary key default gen_random_uuid(),
  update_id uuid not null references public.app_updates(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  user_id uuid not null,
  read_at timestamptz not null default now(),
  unique(update_id, user_id)
);

alter table public.app_update_reads enable row level security;

drop policy if exists app_update_reads_scope on public.app_update_reads;
create policy app_update_reads_scope
on public.app_update_reads
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

-- Quick checks:
select 'app_devices ready' as status, count(*) as rows from public.app_devices;
