-- ============================================================================
-- HOTFIX: Correct column name in update_installation_completion function
-- FILE: supabase_fix_installation_completion_date_column.sql
-- DATE: 2026-07-12 (Post-deployment)
-- PURPOSE: Fix schema mismatch - production uses 'completed_at', not 'completion_timestamp'
-- STATUS: HOTFIX (urgent, minimal change only)
-- ============================================================================
-- ROOT CAUSE:
-- Production installation_jobs table has 'completed_at' column (used by existing code).
-- Migration incorrectly used 'completion_timestamp' (non-existent column).
-- Result: Function fails at runtime when trying to update completion_timestamp.
--
-- FIX: Change 'completion_timestamp' → 'completed_at' in function body only.
-- No other changes to function logic, signature, or other objects.
-- ============================================================================

BEGIN TRANSACTION;

-- ============================================================================
-- STEP 1: UPDATE FUNCTION - Fix completion_timestamp → completed_at
-- ============================================================================
-- Only change: Use 'completed_at' column (production schema)
-- Everything else unchanged: atomicity, exception handling, etc.
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
        completed_at = CASE
            WHEN p_new_status = 'completed' THEN now()
            ELSE completed_at
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
-- STEP 2: UPDATE FUNCTION COMMENT
-- ============================================================================

COMMENT ON FUNCTION public.update_installation_completion(uuid, uuid, text, uuid, text) IS
'Atomically complete installation: update job status (completed_at), create earnings via calculate_commission_for_job(), '
'insert earnings and transaction records, optionally update order. All operations atomic: all succeed or all fail. '
'Authorization: admin or accountant role required. Rate limited: 1 completion per 3 seconds. '
'NOTE: Uses completed_at column (not completion_timestamp) to match production schema.';

-- ============================================================================
-- END TRANSACTION
-- ============================================================================

COMMIT;

-- ============================================================================
-- NOTIFICATION FOR SCHEMA CACHE INVALIDATION
-- ============================================================================

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- VERIFICATION
-- ============================================================================
-- After applying this hotfix, run:
-- SELECT public.update_installation_completion(
--     'company_id'::uuid,
--     'job_id'::uuid,
--     'completed',
--     'order_id'::uuid,
--     'montaj_tamamlandi'
-- );
-- Should return JSON with success=true and no column-not-found error.
-- ============================================================================
