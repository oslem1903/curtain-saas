-- ============================================================================
-- PAYMENT TRANSACTION SAFETY - ATOMIC RPC FUNCTIONS
-- Issue #1: Ensure all payment operations are atomic at database level
-- Created: 2026-07-09
-- ============================================================================

-- ============================================================================
-- 1. RECORD ORDER PAYMENT (Sipariş Tahsilatı)
-- Atomically: Insert payment, insert income, update order balances
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_order_payment(
    p_company_id uuid,
    p_order_id uuid,
    p_amount numeric,
    p_payment_method text DEFAULT NULL,
    p_note text DEFAULT NULL
)
RETURNS json AS $$
DECLARE
    v_current_paid numeric;
    v_order_total numeric;
    v_next_paid numeric;
    v_next_remaining numeric;
    v_overpayment numeric;
    v_now timestamptz;
    v_payment_id uuid;
    v_income_id uuid;
    v_customer_name text;
    v_order_note text;
    v_result json;
BEGIN
    v_now := now();

    -- RATE LIMITING: Prevent duplicate payment submissions (1 per 5 seconds)
    IF NOT public.check_rate_limit('record_order_payment', 1, 5) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Rate limit exceeded. Please wait 5 seconds before the next payment.',
            'payment_id', NULL
        );
    END IF;

    -- Start transaction (implicit in RPC)
    -- Get current order state
    SELECT
        total_amount,
        paid_amount,
        note,
        customers->>'name'
    INTO v_order_total, v_current_paid, v_order_note, v_customer_name
    FROM public.orders
    WHERE id = p_order_id AND company_id = p_company_id
    FOR UPDATE;  -- Lock the row

    IF v_order_total IS NULL THEN
        RAISE EXCEPTION 'Order not found: %', p_order_id;
    END IF;

    -- Calculate new amounts
    v_current_paid := COALESCE(v_current_paid, 0);
    v_next_paid := v_current_paid + p_amount;
    v_next_remaining := GREATEST(v_order_total - v_next_paid, 0);
    v_overpayment := GREATEST(v_next_paid - v_order_total, 0);

    -- 1. Insert payment record
    INSERT INTO public.payments (
        company_id,
        order_id,
        payment_date,
        amount,
        method,
        note
    ) VALUES (
        p_company_id,
        p_order_id,
        v_now,
        p_amount,
        p_payment_method,
        CONCAT(
            COALESCE(p_note, 'Sipariş tahsilatı'),
            CASE WHEN v_overpayment > 0 THEN ' Fazla tahsilat / müşteri alacağı: ' || v_overpayment::text ELSE '' END
        )
    ) RETURNING id INTO v_payment_id;

    -- 2. Insert income record
    INSERT INTO public.income (
        company_id,
        income_date,
        amount,
        payment_method,
        description,
        note,
        source,
        order_id
    ) VALUES (
        p_company_id,
        v_now,
        p_amount,
        p_payment_method,
        'Sipariş tahsilatı - ' || COALESCE(v_customer_name, 'Müşteri'),
        CASE WHEN v_overpayment > 0 THEN 'Fazla tahsilat: ' || v_overpayment::text ELSE NULL END,
        'order_payment',
        p_order_id
    ) RETURNING id INTO v_income_id;

    -- 3. Update order balances
    UPDATE public.orders
    SET
        paid_amount = v_next_paid,
        remaining_amount = v_next_remaining,
        note = CASE
            WHEN v_overpayment > 0 THEN
                CONCAT(v_order_note, E'\n', 'Fazla tahsilat / müşteri alacağı: ' || v_overpayment::text)
            ELSE v_order_note
        END,
        updated_at = v_now
    WHERE id = p_order_id AND company_id = p_company_id;

    -- Return success response
    v_result := json_build_object(
        'success', true,
        'payment_id', v_payment_id,
        'income_id', v_income_id,
        'paid_amount', v_next_paid,
        'remaining_amount', v_next_remaining,
        'overpayment', v_overpayment
    );

    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    -- Return error response
    v_result := json_build_object(
        'success', false,
        'error', SQLERRM,
        'error_code', SQLSTATE
    );
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.record_order_payment IS
'Atomically record customer payment: insert payment record, insert income entry, update order balances. All or nothing.';

