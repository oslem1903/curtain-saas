-- ============================================================================
-- MIGRATION 007: Firma kendi montajını yapabilsin — installer_earnings/
-- installer_transactions OLUŞMADAN. "is_internal_installation" ayrımı.
-- ============================================================================
-- Purpose: Bugün update_installation_completion() bir montajın tamamlanması
-- için HER ZAMAN assigned_staff_id dolu olmasını şart koşuyor ve dolu ise
-- HER ZAMAN otomatik installer_earnings + installer_transactions oluşturuyor.
-- Bu, "firma kendi montajını yapıyor" senaryosunu desteklemiyor — ya montajı
-- tamamlayamıyorsunuz (montajcı atanmadan) ya da kendinizi montajcı gibi
-- atayıp gereksiz bir hakediş/cari kaydı oluşturmak zorunda kalıyorsunuz.
--
-- ÇÖZÜM: installation_jobs'a yeni, açık anlamlı bir boolean kolon eklenir:
--   is_internal_installation (DEFAULT false — mevcut kayıtlar etkilenmez).
-- true ise: montaj installer atanmadan tamamlanabilir; installer_earnings/
-- installer_transactions HİÇ oluşturulmaz (0 TL değil, kayıt YOK); Montajcı
-- Cari'ye hiç yansımaz (assigned_staff_id zaten NULL kalacağı için mevcut
-- InstallerLedger.tsx/InstallerEarningsDetail.tsx filtreleri değişmeden bu
-- işleri otomatik dışlar — o dosyalara dokunulmadı).
--
-- DEĞİŞEN (yalnızca update_installation_completion() gövdesi, 3 nokta):
--   1) Job okunurken is_internal_installation de okunur (yeni DECLARE
--      değişkeni v_is_internal).
--   2) "Installer atanmalı" zorunluluğu artık yalnızca dış montaj için
--      geçerli: "AND NOT v_is_internal" eklendi.
--   3) Otomatik hakediş oluşturma bloğu artık yalnızca dış montaj VE
--      installer atanmışsa çalışıyor: "AND NOT v_is_internal" eklendi.
-- Başka HİÇBİR satır değişmedi — yetki, rate limit, satır kilidi (FOR
-- UPDATE), mükerrer-earnings ön kontrolü, order_id tutarlılık kontrolü,
-- installation_jobs/orders UPDATE'leri, RETURN şekli, EXCEPTION bloğu
-- birebir aynı.
--
-- update_installer_job_fee() (migration 006) BU MİGRASYONDA DEĞİŞMİYOR —
-- ayrı bir fonksiyon, dokunulmadı. Mevcut hakediş/ödeme kayıtlarına hiçbir
-- UPDATE/DELETE yapılmıyor.
--
-- Safe: ALTER TABLE additive (IF NOT EXISTS, NOT NULL DEFAULT false — sabit
-- default olduğu için tablo yeniden yazımı gerektirmez); CREATE OR REPLACE
-- FUNCTION imza değişmeden aynı fonksiyonun yerini alır. Hiçbir ekran bu
-- kolonu/güncellenmiş RPC'yi henüz çağırmıyor (frontend kodu ayrı onayla
-- deploy edilecek) — migration çalıştırılsa bile mevcut production
-- davranışı değişmez (tüm mevcut kayıtlarda is_internal_installation=false).
-- Rollback: ALTER TABLE installation_jobs DROP COLUMN is_internal_installation;
--           ve bu dosyadaki CREATE OR REPLACE'i migration dosyasındaki (fix_
--           update_installation_completion_earnings.sql) orijinal gövdeyle
--           tekrar çalıştırın.
-- ============================================================================

BEGIN TRANSACTION;

-- ============================================================================
-- STEP 1: YENİ KOLON
-- ============================================================================
ALTER TABLE public.installation_jobs
ADD COLUMN IF NOT EXISTS is_internal_installation boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.installation_jobs.is_internal_installation IS
'true = montajı firma kendisi/kendi ekibi yaptı (dış montajcıya atanmadı).
Bu durumda assigned_staff_id NULL kalabilir, montaj installer olmadan
tamamlanabilir, ve update_installation_completion() otomatik
installer_earnings/installer_transactions OLUŞTURMAZ. Varsayılan false —
mevcut/dış montajcı akışı bu kolondan etkilenmez.';

-- ============================================================================
-- STEP 2: update_installation_completion() — 3 noktalı minimum değişiklik
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
    v_job_id uuid;
    v_installer_id uuid;
    v_order_id uuid;
    v_is_internal boolean;
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
    -- DEĞİŞTİ: is_internal_installation de okunuyor.
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

    -- 2. Check if installer is assigned (only for completion status)
    -- DEĞİŞTİ: bu zorunluluk yalnızca DIŞ montaj için geçerli (NOT v_is_internal).
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
    -- If ANY operation fails, exception raised → transaction rollback
    -- Client receives error (not JSON), atomicity guaranteed
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

    -- 6. CREATE EARNINGS (only for completion status)
    -- DEĞİŞTİ: yalnızca DIŞ montaj VE installer atanmışsa (NOT v_is_internal).
    -- İç montajda bu blok hiç çalışmaz — installer_earnings/installer_
    -- transactions HİÇ oluşmaz (0 TL değil, satır YOK).
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

    RETURN json_build_object(
        'success', true,
        'job_id', v_job_id,
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

GRANT EXECUTE ON FUNCTION public.update_installation_completion(uuid, uuid, text, uuid, text)
TO authenticated;

COMMENT ON FUNCTION public.update_installation_completion(uuid, uuid, text, uuid, text) IS
'Atomically complete installation: update job status, create earnings via calculate_commission_for_job(),
insert earnings and transaction records, optionally update order. All operations atomic: all succeed or all fail.
is_internal_installation=true olan işlerde installer atanması zorunlu DEĞİLDİR ve installer_earnings/
installer_transactions HİÇ oluşturulmaz (firma kendi montajını yapıyor senaryosu).
Authorization: admin or accountant role required. Rate limited: 1 completion per 3 seconds.';

-- Notify schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;
