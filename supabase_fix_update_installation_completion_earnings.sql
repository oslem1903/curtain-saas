-- ============================================================================
-- MIGRATION: Fix update_installation_completion() to Create Earnings
-- DATE: 2026-07-11 (FINAL: Atomicity + Canonical Status)
-- STATUS: Analysis & Code Ready (NOT Applied to Production)
-- ============================================================================
-- PURPOSE: Extend update_installation_completion() to automatically create
-- installer_earnings and installer_transactions records when installation
-- job is marked as 'completed'.
--
-- CHANGES:
-- 1. Only canonical status: 'completed' (no installation_completed support)
-- 2. Atomicity: exception raises (no JSON error in exception handler)
-- 3. Fixed installer_transactions INSERT (schema alignment)
-- 4. Pre-check queries A1-A6 (before deployment validation)
-- 5. UNIQUE constraint on (company_id, installation_job_id)
--
-- BACKWARD COMPATIBILITY: ✅
-- - Function signature unchanged (uuid, uuid, text, uuid, text)
-- - Return type unchanged (JSON)
-- - Frontend must call RPC for completion path
--
-- ATOMICITY: ✅
-- - All writes atomic: success returns JSON, any error raises exception
-- - Transaction rollback automatic on exception
-- ============================================================================

BEGIN TRANSACTION;

-- ============================================================================
-- PRE-DEPLOYMENT VALIDATION QUERIES (Run on production BEFORE migration)
-- ============================================================================

-- A1: Check for duplicate installer_earnings
DO $$
DECLARE
    v_duplicate_count integer;
BEGIN
    SELECT COUNT(*)
    INTO v_duplicate_count
    FROM (
        SELECT company_id, installation_job_id
        FROM public.installer_earnings
        WHERE installation_job_id IS NOT NULL
        GROUP BY company_id, installation_job_id
        HAVING COUNT(*) > 1
    ) dupes;

    IF v_duplicate_count > 0 THEN
        RAISE EXCEPTION 'PRE-CHECK FAILED: Found % duplicate (company_id, installation_job_id) pairs. Manual cleanup required.', v_duplicate_count;
    END IF;
    RAISE NOTICE 'PRE-CHECK A1 PASSED: No duplicates found';
END;
$$;

-- A2: Verify calculate_commission_for_job exists
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'calculate_commission_for_job'
    ) THEN
        RAISE EXCEPTION 'PRE-CHECK FAILED: calculate_commission_for_job() function not found.';
    END IF;
    RAISE NOTICE 'PRE-CHECK A2 PASSED: calculate_commission_for_job exists';
END;
$$;

-- A3: Verify installer_earnings table columns
DO $$
DECLARE
    v_column_count integer;
BEGIN
    SELECT COUNT(*)
    INTO v_column_count
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'installer_earnings'
    AND column_name IN ('id', 'company_id', 'installer_id', 'installation_job_id', 'order_id',
                        'job_completed_date', 'earning_type', 'quantity', 'area_m2', 'quantity_rate',
                        'area_rate', 'quantity_earning', 'area_earning', 'manual_earning', 'total_earning');

    IF v_column_count < 15 THEN
        RAISE EXCEPTION 'PRE-CHECK FAILED: installer_earnings missing required columns.';
    END IF;
    RAISE NOTICE 'PRE-CHECK A3 PASSED: installer_earnings schema OK';
END;
$$;

-- A4: Verify installer_transactions table columns
DO $$
DECLARE
    v_column_count integer;
BEGIN
    SELECT COUNT(*)
    INTO v_column_count
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'installer_transactions'
    AND column_name IN ('id', 'company_id', 'installer_id', 'transaction_date', 'transaction_type', 'amount', 'description');

    IF v_column_count < 7 THEN
        RAISE EXCEPTION 'PRE-CHECK FAILED: installer_transactions missing required columns.';
    END IF;
    RAISE NOTICE 'PRE-CHECK A4 PASSED: installer_transactions schema OK';
END;
$$;

-- A5: Check UNIQUE constraint status
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public' AND table_name = 'installer_earnings'
        AND constraint_name = 'installer_earnings_company_job_unique'
    ) THEN
        RAISE NOTICE 'PRE-CHECK A5 PASSED: Constraint does not exist, will be created';
    ELSE
        RAISE NOTICE 'INFO A5: UNIQUE constraint already exists, skipping creation';
    END IF;
END;
$$;

