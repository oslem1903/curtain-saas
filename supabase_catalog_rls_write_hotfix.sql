-- Fix catalog write failures:
-- "new row violates row-level security policy for table catalog_series"
-- Run this in Supabase SQL Editor.

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.user_id = auth.uid()
      and p.role = 'super_admin'
  );
$$;

alter table public.catalog_series enable row level security;
alter table public.catalog_variants enable row level security;

drop policy if exists catalog_series_admin_write on public.catalog_series;
create policy catalog_series_admin_write
on public.catalog_series for all
to authenticated
using (
  public.is_super_admin()
  or exists (
    select 1
    from public.company_members cm
    left join public.profiles p on p.user_id = cm.user_id
    where cm.company_id = catalog_series.company_id
      and cm.user_id = auth.uid()
      and (
        p.role in ('admin', 'accountant', 'muhasebe', 'super_admin')
        or cm.role in ('admin', 'accountant', 'muhasebe', 'super_admin')
      )
  )
)
with check (
  public.is_super_admin()
  or exists (
    select 1
    from public.company_members cm
    left join public.profiles p on p.user_id = cm.user_id
    where cm.company_id = catalog_series.company_id
      and cm.user_id = auth.uid()
      and (
        p.role in ('admin', 'accountant', 'muhasebe', 'super_admin')
        or cm.role in ('admin', 'accountant', 'muhasebe', 'super_admin')
      )
  )
);

drop policy if exists catalog_variants_admin_write on public.catalog_variants;
create policy catalog_variants_admin_write
on public.catalog_variants for all
to authenticated
using (
  public.is_super_admin()
  or exists (
    select 1
    from public.company_members cm
    left join public.profiles p on p.user_id = cm.user_id
    where cm.company_id = catalog_variants.company_id
      and cm.user_id = auth.uid()
      and (
        p.role in ('admin', 'accountant', 'muhasebe', 'super_admin')
        or cm.role in ('admin', 'accountant', 'muhasebe', 'super_admin')
      )
  )
)
with check (
  public.is_super_admin()
  or exists (
    select 1
    from public.company_members cm
    left join public.profiles p on p.user_id = cm.user_id
    where cm.company_id = catalog_variants.company_id
      and cm.user_id = auth.uid()
      and (
        p.role in ('admin', 'accountant', 'muhasebe', 'super_admin')
        or cm.role in ('admin', 'accountant', 'muhasebe', 'super_admin')
      )
  )
);

drop policy if exists catalog_series_company_select on public.catalog_series;
create policy catalog_series_company_select
on public.catalog_series for select
to authenticated
using (
  public.is_super_admin()
  or exists (
    select 1
    from public.company_members cm
    left join public.profiles p on p.user_id = cm.user_id
    where cm.company_id = catalog_series.company_id
      and cm.user_id = auth.uid()
      and (
        p.role in ('admin', 'accountant', 'muhasebe', 'installer', 'measurement', 'personnel', 'montaj', 'staff', 'super_admin')
        or cm.role in ('admin', 'accountant', 'muhasebe', 'installer', 'measurement', 'personnel', 'montaj', 'staff', 'super_admin')
        or catalog_series.is_active = true
      )
  )
);

drop policy if exists catalog_variants_company_select on public.catalog_variants;
create policy catalog_variants_company_select
on public.catalog_variants for select
to authenticated
using (
  public.is_super_admin()
  or exists (
    select 1
    from public.company_members cm
    left join public.profiles p on p.user_id = cm.user_id
    where cm.company_id = catalog_variants.company_id
      and cm.user_id = auth.uid()
      and (
        p.role in ('admin', 'accountant', 'muhasebe', 'installer', 'measurement', 'personnel', 'montaj', 'staff', 'super_admin')
        or cm.role in ('admin', 'accountant', 'muhasebe', 'installer', 'measurement', 'personnel', 'montaj', 'staff', 'super_admin')
        or catalog_variants.is_active = true
      )
  )
);
