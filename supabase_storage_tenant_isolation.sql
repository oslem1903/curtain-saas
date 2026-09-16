-- =============================================================================
-- PerdePRO — Storage (fotoğraf/görsel/ek dosya) firma izolasyonu
--
-- !!! HENÜZ ÇALIŞTIRILMADI. Aşağıdaki "ÖNCE OKU"yu okumadan çalıştırmayın. !!!
--
-- =============================================================================
-- TESPİT (14.09.2026, CANLI üretim projesi ffhmzlcsgsgjonqqhgqq)
-- =============================================================================
-- 1) Bucket'lar public. Oturum/anahtar OLMADAN dosya indirilebiliyor:
--       GET /storage/v1/object/public/measurement-photos/<yol>  -> HTTP 200
--       (2.104.652 baytlık PNG indirildi)
--
-- 2) Uygulamanın anon anahtarıyla (her kurulumun içinde gömülü, yani herkeste
--    var) bucket İÇERİĞİ listelenebiliyor:
--       POST /storage/v1/object/list/measurement-photos -> HTTP 200
--       İlk seviye klasörler = FİRMA UUID'leri:
--         24657cb3-…, 3f3bd700-…, 875f1103-…, 9e985a1f-…, a8c3b542-…
--    Yani bir firma diğerlerinin ölçü fotoğraflarını keşfedip indirebiliyor.
--
-- 3) storage.objects üzerinde RLS ZATEN AÇIK (enabled=true, forced=false).
--    Demek ki açık, RLS'in kapalı olmasından değil, POLİTİKALARIN GENİŞ
--    olmasından kaynaklanıyor. Bu yüzden bu betik politikaları yeniden kurar.
--
-- 4) TABLO tarafındaki RLS DOĞRU çalışıyor: anon rolle orders / customers /
--    payments / suppliers / supplier_transactions / installer_transactions /
--    installer_earnings / order_items / appointments / notifications /
--    profiles / company_members / companies / catalog_code_photos /
--    order_installments sorgularının hepsi 0 satır döndü. Sorun yalnızca
--    storage.objects tarafında.
--
-- =============================================================================
-- ADLANDIRMA — koddan doğrulanan şekiller
-- =============================================================================
--   measurement-photos   "<firma_uuid>/<...>"                (klasörlü)
--                        src/utils/fieldInfo.ts, src/pages/OrderDetail.tsx
--   catalog-images       "<firma_uuid>/<...>"                src/pages/CatalogManagement.tsx
--   visual-previews      "<firma_uuid>/<...>"                src/pages/VisualPreviews.tsx
--   support-attachments  "<firma_uuid>/<ticket_id>/screenshot.<ext>"
--                        src/components/SupportModal.tsx
--   logos                "<firma_uuid>-logo.<ext>"           << DÜZ, KLASÖR YOK >>
--                        src/components/CompanySettingsCard.tsx
--                        `${settings?.id}-logo.${fileExt}`
--
--   appointment-photos   ??? KODDA HİÇ GEÇMİYOR (eski bucket)
--   catalog-pdfs         ??? KODDA HİÇ GEÇMİYOR (eski bucket)
--
-- Bu iki eski bucket'ın yol formatı BİLİNMİYOR ve TAHMİN EDİLMEDİ. Bunun yerine
-- betik, 2. ADIM'da tüm nesneleri tarayıp firma uuid'si çözülemeyen varsa
-- ÖRNEKLERİYLE BİRLİKTE HATA VERİP GERİ ALIR. Yani format analizi burada,
-- işlem içinde ve güvenli biçimde yapılır — kör bir varsayımla değil.
--
-- =============================================================================
-- ÖNCE OKU — UYGULAMA SIRASI
-- =============================================================================
-- Uygulama kodu görselleri artık kısa ömürlü imzalı adreslerle gösteriyor
-- (src/utils/storageUrl.ts + SecureImage/SecureLink). İmzalı adresler public
-- bucket'ta da çalışır; bu yüzden KOD TEK BAŞINA yayınlanabilir.
--
--   1. ADIM  Yeni uygulama sürümünü yayınla.
--   2. ADIM  Kullanıcıların güncellediğini doğrula.
--   3. ADIM  BU BETİĞİ çalıştır.
--
-- Sıra bozulursa ESKİ sürümdeki kullanıcılarda fotoğraflar kırık görünür
-- (yeni kayıt/yükleme çalışmaya devam eder). Geri alma: en alttaki ROLLBACK.
--
-- VERİ TAŞIMA GEREKMEZ: DB'deki mevcut public URL değerleri olduğu gibi kalır;
-- kod bunlardan nesne yolunu çıkarıp imzalar.
--
-- =============================================================================
-- DROP POLICY HAKKINDA — neden tek bir politika adı yazılmadı
-- =============================================================================
-- Politika adlarını TAHMİN ETMEK tehlikelidir: adını bilmediğimiz geniş bir
-- politika ayakta kalırsa bucket'ı private yapmak açığı KAPATMAZ, ama kapandı
-- sanılır. Bu yüzden bu betik hiçbir ada bağlı DEĞİL: pg_policies katalogunu
-- okuyup storage.objects üzerindeki KENDİ politikalarımız DIŞINDAKİ her
-- politikayı düşürür ve düşürdüğü her birini RAISE NOTICE ile adıyla yazar.
-- Böylece hem uydurma ad yok, hem de hiçbir politika gözden kaçmıyor.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 0) ÖN KONTROL — bağımlılıklar ve kapsam
-- -----------------------------------------------------------------------------
do $$
declare
  kapsam text[] := array[
    'appointment-photos', 'catalog-images', 'catalog-pdfs', 'logos',
    'measurement-photos', 'support-attachments', 'visual-previews'
  ];
  kapsam_disi text;