-- ============================================================================
-- 2. RECORD INVOICE SAVE (Fatura Kayıt)
-- Atomically: Update/insert invoice, delete old items, insert new items
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_invoice_save(
    p_company_id uuid,
    p_invoice_id uuid,
    p_invoice_data jsonb,
    p_items_data jsonb[]
)
RETURNS json AS $$
DECLARE
    v_result json;
    v_item jsonb;
    v_count integer;
BEGIN
    -- RATE LIMITING: Prevent invoice creation spam (1 per 3 seconds)
    IF NOT public.check_rate_limit('record_invoice_save', 1, 3) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Rate limit exceeded. Please wait 3 seconds before creating another invoice.',
            'invoice_id', NULL
        );
    END IF;

    -- 1. Insert or update invoice header
    INSERT INTO public.invoices (
        id,
        company_id,
        invoice_no,
        invoice_type,
        date,
        total_tax_exclusive,
        total_tax_amount,
        total_tax_inclusive,
        paid_amount,
        payment_method,
        due_date,
        status,
        order_id,
        customer_id,
        supplier_id,
        created_at,
        updated_at
    ) VALUES (
        COALESCE(p_invoice_id, gen_random_uuid()),
        p_company_id,
        p_invoice_data->>'invoice_no',
        p_invoice_data->>'invoice_type',
        (p_invoice_data->>'date')::timestamptz,
        (p_invoice_data->>'total_tax_exclusive')::numeric,
        (p_invoice_data->>'total_tax_amount')::numeric,
        (p_invoice_data->>'total_tax_inclusive')::numeric,
        (p_invoice_data->>'paid_amount')::numeric,
        p_invoice_data->>'payment_method',
        (p_invoice_data->>'due_date')::timestamptz,
        p_invoice_data->>'status',
        (p_invoice_data->>'order_id')::uuid,
        (p_invoice_data->>'customer_id')::uuid,
        (p_invoice_data->>'supplier_id')::uuid,
        now(),
        now()
    )
    ON CONFLICT (id) DO UPDATE SET
        invoice_no = EXCLUDED.invoice_no,
        total_tax_exclusive = EXCLUDED.total_tax_exclusive,
        total_tax_amount = EXCLUDED.total_tax_amount,
        total_tax_inclusive = EXCLUDED.total_tax_inclusive,
        paid_amount = EXCLUDED.paid_amount,
        payment_method = EXCLUDED.payment_method,
        due_date = EXCLUDED.due_date,
        status = EXCLUDED.status,
        updated_at = now()
    RETURNING id INTO p_invoice_id;

    -- 2. Delete existing items
    DELETE FROM public.invoice_items
    WHERE invoice_id = p_invoice_id;

    -- 3. Insert new items
    v_count := 0;
    FOREACH v_item IN ARRAY p_items_data LOOP
        INSERT INTO public.invoice_items (
            invoice_id,
            description,
            quantity,
            unit_price,
            tax_rate,
            line_total
        ) VALUES (
            p_invoice_id,
            v_item->>'description',
            (v_item->>'quantity')::numeric,
            (v_item->>'unit_price')::numeric,
            (v_item->>'tax_rate')::numeric,
            (v_item->>'line_total')::numeric
        );
        v_count := v_count + 1;
    END LOOP;

    v_result := json_build_object(
        'success', true,
        'invoice_id', p_invoice_id,
        'items_saved', v_count
    );

    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    v_result := json_build_object(
        'success', false,
        'error', SQLERRM,
        'error_code', SQLSTATE
    );
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.record_invoice_save IS
'Atomically save invoice: insert/update header, delete old items, insert new items. All or nothing.';

