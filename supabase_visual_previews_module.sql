-- Basit Kartela Sistemi + Gorsel Onizleme
-- Supabase SQL Editor'de calistirin.

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
  created_at timestamptz not null default now(),
  constraint catalog_series_product_type_check check (
    product_type in ('plicell', 'stor', 'zebra', 'tul', 'fon', 'jalousie', 'dikey_tul', 'dikey_stor', 'cam_balkon', 'diger')
  )
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

alter table public.catalog_series add column if not exists code text;
alter table public.catalog_series add column if not exists series_code text;
alter table public.catalog_variants add column if not exists color_name text;
alter table public.catalog_variants add column if not exists variant_image_url text;
alter table public.catalog_variants add column if not exists texture_image_url text;

alter table public.catalog_series alter column supplier_name drop not null;
alter table public.catalog_series alter column series_code drop not null;
alter table public.catalog_variants alter column texture_image_url drop not null;

update public.catalog_series
set code = coalesce(code, series_code)
where code is null and series_code is not null;

update public.catalog_series
set series_code = coalesce(series_code, code)
where series_code is null and code is not null;

update public.catalog_variants
set variant_image_url = coalesce(variant_image_url, texture_image_url)
where variant_image_url is null and texture_image_url is not null;

update public.catalog_variants
set texture_image_url = coalesce(texture_image_url, variant_image_url)
where texture_image_url is null and variant_image_url is not null;