begin
  -- 0a) Politikaların dayandığı yardımcı fonksiyonlar var mı?
  if to_regprocedure('public.my_company_ids()') is null then
    raise exception
      'public.my_company_ids() bulunamadi. Politikalar buna dayaniyor; once o fonksiyonu kuran migration calistirilmali.';
  end if;
  if to_regprocedure('public.is_super_admin()') is null then
    raise exception
      'public.is_super_admin() bulunamadi. Politikalar buna dayaniyor; once o fonksiyonu kuran migration calistirilmali.';
  end if;

  -- 0b) Kapsam disinda bucket var mi? (Varsa bu betik onu korumasiz birakirdi.)
  select string_agg(id, ', ') into kapsam_disi
  from storage.buckets
  where id <> all (kapsam);

  if kapsam_disi is not null then
    raise exception
      'Kapsam disinda bucket(lar) var: %. Bu betik yalnizca su 7 bucketi kapsiyor: %. Once kapsami guncelleyin — aksi halde o bucket(lar) politikasiz kalir.',
      kapsam_disi, array_to_string(kapsam, ', ');
  end if;

  raise notice 'ON KONTROL OK: yardimci fonksiyonlar mevcut, kapsam disi bucket yok.';
end
$$;

-- -----------------------------------------------------------------------------
-- 1) Firma uuid çözümleyici
--
--    İKİ şekli de destekler ve ASLA hata fırlatmaz:
--      "<uuid>/..."      -> uuid        (measurement-photos, catalog-images,
--                                        visual-previews, support-attachments)
--      "<uuid>-logo.jpg" -> uuid        (logos — klasörsüz)
--      çözülemezse       -> NULL        (fail-closed)
--
--    DİKKAT: ilk segmenti doğrudan ::uuid'e çevirmek YANLIŞTIR.
--    "a8c3b542-7cb7-4b93-a073-b7340f5313d7-logo.jpg" cast edilemez ve RLS
--    ifadesi içinde HATA FIRLATIR — o an storage.objects'e dokunan her sorgu
--    patlar (logolar görünmez, yükleme bozulur). Bu yüzden önce regex.
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
  'Storage nesne adindan firma uuid cikarir. Destekledigi sekiller: "<uuid>/..." ve "<uuid>-...". Cozulemezse NULL doner (hata firlatmaz).';