-- ============================================================================
-- 3. RECORD INCOME ENTRY (Gelir Kaydı)
-- Atomically: Insert income, insert transaction log
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_income_entry(
    p_company_id uuid,
    p_income_date timestamptz,
    p_amount numeric,
    p_payment_method text DEFAULT NULL,
    p_description text DEFAULT NULL,
    p_note text DEFAULT NULL,
    p_source text DEFAULT 'manual',
    p_order_id uuid DEFAULT NULL,
    p_create_transaction bool DEFAULT false
)
RETURNS json AS $$
DECLARE
    v_income_id uuid;
    v_transaction_id uuid;
    v_result json;
BEGIN
    -- RATE LIMITING: Allow bulk income entry, prevent spam (3 per 5 seconds)
    IF NOT public.check_rate_limit('record_income_entry', 3, 5) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Rate limit exceeded. Please wait before creating more income entries.',
            'income_id', NULL
        );
    END IF;

    -- 1. Insert income record
    INSERT INTO public.income (
        company_id,
        income_date,
        amount,
        payment_method,
        description,
        note,
        source,
        order_id,
        created_at
    ) VALUES (
        p_company_id,
        p_income_date,
        p_amount,
        p_payment_method,
        p_description,
        p_note,
        p_source,
        p_order_id,
        now()
    ) RETURNING id INTO v_income_id;

    -- 2. Optionally insert transaction log entry
    IF p_create_transaction THEN
        INSERT INTO public.transactions (
            company_id,
            transaction_type,
            amount,
            description,
            reference_table,
            reference_id,
            transaction_date,
            created_at
        ) VALUES (
            p_company_id,
            'income',
            p_amount,
            p_description,
            'income',
            v_income_id,
            p_income_date,
            now()
        ) RETURNING id INTO v_transaction_id;
    END IF;

    v_result := json_build_object(
        'success', true,
        'income_id', v_income_id,
        'transaction_id', v_transaction_id
    );

    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    v_result := json_build_object(
        'success', false,
        'error', SQLERRM,
        'error_code', SQLSTATE
    );
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.record_income_entry IS
'Atomically record income: insert income, optionally insert transaction log. All or nothing.';

-- ============================================================================
-- 4. RECORD EXPENSE ENTRY (Gider Kaydı)
-- Atomically: Insert expense, insert transaction log if paid
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_expense_entry(
    p_company_id uuid,
    p_expense_date timestamptz,
    p_amount numeric,
    p_category text DEFAULT NULL,
    p_description text DEFAULT NULL,
    p_note text DEFAULT NULL,
    p_payment_method text DEFAULT NULL,
    p_status text DEFAULT 'pending',
    p_supplier_id uuid DEFAULT NULL,
    p_create_transaction bool DEFAULT false
)
RETURNS json AS $$
DECLARE
    v_expense_id uuid;
    v_transaction_id uuid;
    v_result json;
BEGIN
    -- RATE LIMITING: Allow bulk expense entry, prevent spam (3 per 5 seconds)
    IF NOT public.check_rate_limit('record_expense_entry', 3, 5) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Rate limit exceeded. Please wait before creating more expense entries.',
            'expense_id', NULL
        );
    END IF;

    -- 1. Insert expense record
    INSERT INTO public.expenses (
        company_id,
        expense_date,
        amount,
        category,
        description,
        note,
        payment_method,
        status,
        supplier_id,
        created_at
    ) VALUES (
        p_company_id,
        p_expense_date,
        p_amount,
        p_category,
        p_description,
        p_note,
        p_payment_method,
        p_status,
        p_supplier_id,
        now()
    ) RETURNING id INTO v_expense_id;

    -- 2. Optionally insert transaction log entry
    IF p_create_transaction THEN
        INSERT INTO public.transactions (
            company_id,
            transaction_type,
            amount,
            description,
            reference_table,
            reference_id,
            transaction_date,
            created_at
        ) VALUES (
            p_company_id,
            'expense',
            p_amount,
            p_description,
            'expenses',
            v_expense_id,
            p_expense_date,
            now()
        ) RETURNING id INTO v_transaction_id;
    END IF;

    v_result := json_build_object(
        'success', true,
        'expense_id', v_expense_id,
        'transaction_id', v_transaction_id
    );

    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    v_result := json_build_object(
        'success', false,
        'error', SQLERRM,
        'error_code', SQLSTATE
    );
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.record_expense_entry IS
'Atomically record expense: insert expense, optionally insert transaction log. All or nothing.';

