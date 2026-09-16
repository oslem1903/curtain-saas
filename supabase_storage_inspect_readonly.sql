-- =============================================================================
-- ADIM 1/2 — SALT OKUNUR TESPİT  (hiçbir şey değiştirmez)
--
-- TEK sorgu, çok SATIR. (Tek JSON hücresi ekranda kırpıldığı için satırlara
-- bölündü; ayrıca SQL Editor yalnızca son sorgunun sonucunu gösterdiğinden
-- her şey tek select içinde toplandı.)
--
-- Çalıştırın ve sonuç tablosunun TAMAMINI paylaşın (Export > CSV en kolayı).
-- =============================================================================

with
-- Uygulamanın BİLDİĞİ bucket'lar (koddan): measurement-photos, catalog-images,
-- logos, visual-previews.  Diğerleri "ESKİ/BİLİNMEYEN" olarak işaretlenir.
bilinen as (
  select unnest(array['measurement-photos','catalog-images','logos','visual-previews']) as id
),

b as (
  select
    1 as sira,
    'BUCKET' as bolum,
    b.id
      || '  | public=' || coalesce(b.public::text, 'null')
      || case when bl.id is null then '  | << KODDA YOK (eski bucket) >>' else '' end as deger
  from storage.buckets b
  left join bilinen bl on bl.id = b.id
),

p as (
  select
    2 as sira,
    'POLICY' as bolum,
    policyname
      || '  | cmd=' || cmd
      || '  | roles=' || roles::text
      || '  | using=' || left(coalesce(qual, '-'), 120)
      || '  | check=' || left(coalesce(with_check, '-'), 80) as deger
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
),

r as (
  select 3 as sira, 'RLS' as bolum,
         'storage.objects  enabled=' || relrowsecurity::text
         || '  forced=' || relforcerowsecurity::text as deger
  from pg_class where oid = 'storage.objects'::regclass
),

h as (
  select 4 as sira, 'HELPER' as bolum,
         'my_company_ids=' || (to_regprocedure('public.my_company_ids()') is not null)::text
         || '  is_super_admin=' || (to_regprocedure('public.is_super_admin()') is not null)::text as deger
),

-- Her bucket icin isim sekli dagilimi. UUID onegi ilk 36 karakterden okunur;
-- boylece hem "<uuid>/..." hem "<uuid>-logo.jpg" cozulur.
n as (
  select
    5 as sira,
    'ISIM_SEKLI' as bolum,
    bucket_id
      || '  | toplam=' || count(*)
      || '  | uuid_klasorlu=' || count(*) filter (
             where position('/' in name) > 0
               and substring(name from 1 for 36) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      || '  | uuid_duz=' || count(*) filter (
             where position('/' in name) = 0
               and substring(name from 1 for 36) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
      || '  | COZULEMEYEN=' || count(*) filter (
             where substring(name from 1 for 36) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') as deger
  from storage.objects
  group by bucket_id
),

-- Cozulemeyen ornekler: RLS politikasi bunlari ERISILEMEZ yapar.
c as (
  select 6 as sira, 'COZULEMEYEN_ORNEK' as bolum,
         bucket_id || '  | ' || left(name, 100) as deger
  from storage.objects
  where substring(name from 1 for 36) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  limit 20
),

-- Cozulen uuid companies tablosunda yoksa: o dosyalar da erisilemez kalir.
u as (
  select 7 as sira, 'BILINMEYEN_FIRMA' as bolum,
         cid::text || '  | dosya_sayisi=' || cnt::text as deger
  from (
    select substring(name from 1 for 36)::uuid as cid, count(*) as cnt
    from storage.objects
    where substring(name from 1 for 36) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    group by 1
  ) g
  where not exists (select 1 from public.companies co where co.id = g.cid)
)

select sira, bolum, deger from (
  select * from b
  union all select * from p
  union all select * from r
  union all select * from h
  union all select * from n
  union all select * from c
  union all select * from u
) x
order by sira, deger;