-- -----------------------------------------------------------------------------
-- 2) YOL FORMATI DOĞRULAMASI — eski bucket'lar dahil
--
--    Politika, firma uuid'si çözülemeyen nesneyi normal kullanıcıya GÖRÜNMEZ
--    yapar. Bu yüzden çözülemeyen nesne varsa devam ETMİYORUZ: örnekleriyle
--    birlikte hata verip geri alıyoruz. appointment-photos / catalog-pdfs gibi
--    kodda geçmeyen bucket'ların formatı burada ortaya çıkar.
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
  cozulemeyen bigint;
  ornekler text;
  orphan bigint;
begin
  -- Bucket bazinda dagilimi rapora yaz
  for r in
    select bucket_id,
           count(*) as toplam,
           count(*) filter (where public.storage_path_company_id(name) is not null) as cozulen,
           count(*) filter (where public.storage_path_company_id(name) is null)     as cozulemeyen
    from storage.objects
    group by bucket_id
    order by bucket_id
  loop
    raise notice 'BUCKET % : toplam=%  cozulen=%  COZULEMEYEN=%',
      r.bucket_id, r.toplam, r.cozulen, r.cozulemeyen;
  end loop;

  select count(*) into cozulemeyen
  from storage.objects
  where public.storage_path_company_id(name) is null;

  if cozulemeyen > 0 then
    select string_agg(bucket_id || ' :: ' || name, E'\n  ')
      into ornekler
    from (
      select bucket_id, name
      from storage.objects
      where public.storage_path_company_id(name) is null
      order by bucket_id, name
      limit 15
    ) t;

    raise exception
      E'% nesnenin firma uuid''si yolundan cozulemiyor; bu nesneler politikayla ERISILEMEZ olurdu.\nIlk ornekler:\n  %\nYapilacak: ya bu dosyalar "<firma_uuid>/..." bicimine tasinacak, ya da bu bucket icin ayri bir kural yazilacak. Islem GERI ALINDI.',
      cozulemeyen, ornekler;
  end if;

  -- Cozulen ama companies'te karsiligi olmayan uuid'ler: normal kullaniciya
  -- gorunmez olur, super admin yine erisir. Engelleyici degil, bilgilendirici.
  select count(*) into orphan
  from (
    select distinct public.storage_path_company_id(name) as cid
    from storage.objects
    where public.storage_path_company_id(name) is not null
  ) u
  where not exists (select 1 from public.companies c where c.id = u.cid);

  if orphan > 0 then
    raise notice
      'BILGI: % adet firma uuid''si companies tablosunda yok (silinmis firma olabilir). Bu dosyalara yalnizca super admin erisebilecek.',
      orphan;
  end if;

  raise notice 'YOL FORMATI OK: tum nesnelerin firma uuid''si cozuldu.';
end
$$;

-- -----------------------------------------------------------------------------
-- 3) Bucket'ları private yap
-- -----------------------------------------------------------------------------
update storage.buckets
   set public = false
 where id in (
   'appointment-photos', 'catalog-images', 'catalog-pdfs', 'logos',
   'measurement-photos', 'support-attachments', 'visual-previews'
 );

-- -----------------------------------------------------------------------------
-- 4) Mevcut politikaları kaldır — AD YAZMADAN, katalogdan okuyarak
--
--    Kendi politikalarımız dışındaki her storage.objects politikası düşürülür.
--    Düşürülen her politika adıyla NOTICE'a yazılır (denetim izi).
-- -----------------------------------------------------------------------------
do $$
declare
  p record;
  sayac int := 0;