create table if not exists public.visual_previews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  appointment_id uuid references public.appointments(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  original_photo_url text not null,
  selected_catalog_variant_id uuid references public.catalog_variants(id) on delete set null,
  product_type text,
  model_code text,
  variant_code text,
  preview_texture_url text,
  preview_image_url text not null,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.visual_previews add column if not exists selected_catalog_variant_id uuid references public.catalog_variants(id) on delete set null;
alter table public.visual_previews add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.visual_previews add column if not exists product_type text;
alter table public.visual_previews add column if not exists model_code text;
alter table public.visual_previews add column if not exists variant_code text;
alter table public.visual_previews add column if not exists preview_texture_url text;

create index if not exists catalog_series_company_idx on public.catalog_series(company_id);
create index if not exists catalog_series_active_type_idx on public.catalog_series(company_id, is_active, product_type);
create index if not exists catalog_variants_company_idx on public.catalog_variants(company_id);
create index if not exists catalog_variants_series_idx on public.catalog_variants(series_id);
create index if not exists catalog_variants_active_idx on public.catalog_variants(company_id, is_active);
create index if not exists visual_previews_company_idx on public.visual_previews(company_id);
create index if not exists visual_previews_order_idx on public.visual_previews(order_id);

alter table public.catalog_series enable row level security;
alter table public.catalog_variants enable row level security;
alter table public.visual_previews enable row level security;

drop policy if exists "catalog series admin accountant select" on public.catalog_series;
drop policy if exists "catalog series staff active select" on public.catalog_series;
drop policy if exists "catalog series admin accountant insert" on public.catalog_series;
drop policy if exists "catalog series admin accountant update" on public.catalog_series;
drop policy if exists "catalog series admin accountant delete" on public.catalog_series;

create policy "catalog series admin accountant select"
on public.catalog_series for select
using (
  exists (
    select 1 from public.company_members cm
    join public.profiles p on p.user_id = cm.user_id
    where cm.company_id = catalog_series.company_id
      and cm.user_id = auth.uid()
      and p.role in ('admin', 'accountant', 'muhasebe')
  )
);

create policy "catalog series staff active select"
on public.catalog_series for select
using (
  is_active = true
  and exists (
    select 1 from public.company_members cm
    join public.profiles p on p.user_id = cm.user_id
    where cm.company_id = catalog_series.company_id
      and cm.user_id = auth.uid()
      and p.role in ('installer', 'staff', 'montaj')
  )
);

create policy "catalog series admin accountant insert"
on public.catalog_series for insert
with check (
  exists (
    select 1 from public.company_members cm
    join public.profiles p on p.user_id = cm.user_id
    where cm.company_id = catalog_series.company_id
      and cm.user_id = auth.uid()
      and p.role in ('admin', 'accountant', 'muhasebe')
  )
);

create policy "catalog series admin accountant update"
on public.catalog_series for update
using (
  exists (
    select 1 from public.company_members cm
    join public.profiles p on p.user_id = cm.user_id
    where cm.company_id = catalog_series.company_id
      and cm.user_id = auth.uid()
      and p.role in ('admin', 'accountant', 'muhasebe')
  )
)
with check (
  exists (
    select 1 from public.company_members cm
    join public.profiles p on p.user_id = cm.user_id
    where cm.company_id = catalog_series.company_id
      and cm.user_id = auth.uid()
      and p.role in ('admin', 'accountant', 'muhasebe')
  )
);

create policy "catalog series admin accountant delete"
on public.catalog_series for delete
using (
  exists (
    select 1 from public.company_members cm
    join public.profiles p on p.user_id = cm.user_id
    where cm.company_id = catalog_series.company_id
      and cm.user_id = auth.uid()
      and p.role in ('admin', 'accountant', 'muhasebe')
  )
);

drop policy if exists "catalog variants admin accountant select" on public.catalog_variants;
drop policy if exists "catalog variants staff active select" on public.catalog_variants;
drop policy if exists "catalog variants admin accountant insert" on public.catalog_variants;
drop policy if exists "catalog variants admin accountant update" on public.catalog_variants;
drop policy if exists "catalog variants admin accountant delete" on public.catalog_variants;

create policy "catalog variants admin accountant select"
on public.catalog_variants for select
using (
  exists (
    select 1 from public.company_members cm
    join public.profiles p on p.user_id = cm.user_id
    where cm.company_id = catalog_variants.company_id
      and cm.user_id = auth.uid()
      and p.role in ('admin', 'accountant', 'muhasebe')
  )
);

create policy "catalog variants staff active select"
on public.catalog_variants for select
using (
  is_active = true
  and exists (
    select 1 from public.company_members cm
    join public.profiles p on p.user_id = cm.user_id
    where cm.company_id = catalog_variants.company_id
      and cm.user_id = auth.uid()
      and p.role in ('installer', 'staff', 'montaj')
  )
);

create policy "catalog variants admin accountant insert"
on public.catalog_variants for insert
with check (
  exists (
    select 1 from public.company_members cm
    join public.profiles p on p.user_id = cm.user_id
    where cm.company_id = catalog_variants.company_id
      and cm.user_id = auth.uid()
      and p.role in ('admin', 'accountant', 'muhasebe')
  )
);

create policy "catalog variants admin accountant update"
on public.catalog_variants for update
using (
  exists (
    select 1 from public.company_members cm
    join public.profiles p on p.user_id = cm.user_id
    where cm.company_id = catalog_variants.company_id
      and cm.user_id = auth.uid()
      and p.role in ('admin', 'accountant', 'muhasebe')
  )
)
with check (
  exists (
    select 1 from public.company_members cm
    join public.profiles p on p.user_id = cm.user_id
    where cm.company_id = catalog_variants.company_id
      and cm.user_id = auth.uid()
      and p.role in ('admin', 'accountant', 'muhasebe')
  )
);

create policy "catalog variants admin accountant delete"
on public.catalog_variants for delete
using (
  exists (
    select 1 from public.company_members cm
    join public.profiles p on p.user_id = cm.user_id
    where cm.company_id = catalog_variants.company_id
      and cm.user_id = auth.uid()
      and p.role in ('admin', 'accountant', 'muhasebe')
  )
);

drop policy if exists "visual previews company members read" on public.visual_previews;
drop policy if exists "visual previews field write" on public.visual_previews;

create policy "visual previews company members read"
on public.visual_previews for select
using (
  exists (
    select 1 from public.company_members cm
    where cm.company_id = visual_previews.company_id
      and cm.user_id = auth.uid()
  )
);

create policy "visual previews field write"
on public.visual_previews for all
using (
  exists (
    select 1 from public.company_members cm
    join public.profiles p on p.user_id = cm.user_id
    where cm.company_id = visual_previews.company_id
      and cm.user_id = auth.uid()
      and p.role in ('admin', 'installer', 'accountant', 'staff', 'montaj', 'muhasebe')
  )
)
with check (
  exists (
    select 1 from public.company_members cm
    join public.profiles p on p.user_id = cm.user_id
    where cm.company_id = visual_previews.company_id
      and cm.user_id = auth.uid()
      and p.role in ('admin', 'installer', 'accountant', 'staff', 'montaj', 'muhasebe')
  )
);

drop policy if exists "catalog image storage read" on storage.objects;
drop policy if exists "catalog image storage write" on storage.objects;
drop policy if exists "catalog image storage update" on storage.objects;
drop policy if exists "visual preview storage read" on storage.objects;
drop policy if exists "visual preview storage write" on storage.objects;
drop policy if exists "visual preview storage update" on storage.objects;

create policy "catalog image storage read"
on storage.objects for select
using (bucket_id = 'catalog-images');

create policy "catalog image storage write"
on storage.objects for insert
with check (
  bucket_id = 'catalog-images'
  and exists (
    select 1 from public.company_members cm
    join public.profiles p on p.user_id = cm.user_id
    where cm.company_id::text = (storage.foldername(name))[1]
      and cm.user_id = auth.uid()
      and p.role in ('admin', 'accountant', 'muhasebe')
  )
);

create policy "catalog image storage update"
on storage.objects for update
using (
  bucket_id = 'catalog-images'
  and exists (
    select 1 from public.company_members cm
    join public.profiles p on p.user_id = cm.user_id
    where cm.company_id::text = (storage.foldername(name))[1]
      and cm.user_id = auth.uid()
      and p.role in ('admin', 'accountant', 'muhasebe')
  )
)
with check (bucket_id = 'catalog-images');

create policy "visual preview storage read"
on storage.objects for select
using (bucket_id = 'visual-previews');

create policy "visual preview storage write"
on storage.objects for insert
with check (
  bucket_id = 'visual-previews'
  and exists (
    select 1 from public.company_members cm
    join public.profiles p on p.user_id = cm.user_id
    where cm.company_id::text = (storage.foldername(name))[1]
      and cm.user_id = auth.uid()
      and p.role in ('admin', 'installer', 'accountant', 'staff', 'montaj', 'muhasebe')
  )
);

create policy "visual preview storage update"
on storage.objects for update
using (
  bucket_id = 'visual-previews'
  and exists (
    select 1 from public.company_members cm
    join public.profiles p on p.user_id = cm.user_id
    where cm.company_id::text = (storage.foldername(name))[1]
      and cm.user_id = auth.uid()
      and p.role in ('admin', 'installer', 'accountant', 'staff', 'montaj', 'muhasebe')
  )
)
with check (bucket_id = 'visual-previews');
