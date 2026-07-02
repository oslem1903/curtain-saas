-- ============================================================
-- BU DOSYA KULLANIMI BIRAKILDI — supabase_phone_unique_v2.sql KULLANIN
-- ============================================================
-- Migration: Müşteri telefon numarası benzersizliği (v1 — DEPRECATED)
-- Tarih: 2026-06-10
-- Açıklama:
--   1. Telefon normalizasyon fonksiyonu oluşturur.
--   2. customers tablosuna computed normalized_phone kolonu ekler.
--   3. (company_id, normalized_phone) üzerinde partial unique index ekler.
--   4. Mevcut kayıtlardaki çakışmalar etkilenmez (index sadece yeni kayıtları engeller).
-- Güvenli: Birden fazla çalıştırılabilir (IF NOT EXISTS / OR REPLACE).
-- ============================================================

-- 1. Normalizasyon fonksiyonu
-- Tüm rakam dışı karakterleri temizler, baştaki 0'ı 90 ile değiştirir.
CREATE OR REPLACE FUNCTION public.normalize_phone(p text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
RETURNS NULL ON NULL INPUT
AS $$
DECLARE
  digits text;
BEGIN
  digits := regexp_replace(p, '[^0-9]', '', 'g');
  IF digits = '' THEN
    RETURN NULL;
  END IF;
  -- +90 veya 90 ile başlayıp 12 hane
  IF digits ~ '^90' AND length(digits) = 12 THEN
    RETURN digits;
  END IF;
  -- 0 ile başlayıp 11 hane (Türk yerel format)
  IF digits ~ '^0' AND length(digits) = 11 THEN
    RETURN '9' || digits;
  END IF;
  -- 10 hane (alan kodsuz)
  IF length(digits) = 10 THEN
    RETURN '90' || digits;
  END IF;
  -- Tanımlanamayan format — aynen döndür (constraint tetiklenirse kullanıcıya mesaj gider)
  RETURN digits;
END;
$$;

-- 2. customers tablosuna normalized_phone generated kolonu ekle
-- GENERATED ALWAYS AS STORED: veri değişince otomatik güncellenir
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customers'
      AND column_name = 'normalized_phone'
  ) THEN
    ALTER TABLE public.customers
      ADD COLUMN normalized_phone text
        GENERATED ALWAYS AS (public.normalize_phone(phone)) STORED;
  END IF;
END;
$$;

-- 3. Partial unique index: aynı şirkette aynı normalize edilmiş telefon olamaz.
--    NULL telefon olan kayıtlar index dışında — sınırsız null kabul edilir.
--    Mevcut çakışan kayıtlar index oluşturmayı engeller; temizleme scripti aşağıda.
CREATE UNIQUE INDEX IF NOT EXISTS customers_company_phone_unique
  ON public.customers (company_id, normalized_phone)
  WHERE normalized_phone IS NOT NULL;

-- ============================================================
-- UYARI: Mevcut veride çakışan telefon numarası varsa yukarıdaki
-- index oluşturmaz ve şu hatayı verir:
--   ERROR: could not create unique index "customers_company_phone_unique"
--   DETAIL: Key (company_id, normalized_phone)=(...) is duplicated.
--
-- Bu durumda önce aşağıdaki sorguyu çalıştırarak çakışmaları listeleyin:
-- ============================================================

/*
SELECT
  company_id,
  public.normalize_phone(phone) AS norm_phone,
  COUNT(*) AS cnt,
  array_agg(id ORDER BY created_at) AS ids,
  array_agg(name ORDER BY created_at) AS names
FROM public.customers
WHERE phone IS NOT NULL
  AND public.normalize_phone(phone) IS NOT NULL
GROUP BY company_id, public.normalize_phone(phone)
HAVING COUNT(*) > 1
ORDER BY cnt DESC;
*/

-- Çakışmaları çözmek için (en eski kaydı tutar, diğerlerini siler):
-- DİKKAT: Bu sorgu veri siler. Önce yedek alın!
/*
DELETE FROM public.customers
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY company_id, public.normalize_phone(phone)
        ORDER BY created_at ASC
      ) AS rn
    FROM public.customers
    WHERE phone IS NOT NULL
      AND public.normalize_phone(phone) IS NOT NULL
  ) ranked
  WHERE rn > 1
);
*/
