-- ============================================================
-- PERDEPRO - Destek Sistemi Faz 1 (tamamen ADDITIVE)
-- Mevcut support_tickets tablosuna ve policy'lerine DOKUNMAZ.
-- Yalnızca: support_metadata kolonu + private storage bucket ekler.
-- Tek seferde çalışır, idempotent.
-- ============================================================

-- 1. Otomatik teknik bilgiler için JSON kolonu (additive)
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS support_metadata JSONB;

-- 2. Private storage bucket: support-attachments
INSERT INTO storage.buckets (id, name, public)
VALUES ('support-attachments', 'support-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- 3. Storage policy'leri
-- Kullanıcı kendi firmasının klasörüne yükleyebilir (yol: company_id/ticket_id/dosya)
DROP POLICY IF EXISTS "support_attachments_insert" ON storage.objects;
CREATE POLICY "support_attachments_insert" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'support-attachments'
        AND (
            public.is_super_admin()
            OR (storage.foldername(name))[1] IN (SELECT public.my_company_ids()::text)
        )
    );

-- Okuma: super admin tümünü, kullanıcı kendi firmasının dosyalarını
-- (private bucket — erişim signed URL ile yapılır, bu policy signed URL üretimini de kapsar)
DROP POLICY IF EXISTS "support_attachments_select" ON storage.objects;
CREATE POLICY "support_attachments_select" ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'support-attachments'
        AND (
            public.is_super_admin()
            OR (storage.foldername(name))[1] IN (SELECT public.my_company_ids()::text)
        )
    );

NOTIFY pgrst, 'reload schema';

-- SONUC
SELECT 'SONUC: kolon + bucket hazir' AS check_name,
       EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'support_tickets' AND column_name = 'support_metadata')
       AND EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'support-attachments') AS ok;
