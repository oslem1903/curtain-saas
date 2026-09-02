-- ============================================================================
-- MIGRATION 008: FIX — migration 007'nin RETURN'ünde "v_commission_row is not
-- assigned yet" hatası (iç montaj tamamlama başarısız oluyordu).
-- ============================================================================
-- Purpose: Canlı regresyon testinde bulundu — "Firma Kendisi Montaj Yapacak"
-- ile işaretlenmiş bir işi tamamlamaya çalışırken RPC şu hatayı fırlatıyordu:
--   record "v_commission_row" is not assigned yet
-- Sonuç: montaj TAMAMLANAMIYORDU (transaction temiz şekilde geri alındı —
-- veri bütünlüğü bozulmadı, ama özellik çalışmıyordu).
--
-- KÖK NEDEN: migration 007'de is_internal_installation=true olan işlerde
-- STEP 6 (hakediş oluşturma bloğu, v_commission_row'u dolduran tek yer)
-- kasıtlı olarak hiç ÇALIŞTIRILMIYOR (bu doğru davranış — hakediş
-- oluşmamalı). Ama STEP 7'deki RETURN ifadesi hâlâ koşulsuz şekilde
-- "v_commission_row.total_earning" alanına erişiyordu. PL/pgSQL'de hiç
-- SELECT INTO ile doldurulmamış bir "record" tipi değişkenin herhangi bir
-- alanına erişmek "is not assigned yet" hatası fırlatır — v_commission_row
-- IS NULL kontrolü değil, doğrudan alan erişimi (.total_earning) bu hatayı
-- veriyor.
--
-- ÇÖZÜM: v_commission_row.total_earning'e RETURN'de doğrudan erişmek yerine,
-- STEP 6 içinde ayrı bir skaler değişkene (v_total_earning, varsayılan 0)
-- kopyalanır; RETURN bu skaler değişkeni kullanır. İç montajda STEP 6 hiç
-- çalışmadığından v_total_earning varsayılan 0'da kalır — bu doğru sonuçtur
-- (RETURN'deki 'total_earning' alanı zaten sadece bilgi amaçlı, iç montajda
-- 0 olması semantik olarak doğru: hiçbir hakediş oluşmadı).
--
-- DEĞİŞEN: yalnızca DECLARE bloğuna 1 değişken eklendi, STEP 6'nın sonuna
-- 1 atama satırı eklendi, STEP 7'nin RETURN'ünde 1 ifade değişti. Migration
-- 007'nin getirdiği is_internal_installation mantığının GERİ KALANI (STEP 1
-- okuma, STEP 2 installer-zorunluluğu istisnası, STEP 6 koşulu) AYNEN
-- korundu. Dış montajcı akışı, 006'daki update_installer_job_fee() hiç
-- etkilenmiyor.
--
-- Safe: Yalnızca CREATE OR REPLACE FUNCTION; tablo/kolon değişikliği yok.
-- Rollback: migration 007'nin gövdesini yeniden CREATE OR REPLACE ile
-- çalıştırın (ama bu, hatayı geri getirir — önerilmez).
-- ============================================================================