-- ============================================================================
-- 5. RECORD INSTALLER PAYMENT (Montajcı Ödeme Kaydı)
-- Atomically: Insert expense (payment record), insert installer_transactions
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_installer_payment(
    p_company_id uuid,
    p_installer_id uuid,
    p_amount numeric,
    p_payment_date timestamptz DEFAULT NULL,
    p_description text DEFAULT NULL,
    p_note text DEFAULT NULL
)
RETURNS json AS $$
DECLARE
    v_expense_id uuid;
    v_transaction_id uuid;
    v_payment_date timestamptz;
    v_result json;
BEGIN
    v_payment_date := COALESCE(p_payment_date, now());

    -- RATE LIMITING: Prevent duplicate installer payment submissions (1 per 5 seconds)
    IF NOT public.check_rate_limit('record_installer_payment', 1, 5) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Rate limit exceeded. Please wait 5 seconds before the next installer payment.',
            'payment_id', NULL
        );
    END IF;

    -- 1. Insert expense record (for payment tracking)
    INSERT INTO public.expenses (
        company_id,
        expense_date,
        amount,
        category,
        description,
        note,
        status,
        created_at
    ) VALUES (
        p_company_id,
        v_payment_date,
        p_amount,
        'installer_payment',
        COALESCE(p_description, 'Montajcı Ödemesi'),
        p_note,
        'paid',
        now()
    ) RETURNING id INTO v_expense_id;

    -- 2. Insert installer_transactions record
    INSERT INTO public.installer_transactions (
        company_id,
        installer_id,
        transaction_type,
        amount,
        description,
        transaction_date,
        expense_id,
        created_at
    ) VALUES (
        p_company_id,
        p_installer_id,
        'payment',
        p_amount,
        COALESCE(p_description, 'Montajcı Ödemesi'),
        v_payment_date,
        v_expense_id,
        now()
    ) RETURNING id INTO v_transaction_id;

    v_result := json_build_object(
        'success', true,
        'expense_id', v_expense_id,
        'transaction_id', v_transaction_id
    );

    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    v_result := json_build_object(
        'success', false,
        'error', SQLERRM,
        'error_code', SQLSTATE
    );
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.record_installer_payment IS
'Atomically record installer payment: insert expense, insert installer_transactions. All or nothing.';

-- ============================================================================
-- 6. CANCEL INSTALLER PAYMENT (Montajcı Ödeme İptali)
-- Atomically: Insert cancel transaction, delete linked expense
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cancel_installer_payment(
    p_company_id uuid,
    p_transaction_id uuid,
    p_reason text DEFAULT NULL
)
RETURNS json AS $$
DECLARE
    v_expense_id uuid;
    v_installer_id uuid;
    v_amount numeric;
    v_cancel_transaction_id uuid;
    v_result json;