begin
  for p in
    select policyname, cmd, roles::text as roles
    from pg_policies
    where schemaname = 'storage'
      and tablename  = 'objects'
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
-- 5) Yeni politikalar — firma bazlı, yalnızca oturum açmış kullanıcılar
--
--    Erişim modeli:
--      anon / public            : HİÇBİR erişim yok (politika tanımlanmadı)
--      authenticated (SELECT)   : kendi firmasının dosyaları
--                                 + super admin TÜM dosyaları okuyabilir
--                                   (SuperAdminSupport.tsx başka firmaların
--                                    destek eklerini görüntülüyor — gerekli)
--      authenticated (I/U/D)    : YALNIZCA kendi firmasının dosyaları.
--                                 Super admin'e yazma/silme ayrıcalığı VERİLMEDİ
--                                 ("kontrollü"): firma silme gibi toplu temizlik
--                                 sunucu tarafında service_role ile yapılır ve
--                                 service_role RLS'i zaten baypas eder.
--
--    NOT (15.09.2026, deneme sonrası eklendi): "ALTER TABLE ... ENABLE ROW
--    LEVEL SECURITY" satırı BİLİNÇLİ OLARAK KALDIRILDI — bu komut tablonun
--    GERÇEK SAHİBİNİ (Supabase'de storage.objects'in sahibi supabase_storage_admin'dir,
--    SQL Editor'daki postgres rolü değil) gerektiriyor ve "must be owner of
--    table objects" (42501) hatasıyla TÜM transaction'ı geri alıyordu. Bu satır
--    zaten GEREKSİZDİ: dosyanın en başındaki CANLI tespit RLS'in bu tabloda
--    ZATEN AÇIK olduğunu doğrulamıştı (enabled=true) — yani hiçbir koruma bu
--    satıra bağlı değildi, yalnızca var olan durumu tekrar istiyordu.
--    CREATE POLICY / DROP POLICY satırlarına DOKUNULMADI — bunlar Supabase'in
--    SQL Editor için belgelenmiş/izin verilen işlemler, sahiplik gerektirmiyor.
--
--    NOT 2 (15.09.2026, ikinci deneme sonrası eklendi): "public.storage_path_
--    company_id(name) = any (public.my_company_ids())" ifadesi KALDIRILDI.
--    my_company_ids() bir SET-RETURNING fonksiyon (RETURNS SETOF uuid) —
--    Postgres, policy ifadelerinin İÇİNDE hiçbir set-returning fonksiyona izin
--    vermiyor ("set-returning functions are not allowed in policy expressions",
--    0A000), ANY(...) ile sarmalansa bile. Aynı kontrol, my_company_ids()'in
--    KENDİ gövdesindeki sorguyu (company_members'ta user_id=auth.uid() VE
--    is_active) doğrudan bir EXISTS alt sorgusuna açarak yeniden yazıldı —
--    my_company_ids()'e artık hiç bağımlı değil, mantık BİREBİR AYNI.
-- -----------------------------------------------------------------------------

create policy "perdepro_objects_select"
  on storage.objects for select
  to authenticated
  using (
    bucket_id in (
      'appointment-photos', 'catalog-images', 'catalog-pdfs', 'logos',
      'measurement-photos', 'support-attachments', 'visual-previews'
    )
    and (
      public.is_super_admin()
      or exists (
        select 1 from public.company_members cm
        where cm.user_id = auth.uid()
          and coalesce(cm.is_active, true)
          and cm.company_id = public.storage_path_company_id(name)
      )
    )
  );

create policy "perdepro_objects_insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id in (
      'appointment-photos', 'catalog-images', 'catalog-pdfs', 'logos',
      'measurement-photos', 'support-attachments', 'visual-previews'
    )
    and exists (
      select 1 from public.company_members cm
      where cm.user_id = auth.uid()
        and coalesce(cm.is_active, true)
        and cm.company_id = public.storage_path_company_id(name)
    )
  );

create policy "perdepro_objects_update"
  on storage.objects for update
  to authenticated
  using (
    bucket_id in (
      'appointment-photos', 'catalog-images', 'catalog-pdfs', 'logos',
      'measurement-photos', 'support-attachments', 'visual-previews'
    )
    and exists (
      select 1 from public.company_members cm
      where cm.user_id = auth.uid()
        and coalesce(cm.is_active, true)
        and cm.company_id = public.storage_path_company_id(name)
    )
  )
  with check (
    bucket_id in (
      'appointment-photos', 'catalog-images', 'catalog-pdfs', 'logos',
      'measurement-photos', 'support-attachments', 'visual-previews'
    )
    and exists (
      select 1 from public.company_members cm
      where cm.user_id = auth.uid()
        and coalesce(cm.is_active, true)
        and cm.company_id = public.storage_path_company_id(name)
    )
  );

create policy "perdepro_objects_delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id in (
      'appointment-photos', 'catalog-images', 'catalog-pdfs', 'logos',
      'measurement-photos', 'support-attachments', 'visual-previews'
    )
    and exists (
      select 1 from public.company_members cm
      where cm.user_id = auth.uid()
        and coalesce(cm.is_active, true)
        and cm.company_id = public.storage_path_company_id(name)
    )
  );

