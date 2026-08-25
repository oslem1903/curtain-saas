-- ATOMIC MEASUREMENT GROUP REPLACE RPC
-- PURPOSE: Replace measurement group (delete old + insert new) in single transaction
-- SECURITY: DEFINER mode with strict company_id enforcement; no payload-driven sensitive fields
-- RATIONALE: Prevents data loss if delete succeeds but insert fails; ensures tenant isolation
-- IDEMPOTENT: Yes — only modifies specified group; backward-compatible with existing data
-- ============================================================================

CREATE OR REPLACE FUNCTION public.replace_measurement_group(
    p_company_id uuid,
    p_group_id text,
    p_payloads jsonb  -- Array of appointment objects to insert (company_id ignored, forced to p_company_id)
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deleted_count int := 0;
    v_inserted_count int := 0;
    v_payload jsonb;
    v_idx int;
    v_note text;
    v_group_marker text;
BEGIN
    -- ========================================================================
    -- AUTHORIZATION: Verify user can access p_company_id
    -- Uses production authorization model: is_super_admin, is_company_admin, or company_members
    -- ========================================================================
    IF NOT (
        public.is_super_admin()
        OR public.is_company_admin(p_company_id)
        OR (auth.uid() IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.company_members
            WHERE company_id = p_company_id
              AND user_id = auth.uid()
              AND is_active = true
        ))
    ) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Not authorized to replace measurement group'
        );
    END IF;

    -- ========================================================================
    -- INPUT VALIDATION
    -- ========================================================================
    IF p_company_id IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'company_id is required'
        );
    END IF;

    IF p_group_id IS NULL OR p_group_id = '' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'group_id is required'
        );
    END IF;

    IF p_payloads IS NULL OR p_payloads = 'null'::jsonb OR jsonb_array_length(p_payloads) = 0 THEN
        RETURN json_build_object(
            'success', false,
            'error', 'payloads array is required and must not be empty'
        );
    END IF;

    -- ========================================================================
    -- ATOMIC TRANSACTION: DELETE OLD + INSERT NEW
    -- All operations run within single exception block
    -- If ANY operation fails, entire transaction rolls back
    -- ========================================================================

    BEGIN
        -- 1) DELETE old appointments in this group
        -- Transaction lock is implicit (no manual FOR UPDATE needed)
        DELETE FROM public.appointments
        WHERE company_id = p_company_id
          AND note ILIKE '%[Grup: ' || p_group_id || ']%';

        GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

        -- 2) INSERT new appointments
        FOR v_idx IN 0 .. jsonb_array_length(p_payloads) - 1 LOOP
            v_payload := p_payloads -> v_idx;

            -- Enforce group marker in note: strip any [Grup: ...] from payload, then append correct one
            v_note := COALESCE(v_payload->>'note', '');
            v_note := regexp_replace(v_note, '\[Grup: [^\]]*\]', '', 'g');  -- Remove any existing group markers
            v_group_marker := '[Grup: ' || p_group_id || ']';
            -- After stripping, append correct marker (ensures next delete will find it)
            v_note := CASE WHEN btrim(v_note) = '' THEN v_group_marker ELSE btrim(v_note) || E'\n' || v_group_marker END;

            INSERT INTO public.appointments (
                company_id,
                customer_id,
                type,
                title,
                address,
                status,
                done,
                done_at,
                assigned_to,
                room_name,
                width_cm,
                height_cm,
                rounded_width_cm,
                rounded_height_cm,
                product_type,
                model_name,
                color_name,
                quantity,
                unit_price,
                supplier_id,
                supplier_unit_cost,
                supplier_total_cost,
                estimated_area_m2,
                estimated_total,
                delivery_due_date,
                note,
                measurement_notes,
                created_at,
                updated_at
            )
            VALUES (
                p_company_id,  -- FORCED: Never trust payload company_id (tenant isolation)
                (v_payload->>'customer_id')::uuid,
                v_payload->>'type',
                v_payload->>'title',
                v_payload->>'address',
                v_payload->>'status',
                (v_payload->>'done')::boolean,
                (v_payload->>'done_at')::timestamptz,
                NULLIF(v_payload->>'assigned_to', '')::uuid,
                v_payload->>'room_name',
                (v_payload->>'width_cm')::numeric,
                (v_payload->>'height_cm')::numeric,
                (v_payload->>'rounded_width_cm')::numeric,
                (v_payload->>'rounded_height_cm')::numeric,
                v_payload->>'product_type',
                v_payload->>'model_name',
                v_payload->>'color_name',
                (v_payload->>'quantity')::numeric,
                (v_payload->>'unit_price')::numeric,
                (v_payload->>'supplier_id')::uuid,
                (v_payload->>'supplier_unit_cost')::numeric,
                (v_payload->>'supplier_total_cost')::numeric,
                (v_payload->>'estimated_area_m2')::numeric,
                (v_payload->>'estimated_total')::numeric,
                (v_payload->>'delivery_due_date')::date,
                v_note,  -- ENFORCED: Group marker guaranteed by RPC
                v_note,  -- measurement_notes mirrors note (same group marker)
                now(),
                now()
            );

            v_inserted_count := v_inserted_count + 1;
        END LOOP;

        -- Success: both DELETE and INSERT completed
        RETURN json_build_object(
            'success', true,
            'deleted_count', v_deleted_count,
            'inserted_count', v_inserted_count,
            'message', format('Replaced %s old appointments with %s new ones', v_deleted_count, v_inserted_count)
        );

    EXCEPTION WHEN OTHERS THEN
        -- ANY error during DELETE or INSERT → entire transaction rolled back
        -- Old appointments NOT deleted, new appointments NOT inserted
        RETURN json_build_object(
            'success', false,
            'error', SQLERRM,
            'sqlstate', SQLSTATE,
            'detail', 'Transaction rolled back — no data was modified',
            'deleted_count', 0,
            'inserted_count', 0
        );
    END;
END;
$$;

COMMENT ON FUNCTION public.replace_measurement_group(uuid, text, jsonb) IS
'Atomically replace measurement group: delete old appointments by group marker + insert new ones. All-or-nothing via exception handling. company_id forced to p_company_id (tenant isolation). Prevents data loss.';

-- ========================================================================
-- PERMISSIONS: Restrict to authenticated users only
-- ========================================================================
-- Revoke from PUBLIC and anonymous users (explicit safety)
REVOKE EXECUTE ON FUNCTION public.replace_measurement_group(uuid, text, jsonb) FROM PUBLIC, anon;

-- Grant only to authenticated users and service_role
GRANT EXECUTE ON FUNCTION public.replace_measurement_group(uuid, text, jsonb)
    TO authenticated, service_role;
