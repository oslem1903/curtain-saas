-- Super Admin support center, error logging, updates and notifications.
-- Run in Supabase SQL Editor.

create table if not exists public.support_tickets (
    id uuid primary key default gen_random_uuid(),
    company_id uuid,
    user_id uuid,
    title text not null,
    description text not null,
    status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
    priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
    category text not null default 'other' check (category in ('bug', 'question', 'request', 'payment', 'other')),
    page_url text,
    screenshot_url text,
    internal_note text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    resolved_at timestamptz,
    resolved_by uuid
);

create table if not exists public.error_logs (
    id uuid primary key default gen_random_uuid(),
    company_id uuid,
    user_id uuid,
    error_message text not null,
    error_stack text,
    page_url text,
    action_name text,
    browser_info jsonb,
    device_info jsonb,
    app_version text,
    created_at timestamptz not null default now(),
    is_resolved boolean not null default false,
    resolved_by uuid,
    resolved_at timestamptz,
    internal_note text
);

create table if not exists public.app_updates (
    id uuid primary key default gen_random_uuid(),
    version text not null,
    title text not null,
    description text,
    update_type text not null default 'general' check (update_type in ('general', 'bugfix', 'feature', 'security')),
    target_type text not null default 'all_companies' check (target_type in ('all_companies', 'selected_companies')),
    target_company_ids uuid[] default '{}',
    status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
    force_update boolean not null default false,
    published_at timestamptz,
    created_at timestamptz not null default now(),
    created_by uuid
);

create table if not exists public.notifications (
    id uuid primary key default gen_random_uuid(),
    company_id uuid,
    user_id uuid,
    title text not null,
    message text not null,
    type text not null default 'info' check (type in ('info', 'warning', 'success', 'error', 'update')),
    related_update_id uuid,
    related_ticket_id uuid,
    is_read boolean not null default false,
    created_at timestamptz not null default now()
);

alter table public.appointments add column if not exists assigned_user_id uuid;
alter table public.appointments add column if not exists assigned_role text;

alter table public.support_tickets enable row level security;
alter table public.error_logs enable row level security;
alter table public.app_updates enable row level security;
alter table public.notifications enable row level security;

create index if not exists idx_support_tickets_company_status on public.support_tickets(company_id, status, created_at desc);
create index if not exists idx_error_logs_company_created on public.error_logs(company_id, created_at desc);
create index if not exists idx_notifications_user_read on public.notifications(user_id, is_read, created_at desc);

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

drop policy if exists support_tickets_scope on public.support_tickets;
create policy support_tickets_scope
on public.support_tickets
for all
to authenticated
using (public.is_super_admin() or company_id = public.current_company_id() or user_id = auth.uid())
with check (public.is_super_admin() or company_id = public.current_company_id() or user_id = auth.uid());

drop policy if exists error_logs_scope on public.error_logs;
create policy error_logs_scope
on public.error_logs
for all
to authenticated
using (public.is_super_admin() or company_id = public.current_company_id() or user_id = auth.uid())
with check (public.is_super_admin() or company_id = public.current_company_id() or user_id = auth.uid());

drop policy if exists app_updates_scope on public.app_updates;
create policy app_updates_scope
on public.app_updates
for select
to authenticated
using (
    public.is_super_admin()
    or status = 'published'
    and (
        target_type = 'all_companies'
        or public.current_company_id() = any(target_company_ids)
    )
);

drop policy if exists app_updates_write_super_admin on public.app_updates;
create policy app_updates_write_super_admin
on public.app_updates
for all
to authenticated
using (public.is_super_admin())
with check (public.is_super_admin());

drop policy if exists notifications_scope on public.notifications;
create policy notifications_scope
on public.notifications
for all
to authenticated
using (public.is_super_admin() or user_id = auth.uid() or company_id = public.current_company_id())
with check (public.is_super_admin() or user_id = auth.uid() or company_id = public.current_company_id());

do $$
begin
    alter publication supabase_realtime add table public.appointments;
exception when duplicate_object then null;
end $$;

do $$
begin
    alter publication supabase_realtime add table public.orders;
exception when duplicate_object then null;
end $$;

do $$
begin
    alter publication supabase_realtime add table public.customers;
exception when duplicate_object then null;
end $$;

do $$
begin
    alter publication supabase_realtime add table public.payments;
exception when duplicate_object then null;
end $$;

do $$
begin
    alter publication supabase_realtime add table public.income;
exception when duplicate_object then null;
end $$;

do $$
begin
    alter publication supabase_realtime add table public.expenses;
exception when duplicate_object then null;
end $$;

do $$
begin
    alter publication supabase_realtime add table public.notifications;
exception when duplicate_object then null;
end $$;
