-- =====================================================================
-- supplier_product_prices şema düzeltmesi
-- Hata: "Could not find the 'product_name' column of 'supplier_product_prices'
--        in the schema cache"
-- Sebep: Canlı tabloda eski şema (product_type / unit_price) var,
--        uygulama yeni şemayı (product_name / unit_cost) yazıyor.
-- Bu script idempotenttir, birden fazla kez çalıştırılabilir.
-- =====================================================================

-- 1) Tablo hiç yoksa yeni şemayla oluştur
create table if not exists public.supplier_product_prices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  product_id uuid null references public.products(id) on delete set null,
  product_name text,
  product_category text null,
  unit_cost numeric,
  currency text,
  note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) Eksik kolonları ekle
alter table public.supplier_product_prices add column if not exists product_id uuid null references public.products(id) on delete set null;
alter table public.supplier_product_prices add column if not exists product_name text;
alter table public.supplier_product_prices add column if not exists product_category text;
alter table public.supplier_product_prices add column if not exists unit_cost numeric;
alter table public.supplier_product_prices add column if not exists currency text;
alter table public.supplier_product_prices add column if not exists note text;
alter table public.supplier_product_prices add column if not exists created_at timestamptz not null default now();
alter table public.supplier_product_prices add column if not exists updated_at timestamptz not null default now();

-- 3) Eski kolonlardan veriyi taşı + eski kolonların NOT NULL kısıtını kaldır
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'supplier_product_prices'
      and column_name = 'product_type'
  ) then
    execute $sql$
      update public.supplier_product_prices
         set product_name     = coalesce(product_name, product_type),
             product_category = coalesce(product_category, product_type)
       where product_name is null or product_category is null
    $sql$;
    execute 'alter table public.supplier_product_prices alter column product_type drop not null';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'supplier_product_prices'
      and column_name = 'unit_price'
  ) then
    execute $sql$
      update public.supplier_product_prices
         set unit_cost = coalesce(unit_cost, unit_price)
       where unit_cost is null
    $sql$;
    execute 'alter table public.supplier_product_prices alter column unit_price drop not null';
  end if;
end $$;

-- 4) Boş kalan değerleri doldur
update public.supplier_product_prices
   set product_name = 'İsimsiz'
 where product_name is null or btrim(product_name) = '';

update public.supplier_product_prices set unit_cost = 0   where unit_cost is null;
update public.supplier_product_prices set currency  = 'TRY' where currency  is null;

-- 5) Kısıtlar / varsayılanlar
alter table public.supplier_product_prices alter column product_name set not null;
alter table public.supplier_product_prices alter column unit_cost    set not null;
alter table public.supplier_product_prices alter column unit_cost    set default 0;
alter table public.supplier_product_prices alter column currency     set not null;
alter table public.supplier_product_prices alter column currency     set default 'TRY';

-- 6) Tekillik: aynı tedarikçide aynı ürün adı bir kez
do $$
begin
  -- olası kopyaları temizle (en yenisi kalır)
  delete from public.supplier_product_prices a
   using public.supplier_product_prices b
   where a.company_id = b.company_id
     and a.supplier_id = b.supplier_id
     and lower(btrim(a.product_name)) = lower(btrim(b.product_name))
     and a.ctid < b.ctid;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.supplier_product_prices'::regclass
      and conname = 'supplier_product_prices_company_supplier_name_key'
  ) then
    alter table public.supplier_product_prices
      add constraint supplier_product_prices_company_supplier_name_key
      unique (company_id, supplier_id, product_name);
  end if;
end $$;

-- 7) updated_at otomatik güncelleme
create or replace function public.set_supplier_product_prices_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_supplier_product_prices_updated_at on public.supplier_product_prices;
create trigger trg_supplier_product_prices_updated_at
before update on public.supplier_product_prices
for each row execute function public.set_supplier_product_prices_updated_at();

-- 8) RLS politikaları (mevcut sürümle aynı mantık)
alter table public.supplier_product_prices enable row level security;

drop policy if exists "supplier_product_prices_select_company" on public.supplier_product_prices;
create policy "supplier_product_prices_select_company"
on public.supplier_product_prices
for select
to authenticated
using (
  exists (
    select 1 from public.company_members cm
    where cm.company_id = supplier_product_prices.company_id
      and cm.user_id = auth.uid()
      and coalesce(cm.is_active, true) = true
  )
  or exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'super_admin'
  )
);

drop policy if exists "supplier_product_prices_write_company_admin" on public.supplier_product_prices;
create policy "supplier_product_prices_write_company_admin"
on public.supplier_product_prices
for all
to authenticated
using (
  exists (
    select 1 from public.company_members cm
    where cm.company_id = supplier_product_prices.company_id
      and cm.user_id = auth.uid()
      and coalesce(cm.is_active, true) = true
      and cm.role in ('admin', 'accountant')
  )
  or exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'super_admin'
  )
)
with check (
  exists (
    select 1 from public.company_members cm
    where cm.company_id = supplier_product_prices.company_id
      and cm.user_id = auth.uid()
      and coalesce(cm.is_active, true) = true
      and cm.role in ('admin', 'accountant')
  )
  or exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid() and p.role = 'super_admin'
  )
);

-- 9) PostgREST şema önbelleğini yenile (asıl hata mesajının kaynağı)
notify pgrst, 'reload schema';

-- 10) Doğrulama
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema = 'public' and table_name = 'supplier_product_prices'
 order by ordinal_position;
