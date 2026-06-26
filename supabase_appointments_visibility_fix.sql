-- Montaj/personel tarafindan olusturulan randevularin yonetici panelinde gorunmesi icin.
-- Supabase SQL Editor'de calistirin.

alter table public.appointments add column if not exists created_by uuid references auth.users(id) on delete set null;

create index if not exists appointments_company_start_idx on public.appointments(company_id, start_at);
create index if not exists appointments_company_scheduled_idx on public.appointments(company_id, scheduled_at);
create index if not exists appointments_created_by_idx on public.appointments(created_by);

alter table public.appointments enable row level security;

drop policy if exists "appointments company members select" on public.appointments;
drop policy if exists "appointments company members insert" on public.appointments;
drop policy if exists "appointments company members update" on public.appointments;
drop policy if exists "appointments company admins delete" on public.appointments;

create policy "appointments company members select"
on public.appointments for select
using (
  exists (
    select 1
    from public.company_members cm
    where cm.company_id = appointments.company_id
      and cm.user_id = auth.uid()
  )
);

create policy "appointments company members insert"
on public.appointments for insert
with check (
  exists (
    select 1
    from public.company_members cm
    where cm.company_id = appointments.company_id
      and cm.user_id = auth.uid()
  )
);

create policy "appointments company members update"
on public.appointments for update
using (
  exists (
    select 1
    from public.company_members cm
    where cm.company_id = appointments.company_id
      and cm.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.company_members cm
    where cm.company_id = appointments.company_id
      and cm.user_id = auth.uid()
  )
);

create policy "appointments company admins delete"
on public.appointments for delete
using (
  exists (
    select 1
    from public.company_members cm
    join public.profiles p on p.user_id = cm.user_id
    where cm.company_id = appointments.company_id
      and cm.user_id = auth.uid()
      and p.role in ('admin', 'yonetici', 'manager')
  )
);
