-- =========================================================================================
-- CURTAIN SAAS: LOGO MANAGEMENT SCHEMA
-- =========================================================================================

-- 1. COMPANIES TABLOSUNA LOGO KOLONU EKLEME
-- Şirketlerin kendi logolarını saklaması için URL kolonu.
ALTER TABLE public.companies
ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- 2. LOGO STORAGE BUCKET OLUŞTURMA VE POLİTİKALAR
-- Not: Storage bucket oluşturma işlemi SQL ile her zaman mümkün olmayabilir (Supabase API gerektirir),
-- ancak politikalar SQL ile yönetilebilir.

-- (Opsiyonel) Eğer bucket SQL ile oluşturulabiliyorsa:
-- INSERT INTO storage.buckets (id, name, public) VALUES ('logos', 'logos', true) ON CONFLICT (id) DO NOTHING;

-- Storage politikaları: Herkes okuyabilir (Public), Sadece Adminler yükleyebilir/silebilir.
-- Not: Bu politikalar 'storage.objects' tablosu üzerindedir.

-- Herkes logoları görebilsin
CREATE POLICY "Public Logo Access"
ON storage.objects FOR SELECT
USING ( bucket_id = 'logos' );

-- Sadece giriş yapmış kullanıcılar (veya adminler) kendi logosunu yükleyebilsin
-- Basitleştirmek adına: Giriş yapmış herkes 'logos' klasörüne yükleme yapabilsin, 
-- frontend'de sadece adminlere bu seçeneği sunacağız.
CREATE POLICY "Authenticated Logo Upload"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK ( bucket_id = 'logos' );

CREATE POLICY "Authenticated Logo Update"
ON storage.objects FOR UPDATE
TO authenticated
USING ( bucket_id = 'logos' );

CREATE POLICY "Authenticated Logo Delete"
ON storage.objects FOR DELETE
TO authenticated
USING ( bucket_id = 'logos' );
