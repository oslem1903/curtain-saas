-- ============================================================================
-- SUPPLIER CARI — SALT-OKUNUR RPC'LER (Production Safe, v2)
-- ============================================================================
-- Bu sürüm, sipariş KALEMİ (order_item) düzeyinde otomatik 'debt' üreten
-- trigger'ları İÇERMEZ.
--
-- NEDEN: Uygulama (src/pages/NewOrder.tsx) tedarikçi borcunu sipariş düzeyinde
-- (order_id + supplier_id, varlık kontrollü) zaten ELLE yönetiyor. order_item
-- düzeyindeki trigger'lar farklı anahtarla (order_item_id) ikinci bir 'debt'
-- kaydı oluşturuyor ve tedarikçi bakiyesini ÇİFT sayıyordu.
--
-- BU YÜZDEN:
--   1) Çakışan order/item düzeyi cari trigger ve fonksiyonları idempotent
--      olarak KALDIRILIR (önceki kısmi kurulumdan kalmışsa temizler; yoksa no-op).
--   2) Yalnızca SALT-OKUNUR özet + ekstre RPC'leri bırakılır (yazma yok → çakışma yok).
--   3) get_supplier_ledger'deki rezerve kelime ('to') CTE alias hatası 't' ile düzeltildi.
--
-- Idempotent: birden çok kez güvenle çalıştırılabilir. Canlı şemaya uygundur
-- (supplier_transactions: id, transaction_date, transaction_type, amount,
--  description, reference_no, order_id, created_at).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) CLEANUP — Çift borç üreten order/item düzeyi cari trigger'larını kaldır.
--    DROP TRIGGER IF EXISTS yapısı korunur; önce trigger'lar, sonra fonksiyonlar.
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_order_item_insert ON public.order_items;
DROP TRIGGER IF EXISTS on_order_item_update ON public.order_items;
DROP TRIGGER IF EXISTS on_order_item_delete ON public.order_items;
DROP TRIGGER IF EXISTS on_order_delete      ON public.orders;

DROP FUNCTION IF EXISTS public.on_order_item_create();
DROP FUNCTION IF EXISTS public.on_order_item_update();
DROP FUNCTION IF EXISTS public.on_order_item_delete();
DROP FUNCTION IF EXISTS public.on_order_delete();

-- ============================================================================
-- 2) RPC: Tedarikçi cari özeti
--    Salt-okunur; toplam borç/ödeme/iptal, bakiye ve son hareket tarihleri.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_supplier_cari_summary(
    p_supplier_id uuid,
    p_company_id uuid
)
RETURNS TABLE (
    total_debt numeric,
    total_paid numeric,
    total_cancelled numeric,
    balance numeric,
    last_transaction_date timestamptz,
    last_payment_date timestamptz,
    transaction_count bigint
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE(SUM(CASE WHEN st.transaction_type = 'debt' THEN st.amount ELSE 0 END), 0)::numeric,
        COALESCE(SUM(CASE WHEN st.transaction_type = 'payment' THEN st.amount ELSE 0 END), 0)::numeric,
        COALESCE(SUM(CASE WHEN st.transaction_type = 'cancel' THEN st.amount ELSE 0 END), 0)::numeric,
        COALESCE(SUM(CASE
            WHEN st.transaction_type = 'debt' THEN st.amount
            WHEN st.transaction_type = 'payment' THEN -st.amount
            WHEN st.transaction_type = 'cancel' THEN -st.amount
            ELSE 0
        END), 0)::numeric,
        MAX(st.transaction_date),
        MAX(CASE WHEN st.transaction_type = 'payment' THEN st.transaction_date END),
        COUNT(*)
    FROM public.supplier_transactions st
    WHERE st.supplier_id = p_supplier_id
      AND st.company_id = p_company_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_supplier_cari_summary(uuid, uuid) TO authenticated;

-- ============================================================================
-- 3) RPC: Tedarikçi cari ekstresi (hareket listesi + yürüyen bakiye)
--    DÜZELTME: CTE alias'ı 'to' (PostgreSQL rezerve kelimesi → sözdizimi hatası)
--             'transactions_ordered t' olarak değiştirildi.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.get_supplier_ledger(
    p_supplier_id uuid,
    p_company_id uuid,
    p_limit integer DEFAULT 100
)
RETURNS TABLE (
    id uuid,
    transaction_date timestamptz,
    transaction_type text,
    amount numeric,
    description text,
    reference_no text,
    order_id uuid,
    customer_name text,
    running_balance numeric
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    WITH transactions_ordered AS (
        SELECT
            st.id,
            st.transaction_date,
            st.transaction_type,
            st.amount,
            st.description,
            st.reference_no,
            st.order_id,
            o.customer_id,
            c.name AS customer_name
        FROM public.supplier_transactions st
        LEFT JOIN public.orders o ON st.order_id = o.id
        LEFT JOIN public.customers c ON o.customer_id = c.id
        WHERE st.supplier_id = p_supplier_id
          AND st.company_id = p_company_id
        ORDER BY st.transaction_date DESC, st.created_at DESC
        LIMIT p_limit
    )
    SELECT
        t.id,
        t.transaction_date,
        t.transaction_type,
        t.amount,
        t.description,
        t.reference_no,
        t.order_id,
        t.customer_name,
        (CASE
            WHEN t.transaction_type = 'debt' THEN t.amount
            WHEN t.transaction_type = 'payment' THEN -t.amount
            WHEN t.transaction_type = 'cancel' THEN -t.amount
            ELSE 0
        END)::numeric
    FROM transactions_ordered t;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_supplier_ledger(uuid, uuid, integer) TO authenticated;

-- ============================================================================
-- 4) COMMENTS + PostgREST şema cache yenileme
-- ============================================================================
COMMENT ON FUNCTION public.get_supplier_cari_summary IS
'Tedarikçi cari özeti: toplam borç, ödeme, iptal, bakiye ve son hareket tarihleri (salt-okunur).';

COMMENT ON FUNCTION public.get_supplier_ledger IS
'Tedarikçi cari ekstresi: hareket listesi + yürüyen bakiye (salt-okunur). order/item düzeyi otomatik borç trigger''ı YOKTUR; borç uygulama tarafından sipariş düzeyinde yönetilir.';

NOTIFY pgrst, 'reload schema';
