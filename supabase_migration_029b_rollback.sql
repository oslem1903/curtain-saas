-- Migration 029b geri alma: Storage yazma politikalarini abonelik kosulu OLMADAN
-- (supabase_storage_tenant_isolation.sql'deki orijinal haline) dondurur. SELECT'e dokunmaz.
BEGIN;
DROP POLICY IF EXISTS perdepro_objects_insert ON storage.objects;
DROP POLICY IF EXISTS perdepro_objects_update ON storage.objects;
DROP POLICY IF EXISTS perdepro_objects_delete ON storage.objects;

CREATE POLICY perdepro_objects_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id IN ('appointment-photos','catalog-images','catalog-pdfs','logos','measurement-photos','support-attachments','visual-previews')
  AND EXISTS (
    SELECT 1 FROM public.company_members cm
    WHERE cm.user_id = auth.uid() AND COALESCE(cm.is_active, true)
      AND cm.company_id = public.storage_path_company_id(objects.name))
);

CREATE POLICY perdepro_objects_update ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id IN ('appointment-photos','catalog-images','catalog-pdfs','logos','measurement-photos','support-attachments','visual-previews')
  AND EXISTS (
    SELECT 1 FROM public.company_members cm
    WHERE cm.user_id = auth.uid() AND COALESCE(cm.is_active, true)
      AND cm.company_id = public.storage_path_company_id(objects.name))
)
WITH CHECK (
  bucket_id IN ('appointment-photos','catalog-images','catalog-pdfs','logos','measurement-photos','support-attachments','visual-previews')
  AND EXISTS (
    SELECT 1 FROM public.company_members cm
    WHERE cm.user_id = auth.uid() AND COALESCE(cm.is_active, true)
      AND cm.company_id = public.storage_path_company_id(objects.name))
);

CREATE POLICY perdepro_objects_delete ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id IN ('appointment-photos','catalog-images','catalog-pdfs','logos','measurement-photos','support-attachments','visual-previews')
  AND EXISTS (
    SELECT 1 FROM public.company_members cm
    WHERE cm.user_id = auth.uid() AND COALESCE(cm.is_active, true)
      AND cm.company_id = public.storage_path_company_id(objects.name))
);
COMMIT;
