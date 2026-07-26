-- ============================================================================
-- ROLLBACK INSTRUCTIONS: update_installation_completion() Enhancement
-- DATE: 2026-07-11
-- ============================================================================
-- Use these SQL commands if the migration needs to be rolled back
-- ============================================================================

BEGIN TRANSACTION;

-- ============================================================================
-- STEP 1: DROP ENHANCED FUNCTION
-- ============================================================================
-- This removes the new version with earnings creation

DROP FUNCTION IF EXISTS public.update_installation_completion(uuid, uuid, text, uuid, text) CASCADE;

-- ============================================================================
-- STEP 2: RESTORE ORIGINAL FUNCTION
-- ============================================================================
-- Original version from supabase_payment_transaction_safety.sql (lines 650-711)
-- Does NOT create earnings (just updates status)

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

-- ============================================================================
-- STEP 3: RE-GRANT PERMISSIONS
-- ============================================================================

GRANT EXECUTE ON FUNCTION public.update_installation_completion(uuid, uuid, text, uuid, text)
TO authenticated;

-- ============================================================================
-- STEP 4: RESTORE ORIGINAL COMMENT
-- ============================================================================

COMMENT ON FUNCTION public.update_installation_completion(uuid, uuid, text, uuid, text) IS
'Atomically update installation completion: update job status, trigger earnings, optionally update order. All or nothing.';

-- ============================================================================
-- STEP 5: DROP UNIQUE CONSTRAINT (Optional)
-- ============================================================================
-- The UNIQUE constraint added by the migration can remain (it's safe)
-- But if you want to remove it, run:

-- ALTER TABLE public.installer_earnings
-- DROP CONSTRAINT IF EXISTS installer_earnings_company_job_unique;

-- Note: Keep commented out unless you specifically need to remove the constraint
-- The constraint prevents double-creation and is beneficial to keep

-- ============================================================================
-- END ROLLBACK
-- ============================================================================

COMMIT;

-- ============================================================================
-- VERIFY ROLLBACK
-- ============================================================================
-- Run these queries to confirm rollback was successful:
--
-- 1. Verify function is original version (no authorization check):
--    SELECT pg_get_functiondef('public.update_installation_completion'::regprocedure)
--    LIKE '%is_company_admin%' as still_has_new_code;
--    Expected: false
--
-- 2. Verify function still works:
--    SELECT json_extract_path_text(
--        public.update_installation_completion(
--            '00000000-0000-0000-0000-000000000000'::uuid,
--            '00000000-0000-0000-0000-000000000000'::uuid,
--            'planned'
--        ),
--        'success'
--    );
--    Expected: false (job not found is OK, means function works)
--
-- 3. UNIQUE constraint status (should remain):
--    SELECT EXISTS (
--        SELECT 1 FROM information_schema.table_constraints
--        WHERE table_schema='public' AND table_name='installer_earnings'
--        AND constraint_name='installer_earnings_company_job_unique'
--    ) as constraint_still_exists;
--    Expected: true (constraint remains even after rollback)
--
-- ============================================================================
-- IMPORTANT NOTES
-- ============================================================================
--
-- 1. This rollback removes the earnings creation functionality
--    Any new completions will NOT create earnings going forward
--
-- 2. Existing earnings records are NOT deleted
--    Earnings created by the enhanced function remain in database
--    To remove: Use separate cleanup migration
--
-- 3. The UNIQUE constraint remains (safe to keep)
--    Prevents future double-creation if new function added later
--
-- 4. If reverting due to bugs:
--    - Identify which jobs had partial updates
--    - Use separate recovery migration to fix inconsistencies
--
-- 5. Before rolling back, save the list of completions made after migration:
--    SELECT COUNT(*) as jobs_completed_with_earnings
--    FROM public.installation_jobs
--    WHERE status = 'installation_completed'
--    AND updated_at > '2026-07-11'::date;
--
-- ============================================================================
