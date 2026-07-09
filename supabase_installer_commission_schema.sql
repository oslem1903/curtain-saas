-- ============================================================================
-- INSTALLER/MONTAJCI COMMISSION SYSTEM - SCHEMA ONLY
-- Add commission settings to employees table
-- ============================================================================

-- Add commission columns to employees (montajcı kartına)
ALTER TABLE IF EXISTS public.employees
ADD COLUMN IF NOT EXISTS commission_type text DEFAULT 'quantity' CHECK (commission_type IN ('quantity', 'area', 'hybrid', 'manual')),
ADD COLUMN IF NOT EXISTS commission_quantity_rate numeric DEFAULT 50, -- her adet için TL
ADD COLUMN IF NOT EXISTS commission_area_rate numeric DEFAULT 80;    -- her m² için TL

-- ============================================================================
-- INSTALLER EARNINGS TABLE (Hakediş Kayıtları)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.installer_earnings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    installer_id uuid NOT NULL,                    -- employees.id
    installation_job_id uuid REFERENCES public.installation_jobs(id) ON DELETE SET NULL,
    order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,

    -- Montaj bilgisi
    job_completed_date timestamptz NOT NULL DEFAULT now(),
    product_type text,

    -- Hakediş hesabı
    earning_type text NOT NULL CHECK (earning_type IN ('quantity', 'area', 'hybrid', 'manual')),
    quantity numeric,                   -- kullanılan adet
    area_m2 numeric,                    -- kullanılan alan
    quantity_rate numeric,              -- birim fiyat (adet)
    area_rate numeric,                  -- birim fiyat (m²)
    quantity_earning numeric,           -- qty × rate
    area_earning numeric,               -- m2 × rate
    manual_earning numeric,             -- manual ekleme
    total_earning numeric NOT NULL,     -- toplam

    -- Audit
    created_by uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),

    -- RLS & Audit
    metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_installer_earnings_company ON public.installer_earnings(company_id);
CREATE INDEX IF NOT EXISTS idx_installer_earnings_installer ON public.installer_earnings(installer_id);
CREATE INDEX IF NOT EXISTS idx_installer_earnings_order ON public.installer_earnings(order_id);
CREATE INDEX IF NOT EXISTS idx_installer_earnings_job ON public.installer_earnings(installation_job_id);
CREATE INDEX IF NOT EXISTS idx_installer_earnings_date ON public.installer_earnings(job_completed_date DESC);

COMMENT ON TABLE public.installer_earnings IS
'Montajcı hakediş kayıtları. Her montaj tamamlandığında otomatik oluşturulur.';

-- ============================================================================
-- RLS POLICIES - installer_earnings
-- ============================================================================

ALTER TABLE public.installer_earnings ENABLE ROW LEVEL SECURITY;

-- Installer: Kendi earnings'ini görebilir
CREATE POLICY installer_earnings_self_select ON public.installer_earnings
FOR SELECT USING (
    installer_id = auth.uid()
    OR installer_id IN (
        SELECT user_id FROM public.profiles
        WHERE company_id = public.installer_earnings.company_id
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin')
);

-- Admin: Şirketinin earnings'ini görebilir
CREATE POLICY installer_earnings_company_select ON public.installer_earnings
FOR SELECT USING (
    company_id IN (
        SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
    )
    OR EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin')
);

-- Super Admin: Tümünü görebilir
CREATE POLICY installer_earnings_admin_select ON public.installer_earnings
FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin')
);

-- Insert: System (trigger) ve Admin
CREATE POLICY installer_earnings_insert ON public.installer_earnings
FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role IN ('admin', 'super_admin'))
    OR TRUE  -- Trigger tarafından system kullanıcısı olarak eklenir
);

-- Update: Admin ve system
CREATE POLICY installer_earnings_update ON public.installer_earnings
FOR UPDATE USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role IN ('admin', 'super_admin'))
);

GRANT SELECT, INSERT, UPDATE ON public.installer_earnings TO authenticated;

