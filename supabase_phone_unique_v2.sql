-- ============================================================
-- Migration: Müşteri Telefon Benzersizliği — Production Safe
-- Versiyon: 2  (supabase_phone_unique.sql'in yerini alır)
-- Tarih: 2026-06-10
--
-- 3 aşamalı güvenli uygulama:
--   ADIM 1 — normalize_phone fonksiyonu + normalized_phone kolonu
--   ADIM 2 — Mevcut duplicate'leri tespit et ve logla (veri silmez)
--   ADIM 3 — Duplicate'leri çöz, sonra UNIQUE INDEX ekle
--
-- Her adım bağımsız çalışabilir.
-- Birden fazla çalıştırılabilir (idempotent).
-- ============================================================


-- ============================================================
-- ADIM 1: Normalizasyon fonksiyonu ve kolon
-- ============================================================

-- 1a. Normalizasyon fonksiyonu
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

  -- +90 veya 90 ile başlayan 12 hane
  IF digits ~ '^90' AND length(digits) = 12 THEN
    RETURN digits;
  END IF;

  -- 0 ile başlayan 11 hane (Türk yerel format: 0532...)
  IF digits ~ '^0' AND length(digits) = 11 THEN
    RETURN '9' || digits;
  END IF;

  -- 10 hane (alan kodsuz: 5321234567)
  IF length(digits) = 10 THEN
    RETURN '90' || digits;
  END IF;

  -- Tanımlanamayan format — temizlenmiş haliyle döndür
  RETURN digits;
END;
$$;

-- 1b. normalized_phone computed kolonu (GENERATED ALWAYS AS STORED)
--     phone değişince otomatik güncellenir, indekslenebilir.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'customers'
      AND column_name  = 'normalized_phone'
  ) THEN
    ALTER TABLE public.customers
      ADD COLUMN normalized_phone text
        GENERATED ALWAYS AS (public.normalize_phone(phone)) STORED;
  END IF;
END;
$$;

-- 1c. Performans için index (unique değil — henüz)
CREATE INDEX IF NOT EXISTS idx_customers_company_normalized_phone
  ON public.customers (company_id, normalized_phone)
  WHERE normalized_phone IS NOT NULL;


-- ============================================================
-- ADIM 2: Duplicate tespiti ve loglama
-- ============================================================

