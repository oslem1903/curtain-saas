-- ============================================================================
-- RPC: add_manual_installer_earning
-- ============================================================================
-- Purpose: Create manual earnings with idempotency replay support
-- Atomicity: Single transaction for earnings + transaction records
-- Authorization: Admin/super_admin only, active subscription required

CREATE OR REPLACE FUNCTION public.add_manual_installer_earning(
    p_company_id uuid,
    p_installer_id uuid,
    p_amount numeric,
    p_earning_date date,
    p_description text DEFAULT NULL,
    p_idempotency_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_existing_earning RECORD;
    v_earning_id uuid;
    v_transaction_id uuid;
    v_automatic_earned numeric;
    v_manual_earned numeric;
    v_paid numeric;
    v_new_balance numeric;
BEGIN
    -- ========================================================================
    -- STEP 1: AUTHORIZATION
    -- ========================================================================
    IF NOT (
        p_company_id IN (SELECT public.my_company_ids())
        OR public.is_super_admin()
    ) THEN
        RAISE EXCEPTION 'unauthorized: bu firmaya erişim yok';
    END IF;

    IF NOT public.check_subscription_active(p_company_id) THEN
        RAISE EXCEPTION 'unauthorized: firma lisansi/deneme süresi aktif değil';
    END IF;

    -- ========================================================================
    -- STEP 2: INPUT VALIDATION
    -- ========================================================================
    IF p_installer_id IS NULL THEN
        RAISE EXCEPTION 'invalid_reference: installer_id gerekli';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'invalid_amount: tutar sıfırdan büyük olmalı';
    END IF;

    IF p_earning_date IS NULL THEN
        RAISE EXCEPTION 'invalid_reference: tarih gerekli';
    END IF;

    IF p_earning_date > CURRENT_DATE THEN
        RAISE EXCEPTION 'invalid_amount: tarih gelecekte olamaz';
    END IF;

    -- ========================================================================
    -- STEP 3: IDEMPOTENCY REPLAY
    -- ========================================================================
    -- If p_idempotency_key provided, check for existing record
    IF p_idempotency_key IS NOT NULL THEN
        SELECT *
        INTO v_existing_earning
        FROM public.installer_earnings
        WHERE company_id = p_company_id
          AND idempotency_key = p_idempotency_key
        LIMIT 1;

        IF FOUND THEN
            -- Existing record found: return its data with already_existed=true
            -- Recalculate current balance for this installer

            -- Automatic earned (from completed jobs)
            SELECT COALESCE(SUM(installer_fee), 0)
            INTO v_automatic_earned
            FROM public.installation_jobs
            WHERE assigned_staff_id = p_installer_id
              AND status = 'completed'
              AND company_id = p_company_id;

            -- Manual earned (earning_type='manual' only)
            SELECT COALESCE(SUM(total_earning), 0)
            INTO v_manual_earned
            FROM public.installer_earnings
            WHERE installer_id = p_installer_id
              AND company_id = p_company_id
              AND earning_type = 'manual'
              AND installation_job_id IS NULL;

            -- Paid (exclude 'earning' type transactions)
            SELECT COALESCE(SUM(
                CASE
                    WHEN transaction_type = 'payment' THEN amount
                    WHEN transaction_type = 'cancel' THEN -amount
                    ELSE 0
                END
            ), 0)
            INTO v_paid
            FROM public.installer_transactions
            WHERE installer_id = p_installer_id
              AND company_id = p_company_id
              AND transaction_type NOT IN ('earning');

            v_new_balance := GREATEST(v_automatic_earned + v_manual_earned - v_paid, 0);

            RETURN jsonb_build_object(
                'earning_id', v_existing_earning.id,
                'transaction_id', (
                    SELECT id FROM public.installer_transactions
                    WHERE earning_id = v_existing_earning.id
                    LIMIT 1
                ),
                'installer_id', p_installer_id,
                'amount', v_existing_earning.total_earning,
                'balance', v_new_balance,
                'already_existed', true,
                'status', 'success'
            );
        END IF;
    END IF;

    -- ========================================================================
    -- STEP 4: CREATE EARNINGS RECORD
    -- ========================================================================
    INSERT INTO public.installer_earnings (
        company_id,
        installer_id,
        installation_job_id,
        order_id,
        earning_type,
        total_earning,
        job_completed_date,
        quantity_earning,
        area_earning,
        manual_earning,
        idempotency_key,
        metadata
    ) VALUES (
        p_company_id,
        p_installer_id,
        NULL,                          -- Manual earning: no job
        NULL,                          -- Manual earning: no order (nullable)
        'manual',                       -- earning_type = 'manual'
        p_amount,                       -- total_earning
        p_earning_date::timestamptz,   -- job_completed_date = earning date
        0, 0, p_amount,                 -- quantity/area/manual breakdown
        p_idempotency_key,              -- idempotency_key for replay detection
        jsonb_build_object(
            'type', 'manual',
            'description', p_description,
            'created_via_rpc', 'add_manual_installer_earning'
        )
    )
    RETURNING id INTO v_earning_id;

    -- ========================================================================
    -- STEP 5: CREATE TRANSACTION RECORD
    -- ========================================================================
    INSERT INTO public.installer_transactions (
        company_id,
        installer_id,
        transaction_date,
        transaction_type,
        amount,
        description,
        earning_id,
        related_job_id,
        earning_type
    ) VALUES (
        p_company_id,
        p_installer_id,
        now(),
        'earning',                      -- transaction_type = 'earning'
        p_amount,
        COALESCE(p_description, 'Manuel hakediş'),
        v_earning_id,                   -- Link back to earnings record
        NULL,                           -- Manual earning: no job
        'manual'                        -- earning_type = 'manual'
    )
    RETURNING id INTO v_transaction_id;

    -- ========================================================================
    -- STEP 6: CALCULATE NEW BALANCE (EXACT PRODUCTION FORMULA)
    -- ========================================================================
    -- Automatic earned = sum of completed job fees (canonical source)
    SELECT COALESCE(SUM(installer_fee), 0)
    INTO v_automatic_earned
    FROM public.installation_jobs
    WHERE assigned_staff_id = p_installer_id
      AND status = 'completed'
      AND company_id = p_company_id;

    -- Manual earned = sum of manual earnings only
    SELECT COALESCE(SUM(total_earning), 0)
    INTO v_manual_earned
    FROM public.installer_earnings
    WHERE installer_id = p_installer_id
      AND company_id = p_company_id
      AND earning_type = 'manual'
      AND installation_job_id IS NULL;

    -- Paid = exact production formula (exclude 'earning' type)
    SELECT COALESCE(SUM(
        CASE
            WHEN transaction_type = 'payment' THEN amount
            WHEN transaction_type = 'cancel' THEN -amount
            ELSE 0
        END
    ), 0)
    INTO v_paid
    FROM public.installer_transactions
    WHERE installer_id = p_installer_id
      AND company_id = p_company_id
      AND transaction_type NOT IN ('earning');

    v_new_balance := GREATEST(v_automatic_earned + v_manual_earned - v_paid, 0);

    -- ========================================================================
    -- STEP 7: RETURN SUCCESS
    -- ========================================================================
    RETURN jsonb_build_object(
        'earning_id', v_earning_id,
        'transaction_id', v_transaction_id,
        'installer_id', p_installer_id,
        'amount', p_amount,
        'balance', v_new_balance,
        'already_existed', false,
        'status', 'success'
    );

END;
$$;

GRANT EXECUTE ON FUNCTION public.add_manual_installer_earning(
    uuid, uuid, numeric, date, text, text
) TO authenticated;

COMMENT ON FUNCTION public.add_manual_installer_earning IS
'Create manual earnings record for montajcı. Supports idempotency replay.
Parameters:
  p_company_id: Company UUID
  p_installer_id: Installer UUID
  p_amount: Earning amount (must be > 0)
  p_earning_date: When earnings were earned (date, not in future)
  p_description: Optional description (e.g., "Extra erbium perdesi")
  p_idempotency_key: Optional UUID for duplicate prevention

Returns JSON:
  earning_id, transaction_id, installer_id, amount, balance, already_existed, status

Authorization: Admin/super_admin only, active subscription required

Example:
  SELECT add_manual_installer_earning(
    ''550e8400-e29b-41d4-a716-446655440000''::uuid,  -- company_id
    ''6ba7b810-9dad-11d1-80b4-00c04fd430c8''::uuid,  -- installer_id
    500,                                               -- amount
    CURRENT_DATE,                                      -- earning_date
    ''Extra curtain installation''                     -- description
  );
';
