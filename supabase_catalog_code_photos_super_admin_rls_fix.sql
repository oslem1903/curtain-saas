-- =============================================================
-- catalog_code_photos: super admin (impersonation) RLS bypass
--
-- Root cause: "Firma Olarak Giris" gercek bir Supabase Auth
-- oturum degisimi yapmiyor; auth.uid() her zaman super adminin
-- kendi ID'si kaliyor. Bu ID ilgili firmanin company_members
-- tablosunda YOK. catalog_code_photos INSERT/SELECT policy'leri
-- yalnizca company_members uyeligine bakiyor, is_super_admin()
-- bypass'i yok -> impersonation sirasinda saha fotografi
-- INSERT (siparise cevirme) ve SELECT (siparis/montaj detayi
-- goruntuleme) islemleri RLS tarafindan sessizce reddediliyor.
--
-- Bu migration YALNIZCA catalog_code_photos icin INSERT ve
-- SELECT policy'lerine, repoda onlarca policy'de zaten kullanilan
-- public.is_super_admin() bypass'ini ekler. Normal tenant
-- kullanicisi icin mevcut company_members kosulu BIREBIR
-- korunur (sadece OR ile genisletilir, daraltilmaz).
--
-- Idempotent, additive: veri/semaya dokunmaz, RLS'i disable
-- etmez, using(true)/with check(true) kullanmaz, UPDATE/DELETE
-- policy eklemez (mevcut tasarimda yok, kapsam disi).
-- =============================================================

drop policy if exists catalog_code_photos_insert_company_members on public.catalog_code_photos;
create policy catalog_code_photos_insert_company_members
on public.catalog_code_photos
for insert
to authenticated
with check (
  public.is_super_admin()
  or exists (
    select 1
    from public.company_members cm
    where cm.company_id = catalog_code_photos.company_id
      and cm.user_id = auth.uid()
  )
);

drop policy if exists catalog_code_photos_select_company_members on public.catalog_code_photos;
create policy catalog_code_photos_select_company_members
on public.catalog_code_photos
for select
to authenticated
using (
  public.is_super_admin()
  or exists (
    select 1
    from public.company_members cm
    where cm.company_id = catalog_code_photos.company_id
      and cm.user_id = auth.uid()
  )
);

-- Dogrulama (READ-ONLY, migration disinda calistirin):
-- select polname, polcmd,
--        pg_get_expr(polqual, polrelid)      as using_expr,
--        pg_get_expr(polwithcheck, polrelid) as with_check_expr
-- from pg_policy
-- where polrelid = 'public.catalog_code_photos'::regclass;