-- 2a. Duplicate log tablosu
CREATE TABLE IF NOT EXISTS public.customer_phone_duplicate_log (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid        NOT NULL,
  normalized_phone    text        NOT NULL,
  kept_customer_id    uuid        NOT NULL,  -- Tutulacak kayıt (en eski)
  kept_customer_name  text,
  dup_customer_id     uuid        NOT NULL,  -- Duplicate kayıt
  dup_customer_name   text,
  dup_order_count     integer     DEFAULT 0,
  dup_appointment_count integer   DEFAULT 0,
  resolution          text        DEFAULT 'pending',
  -- pending | merged | deleted | kept_both
  resolved_at         timestamptz,
  resolved_by         text,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dup_log_company
  ON public.customer_phone_duplicate_log (company_id);

CREATE INDEX IF NOT EXISTS idx_dup_log_resolution
  ON public.customer_phone_duplicate_log (resolution)
  WHERE resolution = 'pending';

-- 2b. Mevcut duplicate'leri tespit edip log'a yaz
--     Her aynı telefon grubunda en eski kayıt tutulur, diğerleri loglanır.
--     Daha önce loglanmış kayıtlar tekrar eklenmez (idempotent).
INSERT INTO public.customer_phone_duplicate_log
  (company_id, normalized_phone,
   kept_customer_id, kept_customer_name,
   dup_customer_id,  dup_customer_name,
   dup_order_count, dup_appointment_count)
SELECT
  c.company_id,
  c.normalized_phone,
  grp.kept_id              AS kept_customer_id,
  kc.name                  AS kept_customer_name,
  c.id                     AS dup_customer_id,
  c.name                   AS dup_customer_name,
  (SELECT COUNT(*) FROM public.orders
     WHERE customer_id = c.id)        AS dup_order_count,
  (SELECT COUNT(*) FROM public.appointments
     WHERE customer_id = c.id)        AS dup_appointment_count
FROM public.customers c
-- Gruptaki en eski kayıt (kept)
JOIN (
  SELECT
    company_id,
    normalized_phone,
    MIN(created_at) AS min_created,
    (array_agg(id ORDER BY created_at ASC))[1] AS kept_id
  FROM public.customers
  WHERE normalized_phone IS NOT NULL
  GROUP BY company_id, normalized_phone
  HAVING COUNT(*) > 1
) grp
  ON  grp.company_id       = c.company_id
  AND grp.normalized_phone = c.normalized_phone
  AND c.id                <> grp.kept_id          -- sadece duplicate olanlar
JOIN public.customers kc
  ON kc.id = grp.kept_id
-- Daha önce loglanmış kayıtları tekrar ekleme
WHERE NOT EXISTS (
  SELECT 1 FROM public.customer_phone_duplicate_log dl
  WHERE dl.dup_customer_id = c.id
);


-- ============================================================
-- ADIM 3: Duplicate kontrolü — varsa dur ve raporla, yoksa INDEX ekle
--
-- Bu adım HİÇBİR VERİ SİLMEZ, HİÇBİR VERİ TAŞIMAZ.
-- Duplicate kayıt varsa RAISE EXCEPTION ile migration durur.
-- Tüm çakışmalar customer_phone_duplicate_log tablosunda görüntülenebilir.
--
-- Duplicate'leri çözmek için:
--   1. Aşağıdaki rapor sorgusunu çalıştırın (bu dosyanın sonunda)
--   2. Her çakışan çifti manuel olarak inceleyin
--   3. Hangi kaydı tutmak istediğinize karar verin
--   4. Gereksiz kaydı sildikten sonra log'u güncelleyin:
--        UPDATE public.customer_phone_duplicate_log
--        SET resolution = 'resolved_manually', resolved_at = now(), resolved_by = 'admin'
--        WHERE dup_customer_id = '<silinen_id>';
--   5. Bu migration dosyasını tekrar çalıştırın — duplicate yoksa INDEX eklenir.
-- ============================================================

DO $$
DECLARE
  v_pending  integer;
  v_report   text := '';
  v_row      record;
BEGIN
  -- Çözülmemiş duplicate sayısını al
  SELECT COUNT(*) INTO v_pending
  FROM public.customer_phone_duplicate_log
  WHERE resolution = 'pending';

  -- Duplicate yoksa index ekle ve bitir
  IF v_pending = 0 THEN
    RAISE NOTICE 'Çözülmemiş duplicate kayıt yok. UNIQUE INDEX ekleniyor...';
    RETURN;
  END IF;

  -- Duplicate varsa her birini raporla, sonra exception fırlat
  RAISE NOTICE '=== DUPLICATE TELEFON RAPORU ===';
  RAISE NOTICE 'Toplam % adet çözülmemiş kayıt bulundu.', v_pending;
  RAISE NOTICE '';
  RAISE NOTICE '%-36s | %-20s | %-30s | %-30s | Sipariş | Randevu',
    'Normalize Telefon', 'Şirket ID (kısa)', 'Tutulan Kayıt', 'Duplicate Kayıt';
  RAISE NOTICE '%', repeat('-', 130);

  FOR v_row IN
    SELECT
      dl.normalized_phone,
      left(dl.company_id::text, 8)   AS company_short,
      dl.kept_customer_id,
      coalesce(dl.kept_customer_name, '?')  AS kept_name,
      dl.dup_customer_id,
      coalesce(dl.dup_customer_name, '?')   AS dup_name,
      dl.dup_order_count,
      dl.dup_appointment_count
    FROM public.customer_phone_duplicate_log dl
    WHERE dl.resolution = 'pending'
    ORDER BY dl.dup_order_count DESC, dl.normalized_phone
  LOOP
    RAISE NOTICE '% | %... | % (%) → % (%) | Sipariş: % | Randevu: %',
      v_row.normalized_phone,
      v_row.company_short,
      v_row.kept_name, left(v_row.kept_customer_id::text, 8),
      v_row.dup_name,  left(v_row.dup_customer_id::text, 8),
      v_row.dup_order_count,
      v_row.dup_appointment_count;
  END LOOP;

  RAISE NOTICE '';
  RAISE NOTICE 'Tam detay için: SELECT * FROM public.customer_phone_duplicate_log WHERE resolution = ''pending'' ORDER BY dup_order_count DESC;';
  RAISE NOTICE '';

  -- Migration'ı durdur — HİÇBİR VERİ DEĞİŞMEDİ
  RAISE EXCEPTION
    'Migration durduruldu: % adet çözülmemiş duplicate telefon kaydı var. '
    'Yukarıdaki raporu inceleyin, manuel düzeltme yapın, ardından migration''ı tekrar çalıştırın.',
    v_pending;
END;
$$;

-- Buraya gelindiyse duplicate yoktur — UNIQUE INDEX ekle
CREATE UNIQUE INDEX IF NOT EXISTS customers_company_phone_unique
  ON public.customers (company_id, normalized_phone)
  WHERE normalized_phone IS NOT NULL;

DO $$
BEGIN
  RAISE NOTICE 'UNIQUE INDEX başarıyla oluşturuldu.';
  RAISE NOTICE 'Migration tamamlandı. Artık aynı şirkette aynı telefon numarası ile iki müşteri oluşturulamaz.';
END;
$$;


-- ============================================================
-- EL KİTABI: DUPLICATE BULUNURSA NE YAPILIR?
-- ============================================================

-- ADIM A — Tüm çakışmaları listele (sipariş sayısına göre sırala)
/*
SELECT
  dl.normalized_phone                          AS telefon,
  dl.kept_customer_name                        AS tutulacak_musteri,
  left(dl.kept_customer_id::text, 8)           AS tutulacak_id,
  dl.dup_customer_name                         AS duplicate_musteri,
  left(dl.dup_customer_id::text, 8)            AS duplicate_id,
  dl.dup_order_count                           AS siparis_sayisi,
  dl.dup_appointment_count                     AS randevu_sayisi,
  dl.resolution
FROM public.customer_phone_duplicate_log dl
WHERE dl.resolution = 'pending'
ORDER BY dl.dup_order_count DESC, dl.normalized_phone;
*/

-- ADIM B — Belirli bir duplicate kaydın siparişlerini görüntüle
/*
SELECT o.id, o.status, o.total_amount, o.created_at
FROM public.orders o
WHERE o.customer_id = '<DUPLICATE_MUSTERI_ID>';
*/

-- ADIM C — Manuel düzeltme sonrası log kaydını kapat
-- (duplicate kaydı sildikten veya başka bir çözüm uyguladıktan sonra)
/*
UPDATE public.customer_phone_duplicate_log
SET
  resolution  = 'resolved_manually',
  resolved_at = now(),
  resolved_by = 'admin'   -- kendi adınızı yazın
WHERE dup_customer_id = '<DUPLICATE_MUSTERI_ID>';
*/

-- ============================================================
-- DOĞRULAMA SORGULARI (migration başarıyla tamamlandıktan sonra)
-- ============================================================

/*
-- 1. Hâlâ duplicate var mı? (sonuç boş olmalı)
SELECT company_id, normalized_phone, COUNT(*) AS cnt
FROM public.customers
WHERE normalized_phone IS NOT NULL
GROUP BY company_id, normalized_phone
HAVING COUNT(*) > 1;

-- 2. UNIQUE INDEX oluşturuldu mu?
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'customers'
  AND indexname = 'customers_company_phone_unique';

-- 3. Log özeti
SELECT resolution, COUNT(*) AS cnt
FROM public.customer_phone_duplicate_log
GROUP BY resolution;

-- 4. Normalizasyon doğru çalışıyor mu?
SELECT phone, normalized_phone
FROM public.customers
WHERE phone IS NOT NULL
LIMIT 20;
*/
