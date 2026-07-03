alter table public.appointments
  add column if not exists reminder_offset text default '30m',
  add column if not exists notification_status text default 'planned',
  add column if not exists notification_scheduled_at timestamptz;

create table if not exists public.reminder_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  title text not null,
  customer_name text,
  phone text,
  address text,
  task_type text not null default 'other',
  start_at timestamptz not null,
  reminder_offset text not null default '30m',
  notification_status text not null default 'planned',
  source_table text,
  source_id uuid,
  amount numeric,
  supplier_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists reminder_tasks_company_start_idx
  on public.reminder_tasks(company_id, start_at);

create unique index if not exists reminder_tasks_source_unique_idx
  on public.reminder_tasks(source_table, source_id)
  where source_table is not null and source_id is not null;