-- A6: Verify authorization functions
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'is_super_admin') THEN
        RAISE EXCEPTION 'PRE-CHECK FAILED: is_super_admin() function not found.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'is_company_admin') THEN
        RAISE EXCEPTION 'PRE-CHECK FAILED: is_company_admin() function not found.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'is_company_accounting') THEN
        RAISE EXCEPTION 'PRE-CHECK FAILED: is_company_accounting() function not found.';
    END IF;
    RAISE NOTICE 'PRE-CHECK A6 PASSED: All authorization functions exist';
END;
$$;

-- ============================================================================
-- STEP 1: ADD UNIQUE CONSTRAINT
-- ============================================================================
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_schema = 'public' AND table_name = 'installer_earnings'
        AND constraint_name = 'installer_earnings_company_job_unique'
    ) THEN
        ALTER TABLE public.installer_earnings
        ADD CONSTRAINT installer_earnings_company_job_unique
        UNIQUE (company_id, installation_job_id);
        RAISE NOTICE 'CONSTRAINT CREATED: installer_earnings_company_job_unique';
    END IF;
END;
$$;

-- ============================================================================
-- STEP 2: ENHANCED FUNCTION - update_installation_completion()
-- ============================================================================
-- ATOMICITY DESIGN:
--   1. Security checks + input validation (no writes)
--   2. Pre-check queries (SELECT only, with row lock)
--   3. WRITE OPERATIONS (if any error → exception → transaction rollback)
--   4. Exception raises automatically (atomicity guaranteed)
--   5. No partial state possible
--   6. Return JSON only on success
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_installation_completion(
    p_company_id uuid,
    p_job_id uuid,
    p_new_status text,
    p_order_id uuid DEFAULT NULL,
    p_order_new_status text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_installer_id uuid;
    v_order_id uuid;
    v_commission_row record;
    v_earning_id uuid;
    v_transaction_id uuid;
BEGIN
    -- ========================================================================
    -- SECURITY: Verify authorization
    -- ========================================================================

    -- Authorization: Only super_admin, company_admin, or company_accounting
    IF NOT (
        public.is_super_admin()
        OR public.is_company_admin(p_company_id)
        OR public.is_company_accounting(p_company_id)
    ) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Not authorized. Only owner/admin/accountant can complete installations.',
            'required_role', 'admin|accountant'
        );
    END IF;

    -- ========================================================================
    -- RATE LIMITING: Prevent rapid completion spam
    -- ========================================================================
    IF NOT public.check_rate_limit('update_installation_completion', 1, 3) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Rate limit exceeded. Please wait 3 seconds before updating another installation.'
        );
    END IF;

    -- ========================================================================
    -- VALIDATION: Input validation before any modifications
    -- ========================================================================

    -- Canonical status: only 'completed' accepted
    IF p_new_status NOT IN ('completed', 'onway', 'planned', 'assigned', 'waiting') THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Invalid status value',
            'provided_status', p_new_status,
            'allowed_values', ARRAY['waiting', 'planned', 'assigned', 'onway', 'completed']
        );
    END IF;

    -- ========================================================================
    -- PRE-CHECKS: Read-only validations (no modifications yet)
    -- ========================================================================

    -- 1. Get installation job (with row-level lock to prevent concurrent updates)
    SELECT
        id,
        assigned_staff_id,
        order_id
    INTO
        p_job_id,
        v_installer_id,
        v_order_id
    FROM public.installation_jobs
    WHERE id = p_job_id AND company_id = p_company_id
    FOR UPDATE;  -- Row-level lock prevents concurrent modifications

    IF p_job_id IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Installation job not found',
            'job_id', p_job_id
        );
    END IF;

    -- 2. Check if installer is assigned (only for completion status)
    IF p_new_status = 'completed' AND v_installer_id IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Installer not assigned to this job. Cannot mark as completed.',
            'required_field', 'assigned_staff_id'
        );
    END IF;

    -- 3. Check for duplicate earnings (only for completion)
    IF p_new_status = 'completed' THEN
        IF EXISTS (
            SELECT 1 FROM public.installer_earnings
            WHERE installation_job_id = p_job_id
            LIMIT 1
        ) THEN
            RETURN json_build_object(
                'success', false,
                'error', 'Earnings already created for this job',
                'note', 'Double-creation prevented by UNIQUE constraint'
            );
        END IF;
    END IF;

    -- ========================================================================
    -- WRITE OPERATIONS: All-or-Nothing via Exception
    -- ========================================================================
    -- If ANY operation fails, exception raised → transaction rollback
    -- Client receives error (not JSON), atomicity guaranteed
    -- ========================================================================

    -- 4. UPDATE installation_jobs status
    UPDATE public.installation_jobs
    SET
        status = p_new_status,
        completion_timestamp = CASE
            WHEN p_new_status = 'completed' THEN now()
            ELSE completion_timestamp
        END,
        updated_at = now()
    WHERE id = p_job_id AND company_id = p_company_id;

    -- 5. CREATE EARNINGS (only for completion status)
    IF p_new_status = 'completed' AND v_installer_id IS NOT NULL THEN

        -- 5a. Call calculate_commission_for_job to get earnings details
        SELECT * INTO v_commission_row
        FROM public.calculate_commission_for_job(
            p_job_id,
            v_installer_id,
            p_company_id
        );

        -- Validate commission result
        IF v_commission_row IS NULL THEN
            RAISE EXCEPTION 'calculate_commission_for_job returned NULL result for job %', p_job_id;
        END IF;

        -- 5b. INSERT installer_earnings record
        INSERT INTO public.installer_earnings (
            company_id,
            installer_id,
            installation_job_id,
            order_id,
            job_completed_date,
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
            p_company_id,
            v_installer_id,
            p_job_id,
            v_order_id,
            now(),
            COALESCE(v_commission_row.calculation_details->>'type', 'quantity'),
            (v_commission_row.calculation_details->>'quantity')::numeric,
            (v_commission_row.calculation_details->>'area_m2')::numeric,
            (v_commission_row.calculation_details->>'quantity_rate')::numeric,
            (v_commission_row.calculation_details->>'area_rate')::numeric,
            v_commission_row.quantity_earning,
            v_commission_row.area_earning,
            v_commission_row.manual_earning,
            v_commission_row.total_earning,
            v_commission_row.calculation_details
        )
        RETURNING id INTO v_earning_id;

        -- 5c. INSERT installer_transactions record
        INSERT INTO public.installer_transactions (
            company_id,
            installer_id,
            transaction_date,
            transaction_type,
            amount,
            description
        ) VALUES (
            p_company_id,
            v_installer_id,
            now(),
            'earning',
            v_commission_row.total_earning,
            'Montaj tamamlandı - Hakediş otomatik oluşturuldu'
        )
        RETURNING id INTO v_transaction_id;
    END IF;

    -- 6. UPDATE orders status (if provided)
    IF v_order_id IS NOT NULL AND p_order_new_status IS NOT NULL THEN
        UPDATE public.orders
        SET
            status = p_order_new_status,
            updated_at = now()
        WHERE id = v_order_id AND company_id = p_company_id;
    END IF;

    -- ========================================================================
    -- RETURN SUCCESS RESPONSE (only reached if all writes succeed)
    -- ========================================================================

    RETURN json_build_object(
        'success', true,
        'job_id', p_job_id,
        'new_status', p_new_status,
        'earning_id', v_earning_id,
        'transaction_id', v_transaction_id,
        'total_earning', COALESCE(v_commission_row.total_earning, 0),
        'updated_at', now()
    );

