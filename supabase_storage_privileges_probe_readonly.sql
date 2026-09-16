-- =============================================================================
-- SALT OKUNUR YETKİ TEŞHİSİ — "must be owner of table objects" hatası için
--
-- Hiçbir şey değiştirmez. Tek sorgu, çok satır.
-- Çalıştırıp sonuç tablosunun tamamını paylaşın.
--
-- NEDEN: storage.objects üzerinde DROP/CREATE POLICY ve ALTER TABLE ... ENABLE RLS
-- komutları TABLO SAHİPLİĞİ ister. SQL Editor'ün bağlandığı rol sahip değilse
-- 42501 verir. Supabase CLI (`supabase db push`) de veritabanına AYNI rolle
-- bağlanır — yani CLI'ye geçmek TEK BAŞINA bu hatayı çözmez. Bu teşhis,
-- hangi yolun gerçekten mümkün olduğunu kesin olarak söyler.
-- =============================================================================

with
rol as (
  select 1 as sira, 'ROL' as bolum,
         'current_user=' || current_user
         || '  | session_user=' || session_user as deger
),

sahip as (
  select 2 as sira, 'SAHIPLIK' as bolum,
         c.relname || '  | owner=' || pg_get_userbyid(c.relowner)
         || '  | current_user_owner_mu=' ||
            (pg_get_userbyid(c.relowner) = current_user)::text as deger
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'storage'
    and c.relname in ('objects', 'buckets')
),

-- storage yonetici rollerine uyelik var mi? Varsa `set local role ...` ile
-- policy islemleri yapilabilir.
uyelik as (
  select 3 as sira, 'ROL_UYELIGI' as bolum,
         r.rolname || '  | uye_mi=' ||
         pg_has_role(current_user, r.rolname, 'MEMBER')::text
         || '  | usage=' || pg_has_role(current_user, r.rolname, 'USAGE')::text as deger
  from pg_roles r
  where r.rolname in ('supabase_storage_admin', 'supabase_admin', 'postgres', 'service_role')
),

-- storage.buckets uzerinde UPDATE yetkisi (bucket'i private yapabilir miyiz?)
yetki as (
  select 4 as sira, 'TABLO_YETKISI' as bolum,
         'storage.buckets UPDATE=' ||
         has_table_privilege(current_user, 'storage.buckets', 'UPDATE')::text
         || '  | storage.objects SELECT=' ||
         has_table_privilege(current_user, 'storage.objects', 'SELECT')::text as deger
),

-- public semasinda fonksiyon olusturabiliyor muyuz? (storage_path_company_id)
sema as (
  select 5 as sira, 'SEMA_YETKISI' as bolum,
         'public CREATE=' || has_schema_privilege(current_user, 'public', 'CREATE')::text as deger
),

-- Bir onceki calistirmada dogrulanan onkosullar (o asamalar hatasiz gecmisti)
onkosul as (
  select 6 as sira, 'ONKOSUL' as bolum,
         'my_company_ids=' || (to_regprocedure('public.my_company_ids()') is not null)::text
         || '  | is_super_admin=' || (to_regprocedure('public.is_super_admin()') is not null)::text
         || '  | storage_path_company_id=' ||
            (to_regprocedure('public.storage_path_company_id(text)') is not null)::text as deger
),

-- Migration gecmisi: `supabase db push` ONCESI mutlaka gorulmeli.
-- Yerel dosyalarla uyusmuyorsa push beklenmedik migration'lari uygulayabilir.
migrasyon as (
  select 7 as sira, 'MIGRATION_GECMISI' as bolum,
         coalesce(version, '(bos)') || coalesce('  | ' || name, '') as deger
  from supabase_migrations.schema_migrations
  order by version desc
  limit 20
),

migrasyon_sayi as (
  select 8 as sira, 'MIGRATION_ADET' as bolum,
         'remote_kayit_sayisi=' || count(*)::text as deger
  from supabase_migrations.schema_migrations
),

-- Bucket durumu (hala public mi?) — onceki calistirma geri alindiysa true olmali
bucket as (
  select 9 as sira, 'BUCKET_DURUM' as bolum,
         id || '  | public=' || coalesce(public::text, 'null') as deger
  from storage.buckets
),

-- storage.objects politika SAYISI (adlari zaten dusurulmedi; islem geri alindi)
politika as (
  select 10 as sira, 'POLITIKA' as bolum,
         policyname || '  | cmd=' || cmd || '  | roles=' || roles::text as deger
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
)

select sira, bolum, deger from (
  select * from rol
  union all select * from sahip
  union all select * from uyelik
  union all select * from yetki
  union all select * from sema
  union all select * from onkosul
  union all select * from migrasyon
  union all select * from migrasyon_sayi
  union all select * from bucket
  union all select * from politika
) x
order by sira, deger;
