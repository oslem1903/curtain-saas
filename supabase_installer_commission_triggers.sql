-- ============================================================================
-- INSTALLER COMMISSION TRIGGERS
-- Automatically create earnings when installation job completes
-- ============================================================================

-- ============================================================================
-- TRIGGER 1: on_installation_job_completed
-- When job status = 'installation_completed', create earning
-- ============================================================================

CREATE OR REPLACE FUNCTION public.on_installation_job_completed()
RETURNS TRIGGER AS $$
DECLARE
    v_company_id uuid;
    v_installer_id uuid;
    v_qty_earning numeric;
    v_area_earning numeric;
    v_manual_earning numeric;
    v_total_earning numeric;
    v_calc_details jsonb;
    v_commission_type text;
    v_qty numeric;
    v_area numeric;
    v_rate_qty numeric;
    v_rate_area numeric;
    v_existing_earning_id uuid;
BEGIN
    -- Skip if not installation_completed status
    IF NEW.status != 'installation_completed' THEN
        RETURN NEW;
    END IF;

    -- Skip if already processed (earning exists for this job)
    SELECT id INTO v_existing_earning_id
    FROM public.installer_earnings
    WHERE installation_job_id = NEW.id
    LIMIT 1;

    IF v_existing_earning_id IS NOT NULL THEN
        RETURN NEW; -- Already processed
    END IF;

    -- Get installer and company
    v_installer_id := NEW.assigned_staff_id;
    v_company_id := NEW.company_id;

    IF v_installer_id IS NULL OR v_company_id IS NULL THEN
        RETURN NEW; -- Missing required fields
    END IF;

    -- Get installer commission settings
    SELECT
        commission_type,
        commission_quantity_rate,
        commission_area_rate
    INTO
        v_commission_type,
        v_rate_qty,
        v_rate_area
    FROM public.employees
    WHERE id = v_installer_id;

    IF NOT FOUND THEN
        RETURN NEW; -- Installer not found
    END IF;

    -- Get total qty and area from order items
    SELECT
        COALESCE(SUM(qty), 0),
        COALESCE(SUM(area_m2), 0)
    INTO v_qty, v_area
    FROM public.order_items
    WHERE order_id = NEW.order_id;

    -- Calculate earnings based on commission type
    v_qty_earning := 0;
    v_area_earning := 0;
    v_manual_earning := 0;

    CASE v_commission_type
        WHEN 'quantity' THEN
            v_qty_earning := v_qty * COALESCE(v_rate_qty, 50);
            v_calc_details := jsonb_build_object(
                'type', 'quantity',
                'quantity', v_qty,
                'rate', v_rate_qty,
                'earning', v_qty_earning
            );

        WHEN 'area' THEN
            v_area_earning := v_area * COALESCE(v_rate_area, 80);
            v_calc_details := jsonb_build_object(
                'type', 'area',
                'area_m2', v_area,
                'rate', v_rate_area,
                'earning', v_area_earning
            );

        WHEN 'hybrid' THEN
            v_qty_earning := v_qty * COALESCE(v_rate_qty, 50);
            v_area_earning := v_area * COALESCE(v_rate_area, 80);
            v_calc_details := jsonb_build_object(
                'type', 'hybrid',
                'quantity', v_qty,
                'quantity_rate', v_rate_qty,
                'quantity_earning', v_qty_earning,
                'area_m2', v_area,
                'area_rate', v_rate_area,
                'area_earning', v_area_earning
            );

        WHEN 'manual' THEN
            v_calc_details := jsonb_build_object(
                'type', 'manual',
                'note', 'Requires manual entry'
            );

        ELSE
            v_qty_earning := v_qty * COALESCE(v_rate_qty, 50);
            v_calc_details := jsonb_build_object('type', 'default_quantity');
    END CASE;

    v_total_earning := v_qty_earning + v_area_earning + v_manual_earning;

    -- Create installer_earnings record
    INSERT INTO public.installer_earnings (
        company_id,
        installer_id,
        installation_job_id,
        order_id,
        job_completed_date,
        product_type,
        earning_type,
        quantity,
        area_m2,
        quantity_rate,
        area_rate,
        quantity_earning,
        area_earning,
        manual_earning,
        total_earning,
        metadata
    ) VALUES (
        v_company_id,
        v_installer_id,
        NEW.id,
        NEW.order_id,
        now(),
        NEW.product_type,
        v_commission_type,
        v_qty,
        v_area,
        v_rate_qty,
        v_rate_area,
        v_qty_earning,
        v_area_earning,
        v_manual_earning,
        v_total_earning,
        v_calc_details
    );

    -- Create installer_transactions record (earning type)
    INSERT INTO public.installer_transactions (
        company_id,
        installer_id,
        transaction_date,
        transaction_type,
        amount,
        description,
        related_job_id,
        earning_type
    ) VALUES (
        v_company_id,
        v_installer_id,
        now(),
        'earning',
        v_total_earning,
        format(
            'Montaj tamamlandı - Sipariş %s (Müşteri)',
            NEW.order_id::text
        ),
        NEW.id,
        v_commission_type
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_installation_job_completed ON public.installation_jobs;
CREATE TRIGGER on_installation_job_completed
AFTER UPDATE ON public.installation_jobs
FOR EACH ROW
EXECUTE FUNCTION public.on_installation_job_completed();

COMMENT ON TRIGGER on_installation_job_completed ON public.installation_jobs IS
'Montaj job tamamlandığında otomatik hakediş oluştur';

-- ============================================================================
-- TRIGGER 2: on_installation_job_deleted
-- When job is deleted, cancel its earnings
-- ============================================================================

CREATE OR REPLACE FUNCTION public.on_installation_job_deleted()
RETURNS TRIGGER AS $$
DECLARE
    v_earning_id uuid;
BEGIN
    -- Find and cancel associated earnings
    SELECT id INTO v_earning_id
    FROM public.installer_earnings
    WHERE installation_job_id = OLD.id
    LIMIT 1;

    IF v_earning_id IS NOT NULL THEN
        -- Mark earnings as cancelled (soft delete)
        UPDATE public.installer_earnings
        SET metadata = jsonb_set(metadata, '{cancelled}', 'true'::jsonb)
        WHERE id = v_earning_id;

        -- Create cancel transaction
        INSERT INTO public.installer_transactions (
            company_id,
            installer_id,
            transaction_date,
            transaction_type,
            amount,
            description,
            related_job_id,
            earning_type
        )
        SELECT
            company_id,
            installer_id,
            now(),
            'adjustment',
            -total_earning,
            format('Montaj iptal edildi - Hakediş geri alındı (İş: %s)', OLD.id::text),
            OLD.id,
            'cancel'
        FROM public.installer_earnings
        WHERE id = v_earning_id;
    END IF;

    RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_installation_job_deleted ON public.installation_jobs;
CREATE TRIGGER on_installation_job_deleted
AFTER DELETE ON public.installation_jobs
FOR EACH ROW
EXECUTE FUNCTION public.on_installation_job_deleted();

COMMENT ON TRIGGER on_installation_job_deleted ON public.installation_jobs IS
'Montaj job silindiğinde, ilişkili hakediş ve transaction''ları iptal et';

-- ============================================================================
-- TRIGGER 3: on_installer_payment_created
-- When payment is created, add to transactions
-- ============================================================================

CREATE OR REPLACE FUNCTION public.on_installer_payment_created()
RETURNS TRIGGER AS $$
BEGIN
    -- Create transaction record for payment
    INSERT INTO public.installer_transactions (
        company_id,
        installer_id,
        transaction_date,
        transaction_type,
        amount,
        description,
        payment_method,
        related_job_id
    ) VALUES (
        NEW.company_id,
        NEW.installer_id,
        NEW.payment_date,
        'payment',
        NEW.amount,
        format(
            'Ödeme: %s - Sipariş: %s',
            NEW.payment_method,
            COALESCE(NEW.order_id::text, 'N/A')
        ),
        NEW.payment_method,
        NULL
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_installer_payment_created ON public.installer_payments;
CREATE TRIGGER on_installer_payment_created
AFTER INSERT ON public.installer_payments
FOR EACH ROW
EXECUTE FUNCTION public.on_installer_payment_created();

COMMENT ON TRIGGER on_installer_payment_created ON public.installer_payments IS
'Ödeme kaydedildiğinde, installer_transactions''a payment hareketi ekle';

-- ============================================================================
-- SAFETY: Notify PostgREST cache invalidation
-- ============================================================================

NOTIFY pgrst, 'reload schema';