EXCEPTION WHEN OTHERS THEN
    -- Any write error → transaction automatically rolled back by PostgreSQL
    -- Re-raise exception so client receives error (not successful JSON)
    RAISE;
END;
$$;

-- ============================================================================
-- STEP 3: GRANT PERMISSIONS
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.update_installation_completion(uuid, uuid, text, uuid, text)
TO authenticated;

-- ============================================================================
-- STEP 4: UPDATE FUNCTION COMMENT
-- ============================================================================

COMMENT ON FUNCTION public.update_installation_completion(uuid, uuid, text, uuid, text) IS
'Atomically complete installation: update job status, create earnings via calculate_commission_for_job(), '
'insert earnings and transaction records, optionally update order. All operations atomic: all succeed or all fail. '
'Authorization: admin or accountant role required. Rate limited: 1 completion per 3 seconds.';

-- ============================================================================
-- END TRANSACTION
-- ============================================================================

COMMIT;

-- ============================================================================
-- NOTIFICATION FOR SCHEMA CACHE INVALIDATION
-- ============================================================================

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- POST-MIGRATION VERIFICATION QUERIES
-- ============================================================================
-- 1. Verify function signature unchanged:
--    SELECT pg_get_functiondef('public.update_installation_completion(uuid,uuid,text,uuid,text)'::regprocedure);
--
-- 2. Verify UNIQUE constraint exists:
--    SELECT constraint_name FROM information_schema.table_constraints
--    WHERE table_schema='public' AND table_name='installer_earnings'
--    AND constraint_name='installer_earnings_company_job_unique';
--
-- 3. Test basic call (production):
--    SELECT public.update_installation_completion(
--        'company_id'::uuid, 'job_id'::uuid, 'completed',
--        'order_id'::uuid, 'montaj_tamamlandi'
--    );
-- ============================================================================
