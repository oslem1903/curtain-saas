-- =============================================================================
-- Migration 029b (TASLAK — UYGULANMADI): suresi bitmis firma icin Storage YAZMA korumasi.
--
-- Gerekce: 024/025 yazma korumasi yalnizca PUBLIC tablolardaki tetikleyicilerdir; storage.objects
-- politikalari (supabase_storage_tenant_isolation.sql) abonelik durumuna BAKMAZ. Urun karari:
-- sure bitince yeni kayit/duzenleme/silme sunucuda engellenir -> dosya yukleme/degistirme/silme de.
-- SELECT'e (goruntuleme, imzali adres) DOKUNULMAZ. FORCE RLS eklenmez.
--
-- UYGULAMA KOSULU: once scripts/verify-subscription-gate.mjs suresi bitmis QA firmasinda Storage
-- yazmasinin GERCEKTEN engellenmedigini (acigi) kanitlamali. Kanitlanmadiysa uygulanmaz.
--
-- KAPSAM: 6 bucket. 'support-attachments' BILEREK disarida: 024 destek talebini sure bitince de
-- acik birakir (musteri destege ulasabilmeli).
-- GERI ALMA: supabase_migration_029b_rollback.sql
-- =============================================================================
BEGIN;

DO $pre$
BEGIN
  IF to_regprocedure('public.company_subscription_allows_write(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: company_subscription_allows_write(uuid) yok (migration 024).';
  END IF;
  IF to_regprocedure('public.storage_path_company_id(text)') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: storage_path_company_id(text) yok (storage izolasyonu).';
  END IF;
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
        AND policyname IN ('perdepro_objects_insert','perdepro_objects_update','perdepro_objects_delete')) <> 3 THEN
    RAISE EXCEPTION 'PREFLIGHT: beklenen 3 yazma politikasi (perdepro_objects_insert/update/delete) bulunamadi.';
  END IF;
END
$pre$;

DROP POLICY perdepro_objects_insert ON storage.objects;
DROP POLICY perdepro_objects_update ON storage.objects;
DROP POLICY perdepro_objects_delete ON storage.objects;

CREATE POLICY perdepro_objects_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id IN ('appointment-photos','catalog-images','catalog-pdfs','logos','measurement-photos','support-attachments','visual-previews')
  AND EXISTS (
    SELECT 1 FROM public.company_members cm
    WHERE cm.user_id = auth.uid() AND COALESCE(cm.is_active, true)
      AND cm.company_id = public.storage_path_company_id(objects.name))
  AND (bucket_id = 'support-attachments'
       OR public.company_subscription_allows_write(public.storage_path_company_id(objects.name)))
);

CREATE POLICY perdepro_objects_update ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id IN ('appointment-photos','catalog-images','catalog-pdfs','logos','measurement-photos','support-attachments','visual-previews')
  AND EXISTS (
    SELECT 1 FROM public.company_members cm
    WHERE cm.user_id = auth.uid() AND COALESCE(cm.is_active, true)
      AND cm.company_id = public.storage_path_company_id(objects.name))
  AND (bucket_id = 'support-attachments'
       OR public.company_subscription_allows_write(public.storage_path_company_id(objects.name)))
)
WITH CHECK (
  bucket_id IN ('appointment-photos','catalog-images','catalog-pdfs','logos','measurement-photos','support-attachments','visual-previews')
  AND EXISTS (
    SELECT 1 FROM public.company_members cm
    WHERE cm.user_id = auth.uid() AND COALESCE(cm.is_active, true)
      AND cm.company_id = public.storage_path_company_id(objects.name))
  AND (bucket_id = 'support-attachments'
       OR public.company_subscription_allows_write(public.storage_path_company_id(objects.name)))
);

CREATE POLICY perdepro_objects_delete ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id IN ('appointment-photos','catalog-images','catalog-pdfs','logos','measurement-photos','support-attachments','visual-previews')
  AND EXISTS (
    SELECT 1 FROM public.company_members cm
    WHERE cm.user_id = auth.uid() AND COALESCE(cm.is_active, true)
      AND cm.company_id = public.storage_path_company_id(objects.name))
  AND (bucket_id = 'support-attachments'
       OR public.company_subscription_allows_write(public.storage_path_company_id(objects.name)))
);

DO $post$
BEGIN
  IF (SELECT count(*) FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
        AND policyname LIKE 'perdepro_objects_%') <> 4 THEN
    RAISE EXCEPTION 'POSTCHECK: 4 perdepro_objects_* politikasi beklenirdi. Islem GERI ALINDI.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
               AND policyname='perdepro_objects_select'
               AND qual ILIKE '%company_subscription%') THEN
    RAISE EXCEPTION 'POSTCHECK: SELECT politikasi abonelige baglanmamali. Islem GERI ALINDI.';
  END IF;
END
$post$;
COMMIT;