-- -----------------------------------------------------------------------------
-- 6) İŞLEM SONU DOĞRULAMA — biri bile tutmazsa TÜM İŞLEM GERİ ALINIR
-- -----------------------------------------------------------------------------
do $$
declare
  hala_public text;
  genis text;
  eksik text;
  bizim int;
begin
  -- 6a) 7 bucket da private mi?
  select string_agg(id, ', ') into hala_public
  from storage.buckets
  where id in (
    'appointment-photos', 'catalog-images', 'catalog-pdfs', 'logos',
    'measurement-photos', 'support-attachments', 'visual-previews'
  ) and public is true;

  if hala_public is not null then
    raise exception 'Su bucket(lar) hala public: %. Islem GERI ALINDI.', hala_public;
  end if;

  -- 6b) anon/public role'une acik politika kalmis mi?
  select string_agg(policyname || ' [' || cmd || ' -> ' || roles::text || ']', ', ')
    into genis
  from pg_policies
  where schemaname = 'storage'
    and tablename  = 'objects'
    and (roles::text ilike '%anon%' or roles::text ~ '\{public\}');

  if genis is not null then
    raise exception
      'anon/public role''une acik politika hala duruyor: %. Acik KAPANMAZDI — islem GERI ALINDI.', genis;
  end if;

  -- 6c) Dort politikamiz da kuruldu mu?
  select count(*) into bizim
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and policyname in ('perdepro_objects_select','perdepro_objects_insert',
                       'perdepro_objects_update','perdepro_objects_delete');

  if bizim <> 4 then
    select string_agg(x, ', ') into eksik
    from unnest(array['perdepro_objects_select','perdepro_objects_insert',
                      'perdepro_objects_update','perdepro_objects_delete']) x
    where x not in (select policyname from pg_policies
                    where schemaname='storage' and tablename='objects');
    raise exception 'Politika(lar) kurulamadi: %. Islem GERI ALINDI.', eksik;
  end if;

  -- 6d) RLS acik mi?
  if not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then
    raise exception 'storage.objects uzerinde RLS acik degil. Islem GERI ALINDI.';
  end if;

  raise notice 'ISLEM SONU DOGRULAMA OK: 7 bucket private, anon/public politika yok, 4 politika kurulu, RLS acik.';
end
$$;

commit;

-- =============================================================================
-- COMMIT SONRASI DIŞ DOĞRULAMA (uygulamadan bağımsız — tarayıcı konsolu)
-- =============================================================================
-- Beklenen: listeleme artık 0 kayıt, public indirme 400/404.
--
--   const ANON = '<anon key>';
--   await fetch('/storage/v1/object/list/measurement-photos', {
--     method:'POST',
--     headers:{ apikey:ANON, Authorization:'Bearer '+ANON, 'Content-Type':'application/json' },
--     body: JSON.stringify({ prefix:'', limit:5 })
--   }).then(r => r.json());        // -> []      (onceden 5 firma klasoru)
--
--   await fetch('/storage/v1/object/public/measurement-photos/<yol>')
--     .then(r => r.status);        // -> 400/404 (onceden 200)
--
-- =============================================================================
-- ROLLBACK — YALNIZCA ACİL DURUM. Açığı GERİ AÇAR.
-- =============================================================================
-- begin;
--   drop policy if exists "perdepro_objects_select" on storage.objects;
--   drop policy if exists "perdepro_objects_insert" on storage.objects;
--   drop policy if exists "perdepro_objects_update" on storage.objects;
--   drop policy if exists "perdepro_objects_delete" on storage.objects;
--   update storage.buckets set public = true
--    where id in ('appointment-photos','catalog-images','catalog-pdfs','logos',
--                 'measurement-photos','support-attachments','visual-previews');
--   -- NOT: Bu, eski politikalari GERI GETIRMEZ. 4. ADIM'daki NOTICE ciktisini
--   -- saklayin; eski politikalari yeniden kurmak gerekirse oradan okunur.
-- commit;
