-- Staff role isolation and multi-assignee support for Perde SaaS.
-- Run this in Supabase SQL editor after reviewing existing policies.

create table if not exists public.appointment_assignees (
    id uuid primary key default gen_random_uuid(),
    appointment_id uuid not null references public.appointments(id) on delete cascade,
    staff_user_id uuid not null,
    company_id uuid not null,
    created_at timestamptz not null default now(),
    unique (appointment_id, staff_user_id)
);

alter table public.appointment_assignees enable row level security;

alter table public.appointments add column if not exists created_by uuid;
alter table public.appointments add column if not exists assigned_user_id uuid;
alter table public.appointments add column if not exists assigned_role text;
alter table public.appointments add column if not exists done boolean not null default false;
alter table public.appointments add column if not exists done_at timestamptz;

alter table public.orders add column if not exists assigned_to uuid;
alter table public.orders add column if not exists assigned_user_id uuid;
alter table public.orders add column if not exists created_by uuid;
alter table public.orders add column if not exists appointment_id uuid;
alter table public.orders add column if not exists visual_preview_id uuid;
alter table public.orders add column if not exists selected_catalog_variant_id uuid;

alter table public.customers add column if not exists created_by uuid;

alter table public.visual_previews add column if not exists selected_area_points jsonb;
alter table public.visual_previews add column if not exists created_by_staff_id uuid;

create index if not exists idx_appointment_assignees_staff
    on public.appointment_assignees(company_id, staff_user_id);

create index if not exists idx_appointments_staff_scope
    on public.appointments(company_id, assigned_to, created_by);
create index if not exists idx_appointments_assigned_user_scope
    on public.appointments(company_id, assigned_user_id, created_by);

create index if not exists idx_orders_staff_scope
    on public.orders(company_id, assigned_to, created_by);
create index if not exists idx_orders_assigned_user_scope
    on public.orders(company_id, assigned_user_id, created_by);

create index if not exists idx_customers_created_by
    on public.customers(company_id, created_by);

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

create or replace function public.is_admin_or_accounting()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select public.current_app_role() in ('admin', 'accountant', 'accounting', 'muhasebe')
$$;

drop policy if exists appointment_assignees_select_scope on public.appointment_assignees;
create policy appointment_assignees_select_scope
on public.appointment_assignees
for select
to authenticated
using (
    company_id = public.current_company_id()
    and (
        public.is_admin_or_accounting()
        or staff_user_id = auth.uid()
    )
);

drop policy if exists appointment_assignees_write_admin on public.appointment_assignees;
create policy appointment_assignees_write_admin
on public.appointment_assignees
for all
to authenticated
using (company_id = public.current_company_id() and public.is_admin_or_accounting())
with check (company_id = public.current_company_id() and public.is_admin_or_accounting());

-- Add these policies after disabling or replacing older broad policies if they exist.
drop policy if exists appointments_select_role_scope on public.appointments;
create policy appointments_select_role_scope
on public.appointments
for select
to authenticated
using (
    company_id = public.current_company_id()
    and (
        public.is_admin_or_accounting()
        or assigned_to = auth.uid()
        or assigned_user_id = auth.uid()
        or created_by = auth.uid()
        or exists (
            select 1
            from public.appointment_assignees aa
            where aa.appointment_id = appointments.id
              and aa.company_id = appointments.company_id
              and aa.staff_user_id = auth.uid()
        )
    )
);

drop policy if exists appointments_insert_role_scope on public.appointments;
create policy appointments_insert_role_scope
on public.appointments
for insert
to authenticated
with check (
    company_id = public.current_company_id()
    and (
        public.is_admin_or_accounting()
        or (created_by = auth.uid() and (assigned_to = auth.uid() or assigned_user_id = auth.uid()))
    )
);

drop policy if exists appointments_update_role_scope on public.appointments;
create policy appointments_update_role_scope
on public.appointments
for update
to authenticated
using (
    company_id = public.current_company_id()
    and (
        public.is_admin_or_accounting()
        or assigned_to = auth.uid()
        or assigned_user_id = auth.uid()
        or created_by = auth.uid()
        or exists (
            select 1
            from public.appointment_assignees aa
            where aa.appointment_id = appointments.id
              and aa.company_id = appointments.company_id
              and aa.staff_user_id = auth.uid()
        )
    )
)
with check (company_id = public.current_company_id());

drop policy if exists orders_select_role_scope on public.orders;
create policy orders_select_role_scope
on public.orders
for select
to authenticated
using (
    company_id = public.current_company_id()
    and (
        public.is_admin_or_accounting()
        or assigned_to = auth.uid()
        or assigned_user_id = auth.uid()
        or created_by = auth.uid()
    )
);

drop policy if exists orders_insert_role_scope on public.orders;
create policy orders_insert_role_scope
on public.orders
for insert
to authenticated
with check (
    company_id = public.current_company_id()
    and (
        public.is_admin_or_accounting()
        or created_by = auth.uid()
        or assigned_to = auth.uid()
        or assigned_user_id = auth.uid()
    )
);

drop policy if exists customers_select_role_scope on public.customers;
create policy customers_select_role_scope
on public.customers
for select
to authenticated
using (
    company_id = public.current_company_id()
    and (
        public.is_admin_or_accounting()
        or created_by = auth.uid()
        or exists (
            select 1
            from public.appointments a
            where a.company_id = customers.company_id
              and a.customer_id = customers.id
              and (a.assigned_to = auth.uid() or a.assigned_user_id = auth.uid() or a.created_by = auth.uid())
        )
        or exists (
            select 1
            from public.orders o
            where o.company_id = customers.company_id
              and o.customer_id = customers.id
              and (o.assigned_to = auth.uid() or o.assigned_user_id = auth.uid() or o.created_by = auth.uid())
        )
    )
);
