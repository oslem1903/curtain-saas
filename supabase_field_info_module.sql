-- ============================================================================
-- SAHA BİLGİLERİ (Field Info) — Storage + şema (Production Safe, additive)
-- ============================================================================
-- PerdePRO profesyonel saha kayıt sistemi: kartela kodu, kartela fotoğrafı,
-- çoklu mekan fotoğrafı, sesli not, montaj notu, işaretli foto (annotation).
--
-- Saklama:
--   • Tüm dosyalar (foto + ses) mevcut PUBLIC 'measurement-photos' bucket'ında.
--   • Sipariş kalemi: order_items.product_options.field_info (jsonb) → EK KOLON YOK,
--     insert akışı bozulmaz, geriye dönük uyumlu.
--   • Ölçü: appointments.field_info (jsonb) opsiyonel kolon (rich/core fallback'la
--     uyumlu; kolon yoksa kayıt yine çalışır).
--
-- Idempotent + additive. Hiçbir tablo/kolon/satır SİLİNMEZ. Veri kaybı yok.
-- ============================================================================

-- 1) Storage bucket: 'measurement-photos' var ve PUBLIC olsun (yoksa oluştur).
INSERT INTO storage.buckets (id, name, public)
VALUES ('measurement-photos', 'measurement-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 2) Storage policy'leri (yalnızca KENDİ adlı policy'lerimizi yönetir; idempotent).
DROP POLICY IF EXISTS "measurement_photos_public_read" ON storage.objects;
CREATE POLICY "measurement_photos_public_read" ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'measurement-photos');

DROP POLICY IF EXISTS "measurement_photos_auth_insert" ON storage.objects;
CREATE POLICY "measurement_photos_auth_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'measurement-photos');

-- 3) Ölçü (appointments) saha bilgisi kolonu (additive, opsiyonel jsonb).
ALTER TABLE IF EXISTS public.appointments
  ADD COLUMN IF NOT EXISTS field_info jsonb;

COMMENT ON COLUMN public.appointments.field_info IS
'Saha bilgileri (jsonb): swatch_code, swatch_photo_url, room_photos[], voice_note_url, install_note. Opsiyonel; measurement-photos bucket public URLleri.';

-- 4) PostgREST şema cache yenileme
NOTIFY pgrst, 'reload schema';
