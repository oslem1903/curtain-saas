-- Kullanıcı destek taleplerinin gerçekten kaydedilip süper admin tarafından
-- görülebilmesi ve eski kurulumlarda eksik canary hatalarının ekranı bozmasını
-- önlemek için idempotent uyumluluk migration'ı.
create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete set null,
  user_id uuid,
  title text not null,
  description text not null,
  category text default 'other', priority text default 'medium',
  status text default 'open', page_url text, screenshot_url text,
  support_metadata jsonb, admin_response text, internal_note text,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
alter table public.support_tickets enable row level security;
drop policy if exists support_tickets_user_insert on public.support_tickets;
create policy support_tickets_user_insert on public.support_tickets for insert to authenticated
  with check (public.is_super_admin() or company_id in (select public.my_company_ids()));
drop policy if exists support_tickets_super_select on public.support_tickets;
create policy support_tickets_super_select on public.support_tickets for select to authenticated
  using (public.is_super_admin() or company_id in (select public.my_company_ids()));
drop policy if exists support_tickets_super_update on public.support_tickets;
create policy support_tickets_super_update on public.support_tickets for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

insert into storage.buckets (id, name, public) values ('support-attachments','support-attachments',false)
on conflict (id) do nothing;
drop policy if exists support_attachments_insert on storage.objects;
create policy support_attachments_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'support-attachments' and (public.is_super_admin() or split_part(name,'/',1) in (select public.my_company_ids()::text)));
drop policy if exists support_attachments_read on storage.objects;
create policy support_attachments_read on storage.objects for select to authenticated
  using (bucket_id = 'support-attachments' and (public.is_super_admin() or split_part(name,'/',1) in (select public.my_company_ids()::text)));

-- Deployment ekranının çağırdığı RPC yoksa frontend sürüm kayıtlarına düşer;
-- bu indeksler fallback sorgusunu hızlı tutar.
create index if not exists idx_version_releases_created_at on public.version_releases(created_at desc);