BEGIN TRANSACTION;

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
    v_job_id uuid;
    v_installer_id uuid;
    v_order_id uuid;
    v_is_internal boolean;
    v_commission_row record;
    v_earning_id uuid;
    v_transaction_id uuid;
    v_total_earning numeric := 0;  -- YENİ: RETURN'de kullanılacak güvenli skaler.
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
        order_id,
        is_internal_installation
    INTO
        v_job_id,
        v_installer_id,
        v_order_id,
        v_is_internal
    FROM public.installation_jobs
    WHERE id = p_job_id AND company_id = p_company_id
    FOR UPDATE;  -- Row-level lock prevents concurrent modifications

    IF v_job_id IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Installation job not found',
            'job_id', p_job_id
        );
    END IF;

    -- 2. Check if installer is assigned (only for completion status, only for
    -- DIŞ montaj — iç montajda installer zorunlu değil).
    IF p_new_status = 'completed' AND NOT v_is_internal AND v_installer_id IS NULL THEN
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
            WHERE company_id = p_company_id
              AND installation_job_id = v_job_id
            LIMIT 1
        ) THEN
            RETURN json_build_object(
                'success', false,
                'error', 'Earnings already created for this job',
                'note', 'Double-creation prevented by UNIQUE constraint'
            );
        END IF;
    END IF;

    -- 4. Order ID consistency validation
    IF p_order_id IS NOT NULL AND v_order_id IS NOT NULL AND p_order_id <> v_order_id THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Order id mismatch: provided order does not match installation job',
            'provided_order_id', p_order_id,
            'actual_order_id', v_order_id
        );
    END IF;

    -- ========================================================================
    -- WRITE OPERATIONS: All-or-Nothing via Exception
    -- ========================================================================

    -- 5. UPDATE installation_jobs status
    UPDATE public.installation_jobs
    SET
        status = p_new_status,
        completed_at = CASE
            WHEN p_new_status = 'completed' THEN now()
            ELSE completed_at
        END,
        updated_at = now()
    WHERE id = v_job_id AND company_id = p_company_id;

    -- 6. CREATE EARNINGS (only for completion status, only for DIŞ montaj VE
    -- installer atanmışsa). İç montajda bu blok hiç çalışmaz — v_total_earning
    -- varsayılan 0'da kalır, installer_earnings/installer_transactions HİÇ
    -- oluşmaz.
    IF p_new_status = 'completed' AND NOT v_is_internal AND v_installer_id IS NOT NULL THEN

        -- 6a. Call calculate_commission_for_job to get earnings details
        SELECT * INTO v_commission_row
        FROM public.calculate_commission_for_job(
            v_job_id,
            v_installer_id,
            p_company_id
        );

        -- Validate commission result
        IF v_commission_row IS NULL THEN
            RAISE EXCEPTION 'calculate_commission_for_job returned NULL result for job %', v_job_id;
        END IF;

        -- 6b. INSERT installer_earnings record
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
            v_job_id,
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

        -- 6c. INSERT installer_transactions record
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

        -- YENİ: RETURN'de güvenle kullanılacak skalere kopyala (v_commission_row
        -- burada kesin dolu, bu satır hiç hata riski taşımaz).
        v_total_earning := v_commission_row.total_earning;
    END IF;

    -- 7. UPDATE orders status (if provided)
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
    -- DEĞİŞTİ: v_commission_row.total_earning yerine v_total_earning
    -- kullanılıyor — v_commission_row iç montajda HİÇ atanmamış olabilir,
    -- ona doğrudan alan erişimi ("is not assigned yet" hatası) artık yok.

    RETURN json_build_object(
        'success', true,
        'job_id', v_job_id,
        'new_status', p_new_status,
        'earning_id', v_earning_id,
        'transaction_id', v_transaction_id,
        'total_earning', v_total_earning,
        'updated_at', now()
    );

EXCEPTION WHEN OTHERS THEN
    -- Any write error → transaction automatically rolled back by PostgreSQL
    -- Re-raise exception so client receives error (not successful JSON)
    RAISE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_installation_completion(uuid, uuid, text, uuid, text)
TO authenticated;

COMMENT ON FUNCTION public.update_installation_completion(uuid, uuid, text, uuid, text) IS
'Atomically complete installation: update job status, create earnings via calculate_commission_for_job(),
insert earnings and transaction records, optionally update order. All operations atomic: all succeed or all fail.
is_internal_installation=true olan işlerde installer atanması zorunlu DEĞİLDİR ve installer_earnings/
installer_transactions HİÇ oluşturulmaz (firma kendi montajını yapıyor senaryosu); bu durumda
total_earning dönüşü 0''dır (v_commission_row hiç atanmadığından güvenli v_total_earning skaleri kullanılır).
Authorization: admin or accountant role required. Rate limited: 1 completion per 3 seconds.';

-- Notify schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;