BEGIN
    -- RATE LIMITING: Prevent duplicate cancellation submissions (1 per 5 seconds)
    IF NOT public.check_rate_limit('cancel_installer_payment', 1, 5) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Rate limit exceeded. Please wait 5 seconds before cancelling another payment.',
            'transaction_id', NULL
        );
    END IF;

    -- Get the payment transaction details
    SELECT installer_id, amount, expense_id
    INTO v_installer_id, v_amount, v_expense_id
    FROM public.installer_transactions
    WHERE id = p_transaction_id AND company_id = p_company_id AND transaction_type = 'payment'
    FOR UPDATE;

    IF v_installer_id IS NULL THEN
        RAISE EXCEPTION 'Payment transaction not found: %', p_transaction_id;
    END IF;

    -- 1. Insert cancel transaction
    INSERT INTO public.installer_transactions (
        company_id,
        installer_id,
        transaction_type,
        amount,
        description,
        transaction_date,
        parent_transaction_id,
        created_at
    ) VALUES (
        p_company_id,
        v_installer_id,
        'payment_cancel',
        v_amount,
        COALESCE(p_reason, 'Ödeme iptal edildi'),
        now(),
        p_transaction_id,
        now()
    ) RETURNING id INTO v_cancel_transaction_id;

    -- 2. Delete linked expense
    DELETE FROM public.expenses
    WHERE id = v_expense_id AND company_id = p_company_id;

    v_result := json_build_object(
        'success', true,
        'cancel_transaction_id', v_cancel_transaction_id,
        'expense_id', v_expense_id
    );

    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    v_result := json_build_object(
        'success', false,
        'error', SQLERRM,
        'error_code', SQLSTATE
    );
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.cancel_installer_payment IS
'Atomically cancel installer payment: insert cancel transaction, delete linked expense. All or nothing.';

-- ============================================================================
-- 7. UPDATE INSTALLATION COMPLETION (Montaj Tamamlama)
-- Atomically: Update job status, create earnings, update order status
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_installation_completion(
    p_company_id uuid,
    p_job_id uuid,
    p_new_status text,
    p_order_id uuid DEFAULT NULL,
    p_order_new_status text DEFAULT NULL
)
RETURNS json AS $$
DECLARE
    v_result json;
    v_job_updated_at timestamptz;
BEGIN
    -- RATE LIMITING: Prevent rapid installation status changes (1 per 3 seconds)
    IF NOT public.check_rate_limit('update_installation_completion', 1, 3) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Rate limit exceeded. Please wait 3 seconds before updating another installation.'
        );
    END IF;

    -- 1. Update installation job status
    UPDATE public.installation_jobs
    SET
        status = p_new_status,
        completion_timestamp = CASE
            WHEN p_new_status = 'installation_completed' THEN now()
            ELSE completion_timestamp
        END,
        updated_at = now()
    WHERE id = p_job_id AND company_id = p_company_id
    RETURNING updated_at INTO v_job_updated_at;

    -- 2. Conditionally update order status
    IF p_order_id IS NOT NULL AND p_order_new_status IS NOT NULL THEN
        UPDATE public.orders
        SET
            status = p_order_new_status,
            updated_at = now()
        WHERE id = p_order_id AND company_id = p_company_id;
    END IF;

    -- Note: Earnings are created via trigger on_installation_job_completed
    -- No need to create them here

    v_result := json_build_object(
        'success', true,
        'job_id', p_job_id,
        'new_status', p_new_status,
        'updated_at', v_job_updated_at
    );

    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    v_result := json_build_object(
        'success', false,
        'error', SQLERRM,
        'error_code', SQLSTATE
    );
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.update_installation_completion IS
'Atomically update installation completion: update job status, trigger earnings, optionally update order. All or nothing.';

-- ============================================================================
-- 8. RECORD SUPPLIER PAYMENT (Tedarikçi Ödeme Kaydı)
-- Atomically: Insert payment transaction, optionally update debt due_date,
-- insert supplier_payments, insert expense, insert transaction log
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_supplier_payment(
    p_company_id uuid,
    p_supplier_id uuid,
    p_amount numeric,
    p_payment_method text DEFAULT NULL,
    p_description text DEFAULT NULL,
    p_payment_date timestamptz DEFAULT NULL,
    p_update_due_date bool DEFAULT false,
    p_new_due_date timestamptz DEFAULT NULL
)
RETURNS json AS $$
DECLARE
    v_payment_date timestamptz;
    v_supplier_transaction_id uuid;
    v_payment_id uuid;
    v_expense_id uuid;
    v_transaction_id uuid;
    v_result json;
