-- =============================================================================
-- 20260914190000_storage_tenant_isolation
-- PerdePRO — Storage firma izolasyonu (7 bucket)
--
-- Hedef proje: ffhmzlcsgsgjonqqhgqq  (production)
-- Uygulama yolu: npm run db:push  (once `npm run check:link` guard'i calisir)
--
-- -----------------------------------------------------------------------------
-- NEDEN BU DOSYA VAR
-- -----------------------------------------------------------------------------
-- SQL Editor'de ayni icerik "ERROR: 42501: must be owner of table objects" verdi.
-- storage.objects uzerindeki DROP/CREATE POLICY ve ALTER TABLE ... ENABLE RLS
-- komutlari TABLO SAHIPLIGI ister; baglanan rol (postgres) sahip degil
-- (sahip: supabase_storage_admin).
--
-- DIKKAT: Supabase CLI de veritabanina AYNI rolle baglanir. Bu yuzden dosyayi
-- migration'a tasimak tek basina yetmez. Cozum, policy islemlerini
-- `set local role supabase_storage_admin` altinda yapmaktir — bu da ancak
-- baglanan rol o role UYE ise mumkundur. Asagidaki 0. adim bunu ONCE kontrol
-- eder ve uyelik yoksa ANLASILIR bir hatayla, HICBIR SEY DEGISTIRMEDEN durur.
-- Uyelik yoksa yapilacak: Supabase Dashboard > Storage > Policies ekrani
-- (o ekran ayricalikli bir servis uzerinden calisir).
-- =============================================================================

-- ÖNEMLİ: Bu dosyadaki her şey tek transaction içindedir. Supabase CLI her
-- migration dosyasını kendi transaction'ında çalıştırır; bir hata TÜM dosyayı
-- geri alır.

-- -----------------------------------------------------------------------------
-- 0) ÖN KONTROL — bağımlılıklar, kapsam ve SAHİPLİK/ROL yetkisi
-- -----------------------------------------------------------------------------
do $$
declare
  kapsam text[] := array[
    'appointment-photos', 'catalog-images', 'catalog-pdfs', 'logos',
    'measurement-photos', 'support-attachments', 'visual-previews'
  ];
  kapsam_disi text;
  sahip name;
begin
  if to_regprocedure('public.my_company_ids()') is null then
    raise exception 'public.my_company_ids() bulunamadi. Politikalar buna dayaniyor.';
  end if;
  if to_regprocedure('public.is_super_admin()') is null then
    raise exception 'public.is_super_admin() bulunamadi. Politikalar buna dayaniyor.';
  end if;

  select string_agg(id, ', ') into kapsam_disi
  from storage.buckets where id <> all (kapsam);
  if kapsam_disi is not null then
    raise exception
      'Kapsam disinda bucket(lar): %. Bu migration yalnizca su 7 bucketi kapsiyor: %. Kapsam guncellenmeden devam edilemez.',
      kapsam_disi, array_to_string(kapsam, ', ');
  end if;

  -- SAHIPLIK: policy islemleri icin ya sahibiz ya da sahibin rolune uyeyiz.
  select pg_get_userbyid(c.relowner) into sahip
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'storage' and c.relname = 'objects';

  if sahip <> current_user and not pg_has_role(current_user, sahip, 'MEMBER') then
    raise exception
      E'YETKI YETERSIZ: storage.objects sahibi "%s", baglanan rol "%s" ve bu rol o role UYE DEGIL.\nBu migration policy olusturamaz (42501).\nYAPILACAK: Supabase Dashboard > Storage > Policies ekranindan tanimlayin, ya da destek uzerinden "%s" rolune uyelik isteyin.\nHICBIR SEY DEGISTIRILMEDI.',
      sahip, current_user, sahip;
  end if;

  raise notice 'ON KONTROL OK: yardimci fonksiyonlar var, kapsam disi bucket yok, sahiplik/uyelik yeterli (sahip=%).', sahip;
end
$$;

