-- Curtain SaaS customer-ready hardening
-- Safe to run more than once. It does not delete existing customer data.

create extension if not exists pgcrypto;

-- Canonical status/plan defaults used by the app.
alter table public.companies add column if not exists subscription_plan text default 'starter';
alter table public.companies add column if not exists plan_status text default 'trial';
alter table public.companies add column if not exists trial_start timestamptz default now();
alter table public.companies add column if not exists trial_end timestamptz;
alter table public.companies add column if not exists trial_ends_at timestamptz;
alter table public.companies add column if not exists is_active boolean not null default true;
alter table public.companies add column if not exists read_only boolean not null default false;
alter table public.companies add column if not exists is_pilot boolean not null default false;
alter table public.companies add column if not exists enabled_modules text[] default array['orders','customers','appointments'];

alter table public.companies
  drop constraint if exists companies_plan_status_chk;
alter table public.companies
  add constraint companies_plan_status_chk
  check (plan_status in ('active', 'trial', 'expired', 'suspended', 'lifetime'));

alter table public.companies
  drop constraint if exists companies_subscription_plan_chk;
alter table public.companies
  add constraint companies_subscription_plan_chk
  check (subscription_plan in ('starter', 'pro', 'enterprise', 'lifetime', 'trial'));

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
        or coalesce(c.plan_status, 'trial') in ('active', 'lifetime')
        or (
          coalesce(c.plan_status, 'trial') = 'trial'
          and coalesce(c.trial_end, c.trial_ends_at, now() + interval '1 day') >= now()
        )
      )
  )
$$;

create or replace function public.enforce_tenant_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.company_id is null then
    raise exception 'company_id zorunludur.';
  end if;

  if not public.is_super_admin() and not public.is_company_member(new.company_id) then
    raise exception 'Bu firmaya işlem yapma yetkiniz yok.';
  end if;

  if public.is_super_admin() then
    return new;
  end if;

  if not public.is_company_writable(new.company_id) then
    raise exception 'Firma lisansı aktif değil veya sadece okuma modunda.';
  end if;

  return new;
end;
$$;

create or replace function public.install_tenant_policy(p_table text, p_accounting_only boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('public.' || p_table) is null then
    return;
  end if;

  execute format('alter table public.%I enable row level security', p_table);

  execute format('drop policy if exists %I on public.%I', p_table || '_tenant_select', p_table);
  execute format(
    'create policy %I on public.%I for select to authenticated using (public.is_super_admin() or public.is_company_member(company_id))',
    p_table || '_tenant_select',
    p_table
  );

  execute format('drop policy if exists %I on public.%I', p_table || '_tenant_insert', p_table);
  execute format(
    'create policy %I on public.%I for insert to authenticated with check (public.is_super_admin() or (%s and public.is_company_writable(company_id)))',
    p_table || '_tenant_insert',
    p_table,
    case when p_accounting_only then 'public.is_company_accounting(company_id)' else 'public.is_company_member(company_id)' end
  );

  execute format('drop policy if exists %I on public.%I', p_table || '_tenant_update', p_table);
  execute format(
    'create policy %I on public.%I for update to authenticated using (public.is_super_admin() or (%s and public.is_company_writable(company_id))) with check (public.is_super_admin() or (%s and public.is_company_writable(company_id)))',
    p_table || '_tenant_update',
    p_table,
    case when p_accounting_only then 'public.is_company_accounting(company_id)' else 'public.is_company_member(company_id)' end,
    case when p_accounting_only then 'public.is_company_accounting(company_id)' else 'public.is_company_member(company_id)' end
  );

  execute format('drop policy if exists %I on public.%I', p_table || '_tenant_delete', p_table);
  execute format(
    'create policy %I on public.%I for delete to authenticated using (public.is_super_admin() or (%s and public.is_company_writable(company_id)))',
    p_table || '_tenant_delete',
    p_table,
    case when p_accounting_only then 'public.is_company_accounting(company_id)' else 'public.is_company_admin(company_id)' end
  );

  execute format('drop trigger if exists trg_%I_tenant_write on public.%I', p_table, p_table);
  execute format(
    'create trigger trg_%I_tenant_write before insert or update on public.%I for each row execute function public.enforce_tenant_write()',
    p_table,
    p_table
  );
end;
$$;

select public.install_tenant_policy('customers', false);
select public.install_tenant_policy('orders', false);
select public.install_tenant_policy('order_items', false);
select public.install_tenant_policy('appointments', false);
select public.install_tenant_policy('payments', true);
select public.install_tenant_policy('income', true);
select public.install_tenant_policy('expenses', true);
select public.install_tenant_policy('suppliers', true);
select public.install_tenant_policy('supplier_payments', true);
select public.install_tenant_policy('transactions', true);
select public.install_tenant_policy('invoices', true);
select public.install_tenant_policy('invoice_items', true);
select public.install_tenant_policy('catalog_series', false);
select public.install_tenant_policy('catalog_variants', false);
select public.install_tenant_policy('employees', false);
select public.install_tenant_policy('branches', false);

drop policy if exists appointments_installer_assigned_select on public.appointments;
create policy appointments_installer_assigned_select
on public.appointments
for select
to authenticated
using (
  public.is_super_admin()
  or public.is_company_admin(company_id)
  or public.is_company_accounting(company_id)
  or (
    public.is_company_member(company_id)
    and (
      assigned_to = auth.uid()
      or assigned_user_id = auth.uid()
      or created_by = auth.uid()
    )
  )
);

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

-- Health checks to run after migration:
-- select 'customers' table_name, count(*) missing_company_id from public.customers where company_id is null
-- union all select 'orders', count(*) from public.orders where company_id is null
-- union all select 'appointments', count(*) from public.appointments where company_id is null;
-- select id, name, subscription_plan, plan_status, trial_end, is_active, read_only from public.companies order by created_at desc;