BEGIN
    v_payment_date := COALESCE(p_payment_date, now());

    -- RATE LIMITING: Prevent duplicate supplier payment submissions (1 per 5 seconds)
    IF NOT public.check_rate_limit('record_supplier_payment', 1, 5) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Rate limit exceeded. Please wait 5 seconds before the next supplier payment.',
            'payment_id', NULL
        );
    END IF;

    -- 1. Insert supplier_transactions (payment deduction)
    INSERT INTO public.supplier_transactions (
        company_id,
        supplier_id,
        transaction_type,
        amount,
        description,
        transaction_date,
        created_at
    ) VALUES (
        p_company_id,
        p_supplier_id,
        'payment',
        p_amount,
        COALESCE(p_description, 'Tedarikçi Ödemesi'),
        v_payment_date,
        now()
    ) RETURNING id INTO v_supplier_transaction_id;

    -- 2. Optionally update debt due_date
    IF p_update_due_date THEN
        WITH cte_to_update AS (
            SELECT id FROM public.supplier_transactions
            WHERE
                company_id = p_company_id
                AND supplier_id = p_supplier_id
                AND transaction_type = 'debt'
                AND status = 'pending'
            LIMIT 1
        )
        UPDATE public.supplier_transactions
        SET due_date = p_new_due_date
        WHERE id IN (SELECT id FROM cte_to_update);
    END IF;

    -- 3. Insert supplier_payments record
    INSERT INTO public.supplier_payments (
        company_id,
        supplier_id,
        amount,
        payment_method,
        payment_date,
        description,
        created_at
    ) VALUES (
        p_company_id,
        p_supplier_id,
        p_amount,
        p_payment_method,
        v_payment_date,
        COALESCE(p_description, 'Tedarikçi Ödemesi'),
        now()
    ) RETURNING id INTO v_payment_id;

    -- 4. Insert expense record
    INSERT INTO public.expenses (
        company_id,
        expense_date,
        amount,
        category,
        description,
        payment_method,
        status,
        supplier_id,
        created_at
    ) VALUES (
        p_company_id,
        v_payment_date,
        p_amount,
        'supplier_payment',
        COALESCE(p_description, 'Tedarikçi Ödemesi'),
        p_payment_method,
        'paid',
        p_supplier_id,
        now()
    ) RETURNING id INTO v_expense_id;

    -- 5. Insert transaction log
    INSERT INTO public.transactions (
        company_id,
        transaction_type,
        amount,
        description,
        reference_table,
        reference_id,
        transaction_date,
        created_at
    ) VALUES (
        p_company_id,
        'supplier_payment',
        p_amount,
        COALESCE(p_description, 'Tedarikçi Ödemesi'),
        'supplier_payments',
        v_payment_id,
        v_payment_date,
        now()
    ) RETURNING id INTO v_transaction_id;

    v_result := json_build_object(
        'success', true,
        'supplier_transaction_id', v_supplier_transaction_id,
        'payment_id', v_payment_id,
        'expense_id', v_expense_id,
        'transaction_id', v_transaction_id
    );

    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    v_result := json_build_object(
        'success', false,
        'error', SQLERRM,
        'error_code', SQLSTATE
    );
    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION public.record_supplier_payment IS
'Atomically record supplier payment: insert supplier transaction, optionally update debt due_date, insert payment, insert expense, insert transaction log. All or nothing.';

-- ============================================================================
-- GRANT EXECUTE PERMISSIONS
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.record_order_payment TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_invoice_save TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_income_entry TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_expense_entry TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_installer_payment TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_installer_payment TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_installation_completion TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_supplier_payment TO authenticated;

-- ============================================================================
-- END PAYMENT TRANSACTION SAFETY MIGRATION
-- ============================================================================
