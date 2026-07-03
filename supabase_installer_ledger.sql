-- ============================================================
-- PERDEPRO - Montajcı Cari Sistemi
-- Tedarikçi cari mantığının montajcı karşılığı.
-- Tek seferde çalışır, idempotent, veri silmez.
-- ============================================================

-- 1. installation_jobs: hakediş alanları
ALTER TABLE installation_jobs ADD COLUMN IF NOT EXISTS area_m2 NUMERIC(10,4);
ALTER TABLE installation_jobs ADD COLUMN IF NOT EXISTS qty INT DEFAULT 1;
ALTER TABLE installation_jobs ADD COLUMN IF NOT EXISTS price_type TEXT DEFAULT 'manuel';  -- m2 | adet | sabit | manuel
ALTER TABLE installation_jobs ADD COLUMN IF NOT EXISTS unit_rate NUMERIC(12,2) DEFAULT 0; -- m2/adet birim ücreti
ALTER TABLE installation_jobs ADD COLUMN IF NOT EXISTS installer_fee NUMERIC(12,2) DEFAULT 0; -- bu işin hakediş tutarı
ALTER TABLE installation_jobs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- Mevcut işlerde area_m2'yi en/boy'dan doldur (boşsa)
DO $$
BEGIN
    BEGIN
        SET LOCAL session_replication_role = replica;
        UPDATE installation_jobs
        SET area_m2 = round((width * height / 10000.0)::numeric, 4)
        WHERE area_m2 IS NULL AND width IS NOT NULL AND height IS NOT NULL AND width > 0 AND height > 0;
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
END $$;

-- 2. Montajcı cari hareketleri (tedarikçi supplier_transactions karşılığı)
--    Hakediş işlerden hesaplanır; bu tabloda yalnızca ödemeler ve iptaller tutulur.
CREATE TABLE IF NOT EXISTS installer_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    installer_id UUID NOT NULL,              -- employees.id
    transaction_date TIMESTAMPTZ NOT NULL DEFAULT now(),
    transaction_type TEXT NOT NULL DEFAULT 'payment',  -- payment | cancel
    amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    description TEXT,
    payment_method TEXT,
    period_start DATE,
    period_end DATE,
    expense_id UUID,                          -- bağlı gider kaydı (senkron için)
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_installer_tx_company_installer
ON installer_transactions (company_id, installer_id, transaction_date DESC);

ALTER TABLE installer_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "installer_tx_select" ON installer_transactions;
CREATE POLICY "installer_tx_select" ON installer_transactions
    FOR SELECT TO authenticated
    USING (company_id IN (SELECT public.my_company_ids()) OR public.is_super_admin());

DROP POLICY IF EXISTS "installer_tx_insert" ON installer_transactions;
CREATE POLICY "installer_tx_insert" ON installer_transactions
    FOR INSERT TO authenticated
    WITH CHECK (company_id IN (SELECT public.my_company_ids()) OR public.is_super_admin());

DROP POLICY IF EXISTS "installer_tx_update" ON installer_transactions;
CREATE POLICY "installer_tx_update" ON installer_transactions
    FOR UPDATE TO authenticated
    USING (company_id IN (SELECT public.my_company_ids()) OR public.is_super_admin());

DROP POLICY IF EXISTS "installer_tx_delete" ON installer_transactions;
CREATE POLICY "installer_tx_delete" ON installer_transactions
    FOR DELETE TO authenticated
    USING (company_id IN (SELECT public.my_company_ids()) OR public.is_super_admin());

-- 3. Schema cache
NOTIFY pgrst, 'reload schema';

-- SONUC
SELECT 'SONUC: installer_transactions hazir' AS check_name,
       to_regclass('public.installer_transactions') IS NOT NULL AS ok;
