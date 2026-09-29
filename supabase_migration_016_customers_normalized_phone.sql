-- ============================================================================
-- Migration 016: customers.normalized_phone (SADECE güvenli kısım)
-- Hedef proje: perdepro (ffhmzlcsgsgjonqqhgqq) — PRODUCTION
--
-- supabase_phone_unique_v2.sql'in yalnızca ADIM 1'i: normalize_phone fonksiyonu,
-- GENERATED normalized_phone kolonu ve normal (unique OLMAYAN) indeks.
-- Veri silmez/değiştirmez. UNIQUE indeks BİLİNÇLİ OLARAK eklenmez: canlı veride
-- aynı telefonla birden fazla müşteri olabilir; duplicate kontrolü istemcide
-- (phoneUtils.findDuplicatePhone) hızlı yoldan yapılır.
-- Idempotent: birden fazla çalıştırılabilir.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.normalize_phone(p text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
RETURNS NULL ON NULL INPUT
SET search_path = public
AS $$
DECLARE
  digits text;
BEGIN
  digits := regexp_replace(p, '[^0-9]', '', 'g');
  IF digits = '' THEN RETURN NULL; END IF;
  IF digits ~ '^90' AND length(digits) = 12 THEN RETURN digits; END IF;
  IF digits ~ '^0'  AND length(digits) = 11 THEN RETURN '9' || digits; END IF;
  IF length(digits) = 10 THEN RETURN '90' || digits; END IF;
  RETURN digits;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'normalized_phone'
  ) THEN
    ALTER TABLE public.customers
      ADD COLUMN normalized_phone text
      GENERATED ALWAYS AS (public.normalize_phone(phone)) STORED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_customers_company_normalized_phone
  ON public.customers (company_id, normalized_phone)
  WHERE normalized_phone IS NOT NULL;

NOTIFY pgrst, 'reload schema';

-- Doğrulama (salt okunur):
SELECT column_name, data_type, is_generated
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'normalized_phone';