-- ============================================================================
-- EXTEND installer_transactions TABLE
-- ============================================================================

ALTER TABLE IF EXISTS public.installer_transactions
ADD COLUMN IF NOT EXISTS earning_id uuid REFERENCES public.installer_earnings(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS earning_type text,                    -- qualification: 'earning'|'payment'|'adjustment'
ADD COLUMN IF NOT EXISTS related_job_id uuid;                  -- installation_job_id reference

-- ============================================================================
-- FUNCTION: Calculate commission for single installation job
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calculate_commission_for_job(
    p_job_id uuid,
    p_installer_id uuid,
    p_company_id uuid
)
RETURNS TABLE (
    quantity_earning numeric,
    area_earning numeric,
    manual_earning numeric,
    total_earning numeric,
    calculation_details jsonb
) LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
    v_installer record;
    v_job record;
    v_order record;
    v_items record;
    v_total_qty numeric := 0;
    v_total_area numeric := 0;
    v_qty_earning numeric := 0;
    v_area_earning numeric := 0;
    v_manual_earning numeric := 0;
    v_details jsonb := '{}'::jsonb;
BEGIN
    -- Get installer commission settings
    SELECT * INTO v_installer FROM public.employees WHERE id = p_installer_id;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 0::numeric, 0::numeric, 0::numeric, 0::numeric, '{}'::jsonb;
        RETURN;
    END IF;

    -- Get job and order info
    SELECT * INTO v_job FROM public.installation_jobs WHERE id = p_job_id;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 0::numeric, 0::numeric, 0::numeric, 0::numeric, '{}'::jsonb;
        RETURN;
    END IF;

    SELECT * INTO v_order FROM public.orders WHERE id = v_job.order_id;
    IF NOT FOUND THEN
        RETURN QUERY SELECT 0::numeric, 0::numeric, 0::numeric, 0::numeric, '{}'::jsonb;
        RETURN;
    END IF;

    -- Get order items for this job
    SELECT
        COALESCE(SUM(qty), 0) as total_qty,
        COALESCE(SUM(area_m2), 0) as total_area
    INTO v_total_qty, v_total_area
    FROM public.order_items
    WHERE order_id = v_job.order_id;

    -- Calculate earnings based on commission_type
    CASE v_installer.commission_type
        WHEN 'quantity' THEN
            v_qty_earning := v_total_qty * COALESCE(v_installer.commission_quantity_rate, 50);
            v_details := jsonb_build_object(
                'type', 'quantity',
                'quantity', v_total_qty,
                'rate', v_installer.commission_quantity_rate,
                'earning', v_qty_earning
            );

        WHEN 'area' THEN
            v_area_earning := v_total_area * COALESCE(v_installer.commission_area_rate, 80);
            v_details := jsonb_build_object(
                'type', 'area',
                'area_m2', v_total_area,
                'rate', v_installer.commission_area_rate,
                'earning', v_area_earning
            );

        WHEN 'hybrid' THEN
            v_qty_earning := v_total_qty * COALESCE(v_installer.commission_quantity_rate, 50);
            v_area_earning := v_total_area * COALESCE(v_installer.commission_area_rate, 80);
            v_details := jsonb_build_object(
                'type', 'hybrid',
                'quantity', v_total_qty,
                'quantity_rate', v_installer.commission_quantity_rate,
                'quantity_earning', v_qty_earning,
                'area_m2', v_total_area,
                'area_rate', v_installer.commission_area_rate,
                'area_earning', v_area_earning
            );

        WHEN 'manual' THEN
            v_manual_earning := 0; -- To be filled manually
            v_details := jsonb_build_object(
                'type', 'manual',
                'note', 'Manual entry required'
            );

        ELSE
            v_qty_earning := v_total_qty * COALESCE(v_installer.commission_quantity_rate, 50);
            v_details := jsonb_build_object('type', 'default_quantity');
    END CASE;

    RETURN QUERY
    SELECT
        v_qty_earning,
        v_area_earning,
        v_manual_earning,
        (v_qty_earning + v_area_earning + v_manual_earning)::numeric,
        v_details;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_commission_for_job(uuid, uuid, uuid) TO authenticated;

-- ============================================================================
-- FUNCTION: Get installer cari summary
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_installer_cari_summary(
    p_installer_id uuid,
    p_company_id uuid
)
RETURNS TABLE (
    total_earnings numeric,
    total_paid numeric,
    total_adjustments numeric,
    balance numeric,
    last_earning_date timestamptz,
    last_payment_date timestamptz,
    transaction_count bigint
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE(SUM(CASE WHEN st.transaction_type = 'earning' THEN st.amount ELSE 0 END), 0)::numeric,
        COALESCE(SUM(CASE WHEN st.transaction_type = 'payment' THEN st.amount ELSE 0 END), 0)::numeric,
        COALESCE(SUM(CASE WHEN st.transaction_type = 'adjustment' THEN st.amount ELSE 0 END), 0)::numeric,
        COALESCE(SUM(CASE
            WHEN st.transaction_type = 'earning' THEN st.amount
            WHEN st.transaction_type = 'payment' THEN -st.amount
            WHEN st.transaction_type = 'adjustment' THEN st.amount
            ELSE 0
        END), 0)::numeric,
        MAX(CASE WHEN st.transaction_type = 'earning' THEN st.transaction_date END),
        MAX(CASE WHEN st.transaction_type = 'payment' THEN st.transaction_date END),
        COUNT(*)
    FROM public.installer_transactions st
    WHERE st.installer_id = p_installer_id
      AND st.company_id = p_company_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_installer_cari_summary(uuid, uuid) TO authenticated;

-- ============================================================================
-- FUNCTION: Get installer ledger
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_installer_ledger(
    p_installer_id uuid,
    p_company_id uuid,
    p_limit integer DEFAULT 100
)
RETURNS TABLE (
    id uuid,
    transaction_date timestamptz,
    transaction_type text,
    amount numeric,
    description text,
    order_id uuid,
    customer_name text,
    running_balance numeric
) LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    RETURN QUERY
    WITH ledger AS (
        SELECT
            st.id,
            st.transaction_date,
            st.transaction_type,
            st.amount,
            st.description,
            st.order_id,
            c.name as customer_name
        FROM public.installer_transactions st
        LEFT JOIN public.orders o ON st.order_id = o.id
        LEFT JOIN public.customers c ON o.customer_id = c.id
        WHERE st.installer_id = p_installer_id
          AND st.company_id = p_company_id
        ORDER BY st.transaction_date DESC, st.created_at DESC
        LIMIT p_limit
    )
    SELECT
        l.id,
        l.transaction_date,
        l.transaction_type,
        l.amount,
        l.description,
        l.order_id,
        l.customer_name,
        (CASE
            WHEN l.transaction_type = 'earning' THEN l.amount
            WHEN l.transaction_type = 'payment' THEN -l.amount
            WHEN l.transaction_type = 'adjustment' THEN l.amount
            ELSE 0
        END)::numeric
    FROM ledger l;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_installer_ledger(uuid, uuid, integer) TO authenticated;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON COLUMN public.employees.commission_type IS
'Montajcı hakediş türü: quantity (adet), area (m²), hybrid (ikisi), manual (manuel)';

COMMENT ON COLUMN public.employees.commission_quantity_rate IS
'Adet başına hakediş fiyatı (TL)';

COMMENT ON COLUMN public.employees.commission_area_rate IS
'm² başına hakediş fiyatı (TL)';

COMMENT ON FUNCTION public.calculate_commission_for_job IS
'Verilen montaj işi için hakediş hesapla';

COMMENT ON FUNCTION public.get_installer_cari_summary IS
'Montajcı cari özeti: toplam hakediş, ödemeler, bakiye';

COMMENT ON FUNCTION public.get_installer_ledger IS
'Montajcı cari hareket detayları';
