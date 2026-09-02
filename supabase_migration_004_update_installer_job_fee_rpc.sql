-- ============================================================================
-- MIGRATION 004: Add update_installer_job_fee() RPC
-- ============================================================================
-- Purpose: Var olan bir tamamlanmış montaj işinin fiyatlandırmasını
-- (price_type/unit_rate/installer_fee) düzenler ve — eğer o iş için zaten
-- kanonik bir installer_earnings kaydı varsa — YALNIZCA o kaydı günceller.
-- Yeni installer_earnings satırı ASLA açmaz (installer_earnings_company_job_
-- unique constraint + update_installation_completion() RPC'nin INSERT
-- sorumluluğu bozulmasın diye).
--
-- installation_jobs.price_type geçerli değerleri (repo'da doğrulandı):
--   'manuel' | 'm2' | 'adet'   (bkz. supabase_installer_ledger.sql:10,
--   InstallerLedger.tsx <select> seçenekleri, OrderDetail.tsx:1419-1421)
--
-- Safe: Yeni bir CREATE OR REPLACE FUNCTION; mevcut hiçbir tablo/kolon/
-- policy/trigger değiştirilmez veya silinmez. Hiçbir ekran bu RPC'yi henüz
-- çağırmıyor (bu migration çalıştırılsa bile production davranışı değişmez).
-- Rollback: DROP FUNCTION public.update_installer_job_fee(uuid, uuid, text, numeric, numeric);
-- ============================================================================

BEGIN TRANSACTION;

CREATE OR REPLACE FUNCTION public.update_installer_job_fee(
    p_company_id uuid,
    p_job_id uuid,
    p_price_type text,
    p_unit_rate numeric,
    p_installer_fee numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_job_status text;
    v_job_qty numeric;
    v_job_area numeric;
    v_earning_id uuid;
    v_quantity_earning numeric := 0;
    v_area_earning numeric := 0;
    v_manual_earning numeric := 0;
    v_final_fee numeric;
BEGIN
    -- ========================================================================
    -- STEP 1: AUTHORIZATION
    -- Kilit/yetki koşulu update_installation_completion()'dan birebir
    -- kopyalandı (is_super_admin OR is_company_admin OR is_company_accounting).
    -- Hata sinyali biçimi ise add_manual_installer_earning()'den alındı
    -- ("code: mesaj" RAISE EXCEPTION) — çünkü installerPaymentService.ts'teki
    -- parseInstallerRpcError() zaten bu formatı bekliyor.
    -- ========================================================================
    IF NOT (
        public.is_super_admin()
        OR public.is_company_admin(p_company_id)
        OR public.is_company_accounting(p_company_id)
    ) THEN
        RAISE EXCEPTION 'unauthorized: bu firmaya erişim yok veya yetkiniz yok';
    END IF;

    -- SECURITY DEFINER RLS'i bypass eder; installer_record_payment/
    -- installer_cancel_payment/add_manual_installer_earning'deki aynı
    -- deneme-süresi kontrolü burada da tekrarlanır.
    IF NOT public.check_subscription_active(p_company_id) THEN
        RAISE EXCEPTION 'unauthorized: firma lisansı/deneme süresi aktif değil';
    END IF;

    -- ========================================================================
    -- STEP 2: INPUT VALIDATION
    -- ========================================================================
    IF p_company_id IS NULL THEN
        RAISE EXCEPTION 'invalid_reference: company_id gerekli';
    END IF;

    IF p_job_id IS NULL THEN
        RAISE EXCEPTION 'invalid_reference: job_id gerekli';
    END IF;

    IF p_price_type NOT IN ('manuel', 'm2', 'adet') THEN
        RAISE EXCEPTION 'invalid_reference: geçersiz price_type: %. Geçerli değerler: manuel, m2, adet', p_price_type;
    END IF;

    IF p_unit_rate IS NULL OR p_unit_rate < 0 THEN
        RAISE EXCEPTION 'invalid_amount: birim fiyat negatif olamaz';
    END IF;

    IF p_installer_fee IS NULL OR p_installer_fee < 0 THEN
        RAISE EXCEPTION 'invalid_amount: hakediş tutarı negatif olamaz';
    END IF;

    -- ========================================================================
    -- STEP 3: FIND + LOCK JOB
    -- ========================================================================
    SELECT status, qty, area_m2
    INTO v_job_status, v_job_qty, v_job_area
    FROM public.installation_jobs
    WHERE id = p_job_id AND company_id = p_company_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found: montaj işi bulunamadı';
    END IF;

    IF v_job_status IS DISTINCT FROM 'completed' THEN
        RAISE EXCEPTION 'invalid_reference: yalnızca tamamlanmış (completed) işler için hakediş düzenlenebilir';
    END IF;

    -- ========================================================================
    -- STEP 4: HAKEDİŞ TUTARINI SUNUCU TARAFINDA HESAPLA
    -- ------------------------------------------------------------------------
    -- Tasarım kararı: m2/adet modlarında installer_fee, job'ın KENDİ
    -- area_m2/qty × p_unit_rate değerinden sunucuda yeniden hesaplanır —
    -- client'ın gönderdiği p_installer_fee bu iki modda YOK SAYILIR. Böylece
    -- client tarafında bir hesap hatası (veya kasıtlı hatalı payload) yanlış
    -- bir total_earning yazamaz.
    --
    -- GÜVENLİK: qty/area_m2 NULL veya <= 0 olduğunda sessizce 1'e/0'a düşüp
    -- finansal bir tutar üretilmez — işlem AÇIKÇA reddedilir.
    -- Manuel modda p_installer_fee doğrudan tutar olduğundan aynen kabul edilir.
    -- ========================================================================
    CASE p_price_type
        WHEN 'm2' THEN
            IF v_job_area IS NULL OR v_job_area <= 0 THEN
                RAISE EXCEPTION 'invalid_reference: bu iş için geçerli bir alan (area_m2) kayıtlı değil; m2 bazlı hakediş hesaplanamaz';
            END IF;
            v_area_earning := round(v_job_area * p_unit_rate, 2);
            v_final_fee := v_area_earning;
        WHEN 'adet' THEN
            IF v_job_qty IS NULL OR v_job_qty <= 0 THEN
                RAISE EXCEPTION 'invalid_reference: bu iş için geçerli bir adet (qty) kayıtlı değil; adet bazlı hakediş hesaplanamaz';
            END IF;
            v_quantity_earning := round(v_job_qty * p_unit_rate, 2);
            v_final_fee := v_quantity_earning;
        ELSE -- 'manuel'
            v_manual_earning := p_installer_fee;
            v_final_fee := p_installer_fee;
    END CASE;

    -- ========================================================================
    -- STEP 5: installation_jobs GÜNCELLE (her zaman) — aynı transaction
    -- ========================================================================
    UPDATE public.installation_jobs
    SET
        price_type = p_price_type,
        unit_rate = p_unit_rate,
        installer_fee = v_final_fee,
        updated_at = now()
    WHERE id = p_job_id AND company_id = p_company_id;

    -- ========================================================================
    -- STEP 6: VAR OLAN installer_earnings SATIRINI BUL — YALNIZCA UPDATE,
    -- ASLA INSERT ETME. Aynı transaction içinde.
    --
    -- LIMIT 1 kasıtlı olarak KULLANILMIYOR. (company_id, installation_job_id)
    -- üzerindeki UNIQUE constraint zaten en fazla bir satır garanti ediyor;
    -- SELECT ... INTO STRICT ile bu varsayım fiilen doğrulanıyor:
    --   - 0 satır  -> NO_DATA_FOUND -> v_earning_id NULL kalır (legacy/earning
    --     henüz oluşmamış iş — beklenen, geçerli bir durum, hata DEĞİL).
    --   - 1 satır  -> normal akış.
    --   - >1 satır -> TOO_MANY_ROWS -> veri bütünlüğü ihlali AÇIKÇA hata
    --     olarak fırlatılır; RPC sessizce rastgele bir satır seçmez ve
    --     tüm transaction (STEP 5'teki installation_jobs UPDATE'i dahil)
    --     otomatik olarak geri alınır.
    -- ========================================================================
    BEGIN
        SELECT id INTO STRICT v_earning_id
        FROM public.installer_earnings
        WHERE installation_job_id = p_job_id AND company_id = p_company_id;
    EXCEPTION
        WHEN NO_DATA_FOUND THEN
            v_earning_id := NULL;
        WHEN TOO_MANY_ROWS THEN
            RAISE EXCEPTION 'data_integrity_error: installation_job_id % için birden fazla installer_earnings satırı bulundu (UNIQUE constraint ihlali bekleniyordu)', p_job_id;
    END;

    IF v_earning_id IS NOT NULL THEN
        UPDATE public.installer_earnings
        SET
            quantity_earning = v_quantity_earning,
            area_earning = v_area_earning,
            manual_earning = v_manual_earning,
            total_earning = v_final_fee,
            quantity_rate = CASE WHEN p_price_type = 'adet' THEN p_unit_rate ELSE NULL END,
            area_rate = CASE WHEN p_price_type = 'm2' THEN p_unit_rate ELSE NULL END,
            metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                'manually_edited_at', now(),
                'manually_edited_price_type', p_price_type
            )
        WHERE id = v_earning_id AND company_id = p_company_id;
    END IF;
    -- v_earning_id NULL ise: installer_earnings'e HİÇ dokunulmaz (legacy
    -- fallback davranışıyla tutarlı — installer_transactions de dahil hiçbir
    -- güvenilir ilişkisi olmayan tabloya tahmini eşleştirme yapılmaz).

    -- ========================================================================
    -- STEP 7: RETURN
    -- ========================================================================
    RETURN jsonb_build_object(
        'earning_id', v_earning_id,
        'job_id', p_job_id,
        'total_earning', v_final_fee,
        'price_type', p_price_type,
        'unit_rate', p_unit_rate
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_installer_job_fee(
    uuid, uuid, text, numeric, numeric
) TO authenticated;

COMMENT ON FUNCTION public.update_installer_job_fee IS
'Tamamlanmış bir montaj işinin price_type/unit_rate/installer_fee değerlerini
günceller; varsa ilişkili kanonik installer_earnings satırını da (yalnızca
UPDATE, asla yeni INSERT) günceller. adet/m2 modlarında qty/area_m2 > 0
zorunludur (sessiz 1/0 fallback yoktur). installation_jobs/installer_earnings
tutarlılığını korur, ikinci earning satırı oluşturmaz.
Yetki: company admin/accounting veya super admin, aktif abonelik gerekir.';

-- Notify schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;
