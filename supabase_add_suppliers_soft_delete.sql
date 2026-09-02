-- ============================================================================
-- SOFT DELETE MIGRATION: Tedarikçi Silinmesi (Hard Delete → Soft Delete via RPC)
-- Version: 2026-07-29
--
-- PURPOSE
-- - Replace hard DELETE with soft DELETE via admin-controlled RPC
-- - Preserve supplier_transactions and historical data (audit trail)
-- - Prevent unintended CASCADE deletion of related records
-- - Maintain accountant role authorization for supplier metadata updates
--
-- SCOPE
-- - Remove DELETE RLS policy (no more hard deletes allowed)
-- - Keep UPDATE RLS policy UNCHANGED (is_company_accounting preserved)
-- - Create soft_delete_supplier(p_company_id, p_supplier_id) RPC
-- - No new columns needed (deleted_at already exists)
-- - No data migration required (NULL = active)
--
-- SAFETY
-- - UPDATE policy untouched (accountant supplier updates still work)
-- - DELETE policy removed (hard deletes blocked)
-- - RPC: SECURITY DEFINER with admin authorization
-- - RPC: subscription_active check + company_id validation
-- - RPC: already_deleted detection
-- - Idempotent (safe to re-run)
-- ============================================================================

-- 1. Remove hard DELETE capability (blocks direct hard deletes)
DROP POLICY IF EXISTS suppliers_tenant_delete ON public.suppliers;

-- 2. Create soft_delete_supplier RPC (admin-controlled soft delete)
CREATE OR REPLACE FUNCTION public.soft_delete_supplier(
    p_company_id uuid,
    p_supplier_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deleted_at timestamptz;
    v_rows_affected integer;
BEGIN
    -- Authorization: super admin OR company admin only
    IF NOT (public.is_super_admin() OR public.is_company_admin(p_company_id)) THEN
        RAISE EXCEPTION 'unauthorized: only admin can soft delete suppliers';
    END IF;

    -- License/subscription active check
    IF NOT public.check_subscription_active(p_company_id) THEN
        RAISE EXCEPTION 'unauthorized: firma lisansi/deneme suresi aktif degil';
    END IF;

    -- Validate: supplier exists and belongs to this company
    IF NOT EXISTS (
        SELECT 1 FROM public.suppliers
        WHERE id = p_supplier_id AND company_id = p_company_id
    ) THEN
        RAISE EXCEPTION 'not_found: tedarikci bulunamadi';
    END IF;

    -- Check: supplier already soft-deleted
    IF EXISTS (
        SELECT 1 FROM public.suppliers
        WHERE id = p_supplier_id AND company_id = p_company_id AND deleted_at IS NOT NULL
    ) THEN
        SELECT deleted_at INTO v_deleted_at FROM public.suppliers
        WHERE id = p_supplier_id AND company_id = p_company_id;

        RETURN jsonb_build_object(
            'success', false,
            'supplier_id', p_supplier_id,
            'deleted_at', v_deleted_at,
            'already_deleted', true
        );
    END IF;

    -- Soft delete: UPDATE deleted_at for active suppliers only
    -- This prevents CASCADE from triggering (supplier row still exists)
    UPDATE public.suppliers
    SET deleted_at = now()
    WHERE id = p_supplier_id
      AND company_id = p_company_id
      AND deleted_at IS NULL;

    -- Verify exactly one row was affected (idempotency check)
    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;

    IF v_rows_affected <> 1 THEN
        RAISE EXCEPTION 'database_error: supplier update failed (rows affected: %)', v_rows_affected;
    END IF;

    -- Return success with new deleted_at timestamp
    SELECT deleted_at INTO v_deleted_at FROM public.suppliers
    WHERE id = p_supplier_id AND company_id = p_company_id;

    RETURN jsonb_build_object(
        'success', true,
        'supplier_id', p_supplier_id,
        'deleted_at', v_deleted_at,
        'already_deleted', false
    );
END;
$$;

-- Grant execute to authenticated users only (RPC handles authorization)
GRANT EXECUTE ON FUNCTION public.soft_delete_supplier(uuid, uuid) TO authenticated;

-- Revoke public execute if exists
REVOKE EXECUTE ON FUNCTION public.soft_delete_supplier(uuid, uuid) FROM public;

-- ============================================================================
-- VERIFICATION QUERIES (run after deployment)
-- ============================================================================

-- 1. Confirm DELETE policy removed, UPDATE policy intact
-- SELECT policyname, cmd, qual FROM pg_policies
-- WHERE tablename = 'suppliers' ORDER BY policyname;
-- Expected:
--   suppliers_tenant_delete: (should NOT exist)
--   suppliers_tenant_insert: FOR INSERT with is_company_accounting
--   suppliers_tenant_select: FOR SELECT
--   suppliers_tenant_update: FOR UPDATE with is_company_accounting (UNCHANGED)

-- 2. Confirm RPC exists and has correct signature
-- SELECT proname, prosecdef FROM pg_proc
-- WHERE proname = 'soft_delete_supplier';
-- Expected: soft_delete_supplier, t (SECURITY DEFINER)

-- 3. Test RPC as admin (should succeed)
-- SELECT public.soft_delete_supplier(
--   '<company_id>'::uuid,
--   '<supplier_id_to_delete>'::uuid
-- );

-- 4. Test RPC idempotency (should return already_deleted=true)
-- SELECT public.soft_delete_supplier(
--   '<company_id>'::uuid,
--   '<supplier_id_already_deleted>'::uuid
-- );

-- 5. Verify supplier_transactions NOT deleted by CASCADE
-- SELECT COUNT(*) FROM public.supplier_transactions
-- WHERE supplier_id = '<deleted_supplier_id>'::uuid;
-- Expected: count > 0 (transactions preserved)

-- 6. Verify withoutDeleted() filters correctly
-- SELECT COUNT(*) FROM public.suppliers
-- WHERE company_id = '<company_id>'::uuid AND deleted_at IS NULL;
-- Expected: (all active suppliers)
