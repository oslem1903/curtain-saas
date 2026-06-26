-- PerdePro saha personeli MVP additive migration
-- Güvenli kullanım: veri silmez, drop/truncate yapmaz. Supabase SQL Editor'da tek parça çalıştırılabilir.

begin;

alter table if exists public.customers
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists district text,
  add column if not exists notes text;

alter table if exists public.appointments
  add column if not exists assigned_user_id uuid,
  add column if not exists assigned_role text,
  add column if not exists room_name text,
  add column if not exists width_cm numeric,
  add column if not exists height_cm numeric,
  add column if not exists rounded_width_cm numeric,
  add column if not exists rounded_height_cm numeric,
  add column if not exists product_type text,
  add column if not exists model_name text,
  add column if not exists color_name text,
  add column if not exists quantity integer default 1,
  add column if not exists unit_price numeric default 0,
  add column if not exists estimated_area_m2 numeric default 0,
  add column if not exists estimated_total numeric default 0,
  add column if not exists measurement_notes text,
  add column if not exists measurement_photo_url text,
  add column if not exists issue_note text,
  add column if not exists done boolean default false,
  add column if not exists done_at timestamptz;

alter table if exists public.order_items
  add column if not exists product_type text,
  add column if not exists width_cm numeric,
  add column if not exists height_cm numeric,
  add column if not exists qty numeric default 1,
  add column if not exists unit_price numeric default 0,
  add column if not exists area_m2 numeric default 0,
  add column if not exists line_total numeric default 0,
  add column if not exists model_name text,
  add column if not exists color_name text,
  add column if not exists note text;

alter table if exists public.orders
  add column if not exists assigned_to uuid,
  add column if not exists source_appointment_id uuid,
  add column if not exists source_visual_preview_id uuid,
  add column if not exists estimate_total numeric default 0;

create table if not exists public.visual_previews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid,
  appointment_id uuid,
  customer_id uuid,
  original_photo_url text,
  preview_image_url text,
  selected_catalog_variant_id uuid,
  product_type text,
  model_code text,
  variant_code text,
  preview_texture_url text,
  note text,
  created_by uuid,
  created_at timestamptz default now()
);

alter table if exists public.visual_previews
  add column if not exists company_id uuid,
  add column if not exists appointment_id uuid,
  add column if not exists customer_id uuid,
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

create index if not exists appointments_company_assigned_user_idx
  on public.appointments (company_id, assigned_user_id);

create index if not exists appointments_company_assigned_to_idx
  on public.appointments (company_id, assigned_to);

create index if not exists appointments_company_status_start_idx
  on public.appointments (company_id, status, start_at);

create index if not exists visual_previews_company_customer_idx
  on public.visual_previews (company_id, customer_id);

create index if not exists visual_previews_company_appointment_idx
  on public.visual_previews (company_id, appointment_id);

insert into storage.buckets (id, name, public)
values ('measurement-photos', 'measurement-photos', true)
on conflict (id) do update set public = excluded.public;

insert into storage.buckets (id, name, public)
values ('visual-previews', 'visual-previews', true)
on conflict (id) do update set public = excluded.public;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'measurement_photos_public_read'
  ) then
    create policy measurement_photos_public_read
      on storage.objects
      for select
      using (bucket_id = 'measurement-photos');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'measurement_photos_authenticated_insert'
  ) then
    create policy measurement_photos_authenticated_insert
      on storage.objects
      for insert
      to authenticated
      with check (bucket_id = 'measurement-photos');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'visual_previews_public_read'
  ) then
    create policy visual_previews_public_read
      on storage.objects
      for select
      using (bucket_id = 'visual-previews');
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'visual_previews_authenticated_insert'
  ) then
    create policy visual_previews_authenticated_insert
      on storage.objects
      for insert
      to authenticated
      with check (bucket_id = 'visual-previews');
  end if;
end $$;

commit;

-- Kontrol:
-- select column_name from information_schema.columns where table_schema='public' and table_name='appointments' and column_name in ('measurement_notes','measurement_photo_url','rounded_width_cm','estimated_total','assigned_user_id');
