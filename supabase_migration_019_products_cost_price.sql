-- ============================================================
-- Migration 019: products.cost_price (alış fiyatı) kolonu
-- PRODUCTION'da elle çalıştırın. Geriye dönük uyumlu, eklemeli:
-- mevcut satırlar/politikalar/tetikleyiciler DEĞİŞMEZ, veri silinmez.
--
-- Bulgu: canlıda "column products.cost_price does not exist" (42703).
-- İstemci (Products.tsx, NewOrder.tsx, MeasurementEntry.tsx, OrderDetail.tsx) alanı
-- `cost_price` adıyla okur/yazar; kolon yokken Products.tsx sessizce alış fiyatsız kaydediyordu.
-- ============================================================

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS cost_price numeric(12,2) NOT NULL DEFAULT 0;

-- Negatif alış fiyatı DB düzeyinde de engellenir (mevcut satırlar 0 ile başladığı için geçerli).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'products_cost_price_nonneg' AND conrelid = 'public.products'::regclass
  ) THEN
    ALTER TABLE public.products
      ADD CONSTRAINT products_cost_price_nonneg CHECK (cost_price >= 0);
  END IF;
END $$;

-- PostgREST şema önbelleğini yenile (aksi halde PGRST204 görülebilir).
NOTIFY pgrst, 'reload schema';

-- DOĞRULAMA: SELECT column_name, data_type, column_default FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='products' AND column_name='cost_price';
-- NOT: Mevcut ürünlerin alış fiyatı 0 olur; uygulama bu durumda tedarikçi fiyatına
-- (supplier_product_prices.unit_cost) düşmeye devam eder. Ürün kartı düzenlenip
-- kaydedildiğinde yeni doğrulama alış fiyatı > 0 ister.