-- -----------------------------------------------------------------------------
-- 1) Firma uuid çözümleyici (public şeması — sahiplik gerektirmez)
--
--    İki şekli de destekler, ASLA hata fırlatmaz:
--      "<uuid>/..."       -> uuid   (measurement-photos, catalog-images,
--                                    visual-previews, support-attachments)
--      "<uuid>-logo.jpg"  -> uuid   (logos — klasörsüz)
--      çözülemezse        -> NULL   (fail-closed)
-- -----------------------------------------------------------------------------
create or replace function public.storage_path_company_id(object_name text)
returns uuid
language sql
immutable
parallel safe
as $$
  select case
           when substring(split_part(object_name, '/', 1) from 1 for 36) ~*
                '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           then substring(split_part(object_name, '/', 1) from 1 for 36)::uuid
           else null
         end
$$;

comment on function public.storage_path_company_id(text) is
  'Storage nesne adindan firma uuid cikarir. Sekiller: "<uuid>/..." ve "<uuid>-...". Cozulemezse NULL (hata firlatmaz).';

-- -----------------------------------------------------------------------------
-- 2) YOL FORMATI DOĞRULAMASI — çözülemeyen nesne varsa DUR
--    (appointment-photos / catalog-pdfs gibi kodda geçmeyen bucket'ların
--     formatı burada, işlem içinde ve güvenle ortaya çıkar.)
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
  cozulemeyen bigint;
  ornekler text;
  orphan bigint;
begin
  for r in
    select bucket_id, count(*) as toplam,
           count(*) filter (where public.storage_path_company_id(name) is not null) as cozulen,
           count(*) filter (where public.storage_path_company_id(name) is null)     as cozulemeyen
    from storage.objects group by bucket_id order by bucket_id
  loop
    raise notice 'BUCKET % : toplam=%  cozulen=%  COZULEMEYEN=%', r.bucket_id, r.toplam, r.cozulen, r.cozulemeyen;
  end loop;

  select count(*) into cozulemeyen
  from storage.objects where public.storage_path_company_id(name) is null;

  if cozulemeyen > 0 then
    select string_agg(bucket_id || ' :: ' || name, E'\n  ') into ornekler
    from (select bucket_id, name from storage.objects
          where public.storage_path_company_id(name) is null
          order by bucket_id, name limit 15) t;
    raise exception
      E'% nesnenin firma uuid''si cozulemiyor; politikayla ERISILEMEZ olurlardi.\nOrnekler:\n  %\nIslem GERI ALINDI.',
      cozulemeyen, ornekler;
  end if;

  select count(*) into orphan from (
    select distinct public.storage_path_company_id(name) as cid
    from storage.objects where public.storage_path_company_id(name) is not null
  ) u where not exists (select 1 from public.companies c where c.id = u.cid);

  if orphan > 0 then
    raise notice 'BILGI: % firma uuid''si companies tablosunda yok; bu dosyalara yalnizca super admin erisecek.', orphan;
  end if;

  raise notice 'YOL FORMATI OK.';
end
$$;

-- -----------------------------------------------------------------------------
-- 3) Bucket'ları private yap  (storage.buckets UPDATE yetkisi yeter)
-- -----------------------------------------------------------------------------
update storage.buckets
   set public = false
 where id in ('appointment-photos','catalog-images','catalog-pdfs','logos',
              'measurement-photos','support-attachments','visual-previews');

-- =============================================================================
-- Buradan itibarı storage.objects SAHİPLİĞİ ister. Sahibin rolüne geçiyoruz.
-- `set local` olduğu için transaction bitince kendiliğinden geri döner.
-- =============================================================================
set local role supabase_storage_admin;

-- -----------------------------------------------------------------------------
-- 4) Mevcut politikaları kaldır — AD YAZMADAN, katalogdan okuyarak
--    (Tahmini ad yazmak tehlikelidir: adini bilmedigimiz genis bir politika
--     ayakta kalirsa acik KAPANMAZ ama kapandi sanilir.)
-- -----------------------------------------------------------------------------
do $$
declare
  p record;
  sayac int := 0;
begin
  for p in
    select policyname, cmd, roles::text as roles
    from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
    order by policyname
  loop
    raise notice 'DUSURULUYOR: "%"  (cmd=%, roles=%)', p.policyname, p.cmd, p.roles;
    execute format('drop policy if exists %I on storage.objects', p.policyname);
    sayac := sayac + 1;
  end loop;
  raise notice 'Toplam % politika dusuruldu.', sayac;
