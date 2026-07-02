-- ============================================================
-- PERDEPRO - Vadeli Ödeme Sistemi Migration
-- Bu dosyayı Supabase SQL Editor'da çalıştırın.
-- ============================================================

-- 1. orders: müşteri tahsilat vade tarihi
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_due_date DATE;

-- 2. supplier_transactions: tedarikçi borç vade tarihi
ALTER TABLE supplier_transactions ADD COLUMN IF NOT EXISTS due_date DATE;

-- 3. Logo storage bucket + politikaları (logo yükleme için)
INSERT INTO storage.buckets (id, name, public)
VALUES ('logos', 'logos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "logos_public_read" ON storage.objects;
CREATE POLICY "logos_public_read" ON storage.objects
    FOR SELECT USING (bucket_id = 'logos');

DROP POLICY IF EXISTS "logos_auth_insert" ON storage.objects;
CREATE POLICY "logos_auth_insert" ON storage.objects
    FOR INSERT TO authenticated WITH CHECK (bucket_id = 'logos');

DROP POLICY IF EXISTS "logos_auth_update" ON storage.objects;
CREATE POLICY "logos_auth_update" ON storage.objects
    FOR UPDATE TO authenticated USING (bucket_id = 'logos');

DROP POLICY IF EXISTS "logos_auth_delete" ON storage.objects;
CREATE POLICY "logos_auth_delete" ON storage.objects
    FOR DELETE TO authenticated USING (bucket_id = 'logos');

-- 4. Schema cache yenile
NOTIFY pgrst, 'reload schema';
