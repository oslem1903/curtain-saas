-- ============================================================================
-- MIGRATION 005: Fix update_installer_job_fee() adet hesabı — order_items.qty
-- ============================================================================
-- Purpose: migration_004'te oluşturulan update_installer_job_fee() RPC'sinin
-- 'adet' (quantity) dalı installation_jobs.qty kolonunu kullanıyordu. Bu kolon
-- canlıda senkron değil — örn. Almila Yağmur'un iki gerçek işinde order_items
-- toplamı 3 ve 2 iken installation_jobs.qty sabit <=1 döndü (localhost'ta canlı
-- DOM testiyle doğrulandı). Gerçek ürün adedi kaynağı: job'ın order_id'sine
-- bağlı TÜM order_items.qty toplamı — bu, on_installation_job_completed
-- trigger'ının ZATEN kullandığı SUM(qty) deseniyle birebir aynı
-- (bkz. supabase_installer_commission_triggers.sql:68-73).
--
-- DEĞİŞEN: yalnızca fonksiyon gövdesi (CREATE OR REPLACE — migration_004'ün
-- oluşturduğu fonksiyonun yerini alır, aynı isim/imza). GRANT/COMMENT de
-- güncellendi. Yetki/kilit/izolasyon/manuel/m2 davranışı, installer_earnings
-- için "yalnızca UPDATE, asla INSERT" kuralı, installer_transactions'a
-- dokunmama kararı AYNEN korundu.
--
-- migration_004'ü DEĞİL bu dosyayı çalıştırın — 004 zaten production'da
-- uygulandı (RPC halihazırda var), bu migration onun ÜZERİNE CREATE OR
-- REPLACE ile yazar.
--
-- Safe: Yeni bir CREATE OR REPLACE FUNCTION; mevcut hiçbir tablo/kolon/
-- policy/trigger değiştirilmez veya silinmez. Hiçbir ekran bu RPC'yi henüz
-- çağırmıyor (frontend kodu hazır ama bu migration production'a
-- uygulanmadan önce kod deploy edilmeyecek).
-- Rollback: migration_004'ün gövdesini yeniden CREATE OR REPLACE ile çalıştırın.
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
    v_job_area numeric;
    v_job_order_id uuid;
    v_real_qty numeric;
    v_earning_id uuid;
    v_quantity_earning numeric := 0;
    v_area_earning numeric := 0;
    v_manual_earning numeric := 0;
    v_final_fee numeric;
BEGIN
    -- ========================================================================
    -- STEP 1: AUTHORIZATION
    -- ========================================================================
    IF NOT (
        public.is_super_admin()
        OR public.is_company_admin(p_company_id)
        OR public.is_company_accounting(p_company_id)
    ) THEN
        RAISE EXCEPTION 'unauthorized: bu firmaya erişim yok veya yetkiniz yok';
    END IF;

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
    SELECT status, area_m2, order_id
    INTO v_job_status, v_job_area, v_job_order_id
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
    -- m2/adet modlarında installer_fee, job'ın KENDİ area_m2 / GERÇEK ürün
    -- adedi × p_unit_rate değerinden sunucuda yeniden hesaplanır — client'ın
    -- gönderdiği p_installer_fee bu iki modda YOK SAYILIR.
    --
    -- ADET İÇİN GERÇEK ÜRÜN ADEDİ: installation_jobs.qty KULLANILMAZ (senkron
    -- değil). Kaynak: job'ın order_id'sine bağlı TÜM order_items.qty toplamı
    -- (on_installation_job_completed trigger'ındaki SUM(qty) deseniyle aynı).
    -- Sessiz 1/0 fallback YOK: order_id yoksa veya toplam <= 0 ise işlem
    -- AÇIKÇA reddedilir.
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
            IF v_job_order_id IS NULL THEN
                RAISE EXCEPTION 'invalid_reference: bu iş bir siparişe bağlı değil; adet bazlı hakediş hesaplanamaz';
            END IF;

            SELECT COALESCE(SUM(oi.qty), 0)
            INTO v_real_qty
            FROM public.order_items oi
            WHERE oi.order_id = v_job_order_id;

            IF v_real_qty IS NULL OR v_real_qty <= 0 THEN
                RAISE EXCEPTION 'invalid_reference: bu iş için gerçek ürün adedi (order_items) bulunamadı; adet bazlı hakediş hesaplanamaz';
            END IF;

            v_quantity_earning := round(v_real_qty * p_unit_rate, 2);
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
UPDATE, asla yeni INSERT) günceller. m2 modunda area_m2 > 0, adet modunda
job''un order_id''sine bağlı order_items.qty toplamı > 0 zorunludur
(installation_jobs.qty KULLANILMAZ; sessiz 1/0 fallback yoktur).
installation_jobs/installer_earnings tutarlılığını korur, ikinci earning
satırı oluşturmaz. Yetki: company admin/accounting veya super admin, aktif
abonelik gerekir.';

-- Notify schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;