end
$$;

-- -----------------------------------------------------------------------------
-- 5) Yeni politikalar — firma bazlı
--      anon / public          : erişim YOK (politika tanımlanmadı)
--      authenticated SELECT   : kendi firması + super admin tümü
--                               (SuperAdminSupport başka firmaların destek
--                                eklerini görüntülüyor — gerekli)
--      authenticated I/U/D    : yalnızca kendi firması
--                               (super admin'e yazma/silme verilmedi; toplu
--                                temizlik service_role ile yapılır, o RLS'i
--                                zaten baypas eder)
-- -----------------------------------------------------------------------------
alter table storage.objects enable row level security;

create policy "perdepro_objects_select"
  on storage.objects for select to authenticated
  using (
    bucket_id in ('appointment-photos','catalog-images','catalog-pdfs','logos',
                  'measurement-photos','support-attachments','visual-previews')
    and ( public.is_super_admin()
          or public.storage_path_company_id(name) = any (public.my_company_ids()) )
  );

create policy "perdepro_objects_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('appointment-photos','catalog-images','catalog-pdfs','logos',
                  'measurement-photos','support-attachments','visual-previews')
    and public.storage_path_company_id(name) = any (public.my_company_ids())
  );

create policy "perdepro_objects_update"
  on storage.objects for update to authenticated
  using (
    bucket_id in ('appointment-photos','catalog-images','catalog-pdfs','logos',
                  'measurement-photos','support-attachments','visual-previews')
    and public.storage_path_company_id(name) = any (public.my_company_ids())
  )
  with check (
    bucket_id in ('appointment-photos','catalog-images','catalog-pdfs','logos',
                  'measurement-photos','support-attachments','visual-previews')
    and public.storage_path_company_id(name) = any (public.my_company_ids())
  );

create policy "perdepro_objects_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('appointment-photos','catalog-images','catalog-pdfs','logos',
                  'measurement-photos','support-attachments','visual-previews')
    and public.storage_path_company_id(name) = any (public.my_company_ids())
  );

reset role;

-- -----------------------------------------------------------------------------
-- 6) İŞLEM SONU DOĞRULAMA — biri tutmazsa TÜM migration geri alınır
-- -----------------------------------------------------------------------------
do $$
declare
  hala_public text;
  genis text;
  eksik text;
  bizim int;
begin
  select string_agg(id, ', ') into hala_public
  from storage.buckets
  where id in ('appointment-photos','catalog-images','catalog-pdfs','logos',
               'measurement-photos','support-attachments','visual-previews')
    and public is true;
  if hala_public is not null then
    raise exception 'Su bucket(lar) hala public: %. GERI ALINDI.', hala_public;
  end if;

  select string_agg(policyname || ' [' || cmd || ' -> ' || roles::text || ']', ', ')
    into genis
  from pg_policies
  where schemaname='storage' and tablename='objects'
    and (roles::text ilike '%anon%' or roles::text ~ '\{public\}');
  if genis is not null then
    raise exception 'anon/public role''une acik politika duruyor: %. Acik KAPANMAZDI — GERI ALINDI.', genis;
  end if;

  select count(*) into bizim
  from pg_policies
  where schemaname='storage' and tablename='objects'
    and policyname in ('perdepro_objects_select','perdepro_objects_insert',
                       'perdepro_objects_update','perdepro_objects_delete');
  if bizim <> 4 then
    select string_agg(x, ', ') into eksik
    from unnest(array['perdepro_objects_select','perdepro_objects_insert',
                      'perdepro_objects_update','perdepro_objects_delete']) x
    where x not in (select policyname from pg_policies
                    where schemaname='storage' and tablename='objects');
    raise exception 'Politika(lar) kurulamadi: %. GERI ALINDI.', eksik;
  end if;

  if not (select relrowsecurity from pg_class where oid='storage.objects'::regclass) then
    raise exception 'storage.objects RLS acik degil. GERI ALINDI.';
  end if;

  raise notice 'DOGRULAMA OK: 7 bucket private, anon/public politika yok, 4 politika kurulu, RLS acik.';
end
$$;
