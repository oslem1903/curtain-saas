-- ============================================================
-- PERDEPRO - Müşteri Tahsilat (Customer Collection) desteği
-- Müşteri bazlı tahsilat ve fazla ödeme (avans) takibi için
-- payments tablosuna customer_id kolonu ekler.
-- Bu dosyayı Supabase SQL Editor'da çalıştırın. (Additive / güvenli)
-- ============================================================

-- payments tablosuna müşteri bağlantısı (sipariş bağımsız tahsilat / avans için)
ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL;

-- Siparişe bağlı olmayan avans kayıtları için order_id null olabilmeli
ALTER TABLE public.payments
    ALTER COLUMN order_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_customer ON public.payments(customer_id);

-- PostgREST şema önbelleğini yenile
NOTIFY pgrst, 'reload schema';
