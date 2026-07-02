-- Installation jobs schema.
-- Apply in Supabase SQL Editor, then PostgREST schema cache is refreshed by the notify at the end.
-- Safe to run more than once.

create extension if not exists pgcrypto;

create table if not exists public.installation_jobs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  order_id uuid not null references public.orders(id) on delete cascade,
  customer_id uuid,
  assigned_staff_id uuid null,
  status text not null default 'waiting',
  scheduled_date date null,
  scheduled_time time null,
  customer_name text,
  phone text,
  address text,
  product_type text,
  room text,
  width numeric null,
  height numeric null,
  total_amount numeric null,
  notes text null,
  created_at timestamp default now(),
  updated_at timestamp default now(),
  constraint installation_jobs_order_id_unique unique (order_id)
);

alter table public.installation_jobs
  add column if not exists company_id uuid,
  add column if not exists customer_id uuid,
  add column if not exists assigned_staff_id uuid null,
  add column if not exists status text not null default 'waiting',
  add column if not exists scheduled_date date null,
  add column if not exists scheduled_time time null,
  add column if not exists customer_name text,
  add column if not exists phone text,
  add column if not exists address text,
  add column if not exists product_type text,
  add column if not exists room text,
  add column if not exists width numeric null,
  add column if not exists height numeric null,
  add column if not exists total_amount numeric null,
  add column if not exists notes text null,
  add column if not exists created_at timestamp default now(),
  add column if not exists updated_at timestamp default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'installation_jobs_order_id_unique'
      and conrelid = 'public.installation_jobs'::regclass
  ) then
    alter table public.installation_jobs
      add constraint installation_jobs_order_id_unique unique (order_id);
  end if;
end $$;

create index if not exists idx_installation_jobs_company_id on public.installation_jobs(company_id);
create index if not exists idx_installation_jobs_status on public.installation_jobs(status);
create index if not exists idx_installation_jobs_scheduled on public.installation_jobs(scheduled_date, scheduled_time);
create index if not exists idx_installation_jobs_assigned_staff_id on public.installation_jobs(assigned_staff_id);

alter table public.installation_jobs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'installation_jobs'
      and policyname = 'installation_jobs_company_read'
  ) then
    create policy installation_jobs_company_read
      on public.installation_jobs
      for select
      using (
        company_id in (
          select cm.company_id
          from public.company_members cm
          where cm.user_id = auth.uid()
        )
        or exists (
          select 1
          from public.profiles p
          where p.user_id = auth.uid()
            and p.role = 'super_admin'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'installation_jobs'
      and policyname = 'installation_jobs_company_insert'
  ) then
    create policy installation_jobs_company_insert
      on public.installation_jobs
      for insert
      with check (
        company_id in (
          select cm.company_id
          from public.company_members cm
          where cm.user_id = auth.uid()
        )
        or exists (
          select 1
          from public.profiles p
          where p.user_id = auth.uid()
            and p.role = 'super_admin'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'installation_jobs'
      and policyname = 'installation_jobs_company_update'
  ) then
    create policy installation_jobs_company_update
      on public.installation_jobs
      for update
      using (
        company_id in (
          select cm.company_id
          from public.company_members cm
          where cm.user_id = auth.uid()
        )
        or exists (
          select 1
          from public.profiles p
          where p.user_id = auth.uid()
            and p.role = 'super_admin'
        )
      )
      with check (
        company_id in (
          select cm.company_id
          from public.company_members cm
          where cm.user_id = auth.uid()
        )
        or exists (
          select 1
          from public.profiles p
          where p.user_id = auth.uid()
            and p.role = 'super_admin'
        )
      );
  end if;
end $$;

notify pgrst, 'reload schema';
