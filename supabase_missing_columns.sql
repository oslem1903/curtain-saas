-- ============================================================
-- PERDEPRO - Eksik Kolon Migration
-- Bu dosyayı Supabase SQL Editor'da çalıştırın.
-- ============================================================

-- 1. appointments tablosu — tedarikçi alanları
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS supplier_unit_cost NUMERIC(12,2) DEFAULT 0;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS supplier_total_cost NUMERIC(12,2) DEFAULT 0;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS rounded_width_cm NUMERIC(10,2);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS rounded_height_cm NUMERIC(10,2);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS estimated_area_m2 NUMERIC(10,4);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS estimated_total NUMERIC(12,2);
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS measurement_notes TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS measurement_photo_url TEXT;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS done_at TIMESTAMPTZ;

-- 2. order_items tablosu — hesaplama ve cari alanları
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS area_m2 NUMERIC(10,4);
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS profit NUMERIC(12,2) DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS supplier_unit_cost NUMERIC(12,2) DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS supplier_total_cost NUMERIC(12,2) DEFAULT 0;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS supplier_transaction_id UUID REFERENCES supplier_transactions(id) ON DELETE SET NULL;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS product_options JSONB;

-- 3. orders tablosu — kâr ve maliyet alanları
ALTER TABLE orders ADD COLUMN IF NOT EXISTS fabric_cost NUMERIC(12,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS gross_profit NUMERIC(12,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS profit NUMERIC(12,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS supplier_total_cost NUMERIC(12,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(12,2) DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(12,2) DEFAULT 0;

-- 4. companies tablosu — logo
ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url TEXT;

-- 5. Schema cache yenile (PostgREST)
NOTIFY pgrst, 'reload schema';
