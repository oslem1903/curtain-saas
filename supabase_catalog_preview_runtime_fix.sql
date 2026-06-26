-- PerdePro Kartela + Saha Onizleme Runtime Fix
-- Guvenli/additive migration: veri silmez, truncate/drop table yapmaz.
-- Supabase SQL Editor'da tek parca calistirin.

begin;

create extension if not exists "pgcrypto";

insert into storage.buckets (id, name, public)
values
  ('catalog-images', 'catalog-images', true),
  ('visual-previews', 'visual-previews', true)
on conflict (id) do update set public = excluded.public;

create table if not exists public.catalog_series (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_type text not null,
  code text,
  series_code text,
  model_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.catalog_variants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  series_id uuid not null references public.catalog_series(id) on delete cascade,
  variant_code text not null,
  color_name text,
  variant_image_url text,
  texture_image_url text,
  price_per_m2 numeric(12,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.visual_previews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  original_photo_url text,
  preview_image_url text,
  selected_catalog_variant_id uuid references public.catalog_variants(id) on delete set null,
  product_type text,
  model_code text,
  variant_code text,
  preview_texture_url text,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table if exists public.catalog_series
  add column if not exists code text,
  add column if not exists series_code text,
  add column if not exists model_name text,
  add column if not exists product_type text,
  add column if not exists is_active boolean default true,
  add column if not exists created_at timestamptz default now();

alter table if exists public.catalog_variants
  add column if not exists color_name text,
  add column if not exists variant_image_url text,
  add column if not exists texture_image_url text,
  add column if not exists price_per_m2 numeric(12,2) default 0,
  add column if not exists is_active boolean default true,
  add column if not exists created_at timestamptz default now();

alter table if exists public.visual_previews
  add column if not exists company_id uuid,
  add column if not exists appointment_id uuid,
  add column if not exists customer_id uuid,
  add column if not exists order_id uuid,
  add column if not exists original_photo_url text,
  add column if not exists preview_image_url text,
  add column if not exists selected_catalog_variant_id uuid,
  add column if not exists product_type text,
  add column if not exists model_code text,
  add column if not exists variant_code text,
  add column if not exists preview_texture_url text,
  add column if not exists note text,
  add column if not exists created_by uuid,
  add column if not exists created_at timestamptz default now();

update public.catalog_series
set code = coalesce(code, series_code)
where code is null and series_code is not null;

update public.catalog_series
set series_code = coalesce(series_code, code)
where series_code is null and code is not null;

update public.catalog_variants
set texture_image_url = coalesce(texture_image_url, variant_image_url)
where texture_image_url is null and variant_image_url is not null;

update public.catalog_variants
set variant_image_url = coalesce(variant_image_url, texture_image_url)
where variant_image_url is null and texture_image_url is not null;

create index if not exists catalog_series_company_type_idx
  on public.catalog_series(company_id, product_type, is_active);

create index if not exists catalog_variants_company_series_idx
  on public.catalog_variants(company_id, series_id, is_active);

create index if not exists visual_previews_company_idx
  on public.visual_previews(company_id);

create index if not exists visual_previews_customer_idx
  on public.visual_previews(company_id, customer_id);

alter table public.catalog_series enable row level security;
alter table public.catalog_variants enable row level security;
alter table public.visual_previews enable row level security;

drop policy if exists catalog_series_company_select on public.catalog_series;
create policy catalog_series_company_select
on public.catalog_series for select
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

drop policy if exists catalog_series_admin_write on public.catalog_series;
create policy catalog_series_admin_write
on public.catalog_series for all
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

drop policy if exists catalog_variants_company_select on public.catalog_variants;
create policy catalog_variants_company_select
on public.catalog_variants for select
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

drop policy if exists catalog_variants_admin_write on public.catalog_variants;
create policy catalog_variants_admin_write
on public.catalog_variants for all
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

drop policy if exists visual_previews_company_select on public.visual_previews;
create policy visual_previews_company_select
on public.visual_previews for select
using (
  exists (
    select 1
    from public.company_members cm
    where cm.company_id = visual_previews.company_id
      and cm.user_id = auth.uid()
  )
);

drop policy if exists visual_previews_company_insert on public.visual_previews;
create policy visual_previews_company_insert
on public.visual_previews for insert
with check (
  exists (
    select 1
    from public.company_members cm
    where cm.company_id = visual_previews.company_id
      and cm.user_id = auth.uid()
  )
);

drop policy if exists visual_previews_company_update on public.visual_previews;
create policy visual_previews_company_update
on public.visual_previews for update
using (
  exists (
    select 1
    from public.company_members cm
    left join public.profiles p on p.user_id = cm.user_id
    where cm.company_id = visual_previews.company_id
      and cm.user_id = auth.uid()
      and p.role in ('admin', 'installer', 'measurement', 'personnel', 'montaj', 'staff')
  )
)
with check (
  exists (
    select 1
    from public.company_members cm
    left join public.profiles p on p.user_id = cm.user_id
    where cm.company_id = visual_previews.company_id
      and cm.user_id = auth.uid()
      and p.role in ('admin', 'installer', 'measurement', 'personnel', 'montaj', 'staff')
  )
);

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'catalog_images_public_read'
  ) then
    create policy catalog_images_public_read
      on storage.objects for select
      using (bucket_id = 'catalog-images');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'catalog_images_authenticated_insert'
  ) then
    create policy catalog_images_authenticated_insert
      on storage.objects for insert
      to authenticated
      with check (bucket_id = 'catalog-images');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'visual_previews_public_read'
  ) then
    create policy visual_previews_public_read
      on storage.objects for select
      using (bucket_id = 'visual-previews');
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'visual_previews_authenticated_insert'
  ) then
    create policy visual_previews_authenticated_insert
      on storage.objects for insert
      to authenticated
      with check (bucket_id = 'visual-previews');
  end if;
end $$;

commit;
