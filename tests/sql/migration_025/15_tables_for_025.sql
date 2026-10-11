-- Canli semanin (2026-10-02 salt okunur inceleme) birebir kopyasi
create table public.appointments (id uuid primary key default gen_random_uuid(), company_id uuid references public.companies(id), title text);
create table public.suppliers (id uuid primary key default gen_random_uuid(), company_id uuid references public.companies(id), name text);
-- orders tablosu 01_existing_schema'da var (id uuid, company_id)

create table public.accounts (id uuid primary key default gen_random_uuid(), company_id uuid not null references auth.users(id) on delete no action, name text, type text, currency text, opening_balance numeric, is_active boolean, created_at timestamptz);
create table public.appointment_assignees (id uuid primary key default gen_random_uuid(), appointment_id uuid not null references public.appointments(id) on delete cascade, staff_user_id uuid not null, company_id uuid not null, created_at timestamptz not null default now());
create table public.catalog_collections (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade, supplier_name text not null default 's', collection_name text not null default 'c', is_active boolean not null default true, created_at timestamptz not null default now());
create table public.catalog_items (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade, collection_id uuid references public.catalog_collections(id) on delete set null, series_code text not null default 's', is_active boolean not null default true);
create table public.expense_categories (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), name text, is_active boolean, created_at timestamp);
create table public.income_categories (id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id), name text, is_active boolean, created_at timestamp);
create table public.installer_payments (id uuid primary key default gen_random_uuid(), company_id uuid references public.companies(id) on delete cascade, installer_id uuid not null, order_id uuid references public.orders(id) on delete set null, amount numeric not null, note text);
create table public.supplier_work_orders (id uuid primary key default gen_random_uuid(), company_id uuid references public.companies(id) on delete cascade, supplier_id uuid references public.suppliers(id) on delete cascade, order_id uuid references public.orders(id) on delete cascade, total_cost numeric, note text);
-- RLS acik, politikasiz (canlidaki gibi: istemci dogrudan yazamaz)
alter table public.accounts enable row level security;
alter table public.expense_categories enable row level security;
alter table public.income_categories enable row level security;
alter table public.installer_payments enable row level security;
alter table public.supplier_work_orders enable row level security;
grant all on all tables in schema public to authenticated;

-- SECURITY DEFINER RPC'ler (RLS'i atlar; koruma yine de calismali)
create or replace function public.rpc_add_work_order(p_company uuid, p_supplier uuid, p_order uuid, p_cost numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; begin
  insert into public.supplier_work_orders(company_id, supplier_id, order_id, total_cost) values (p_company, p_supplier, p_order, p_cost) returning id into v;
  return v; end $$;
create or replace function public.rpc_add_installer_payment(p_company uuid, p_order uuid, p_amount numeric)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; begin
  insert into public.installer_payments(company_id, installer_id, order_id, amount) values (p_company, gen_random_uuid(), p_order, p_amount) returning id into v;
  return v; end $$;
create or replace function public.rpc_set_account_name(p_id uuid, p_name text)
returns void language plpgsql security definer set search_path = public as $$
begin update public.accounts set name = p_name where id = p_id; end $$;
create or replace function public.rpc_delete_category(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin delete from public.expense_categories where id = p_id; end $$;
create or replace function public.rpc_add_order(p_company uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v uuid; begin insert into public.orders(company_id, total) values (p_company, 1) returning id into v; return v; end $$;
grant execute on all functions in schema public to authenticated;
