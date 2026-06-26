create table if not exists public.supplier_product_prices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  product_id uuid null references public.products(id) on delete set null,
  product_name text not null,
  product_category text null,
  unit_cost numeric not null default 0,
  currency text not null default 'TRY',
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, supplier_id, product_id),
  unique (company_id, supplier_id, product_name)
);

alter table public.supplier_product_prices enable row level security;

drop policy if exists "supplier_product_prices_select_company" on public.supplier_product_prices;
create policy "supplier_product_prices_select_company"
on public.supplier_product_prices
for select
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    where cm.company_id = supplier_product_prices.company_id
      and cm.user_id = auth.uid()
      and coalesce(cm.is_active, true) = true
  )
  or exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.role = 'super_admin'
  )
);

drop policy if exists "supplier_product_prices_write_company_admin" on public.supplier_product_prices;
create policy "supplier_product_prices_write_company_admin"
on public.supplier_product_prices
for all
to authenticated
using (
  exists (
    select 1
    from public.company_members cm
    where cm.company_id = supplier_product_prices.company_id
      and cm.user_id = auth.uid()
      and coalesce(cm.is_active, true) = true
      and cm.role in ('admin', 'accountant')
  )
  or exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.role = 'super_admin'
  )
)
with check (
  exists (
    select 1
    from public.company_members cm
    where cm.company_id = supplier_product_prices.company_id
      and cm.user_id = auth.uid()
      and coalesce(cm.is_active, true) = true
      and cm.role in ('admin', 'accountant')
  )
  or exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.role = 'super_admin'
  )
);
