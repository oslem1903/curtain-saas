-- ============================================================================
-- MIGRATION 006: update_installer_job_fee() — hakediş asla otomatik/zorunlu
-- bir formülle KİLİTLENMEZ; kullanıcının girdiği tutar her modda nihaidir.
-- ============================================================================
-- Purpose: migration_004/005'te update_installer_job_fee() RPC'si m2/adet
-- modlarında p_installer_fee'yi YOK SAYIP sunucu tarafında area_m2/qty × rate
-- formülüyle YENİDEN HESAPLIYOR ve alan/adet geçersizse SAVE'i tamamen
-- REDDEDİYORDU. Bu, canlıda somut bir regresyona yol açtı: bir montaj işinin
-- gerçek order_items.qty toplamı kesirli (ör. 0.5) çıktığında, kullanıcı
-- "Adet bazlı" modda Birim alanına 1000 yazıp kaydettiğinde hakediş sessizce
-- 500 (0.5 × 1000) olarak hesaplanıyor, kullanıcının GERÇEKTE istediği 1000
-- TL hiçbir zaman kaydedilemiyordu (localhost'ta canlı DOM testiyle doğrulandı
-- — Sema Cihan satırı, Birim=1000, kaydedilen Hakediş=500).
--
-- YENİ İŞ KURALI (kullanıcı tarafından açıkça talep edildi): dışarıdan
-- montajcıyla anlaşılan ücret değişebilir, firma sahibi kendi montajını
-- yapabilir (hakediş hiç oluşmayabilir) — bu yüzden hakediş ASLA otomatik ve
-- zorunlu bir formülle hesaplanmayacak. m2/adet + birim fiyat yalnızca
-- YARDIMCI bir öneri üretir (frontend'de); ama RPC'ye gönderilen
-- p_installer_fee HER ZAMAN, HER MODDA (manuel/m2/adet) nihai total_earning
-- olarak doğrudan kaydedilir. Sunucu artık bunu yeniden hesaplamaz, yok
-- saymaz veya area_m2/qty geçersiz diye reddetmez.
--
-- DEĞİŞEN: STEP 3 artık yalnızca status okuyor (area_m2/order_id/qty
-- kaldırıldı — artık hiçbir yerde kullanılmıyor). STEP 4'teki CASE bloğu
-- artık yalnızca p_installer_fee'yi price_type'a göre ilgili breakdown
-- kolonuna (quantity_earning/area_earning/manual_earning — yalnızca bilgi
-- amaçlı, "hangi yöntemle girildi" kaydı) yazıyor; hiçbir çarpma/doğrulama
-- yok. quantity_rate/area_rate kolonları hâlâ p_unit_rate ile bilgi amaçlı
-- güncelleniyor (kullanıcının hangi birim fiyatı öneri olarak gördüğünün
-- kaydı) ama artık total_earning'i ETKİLEMİYOR.
--
-- DEĞİŞMEYEN: Yetki/kilit/izolasyon (STEP 1-2), installation_jobs UPDATE
-- (STEP 5), installer_earnings için "yalnızca UPDATE, asla INSERT" + SELECT
-- INTO STRICT ile veri bütünlüğü koruması (STEP 6), installer_transactions'a
-- dokunmama kararı, RETURN şekli (STEP 7), GRANT, schema reload.
--
-- migration_004/005'i DEĞİL bu dosyayı çalıştırın — CREATE OR REPLACE ile
-- hangisi canlıdaysa onun üzerine yazar.
--
-- Safe: Yalnızca CREATE OR REPLACE FUNCTION; tablo/kolon/policy/trigger
-- değişmiyor. Rollback: migration_005'in (veya 004'ün) gövdesini yeniden
-- CREATE OR REPLACE ile çalıştırın.
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
    v_earning_id uuid;
    v_quantity_earning numeric := 0;
    v_area_earning numeric := 0;
    v_manual_earning numeric := 0;
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
    SELECT status
    INTO v_job_status
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
    -- STEP 4: HAKEDİŞ TUTARI — HER ZAMAN p_installer_fee, HİÇBİR MODDA
    -- YENİDEN HESAPLANMAZ / REDDEDİLMEZ.
    -- ------------------------------------------------------------------------
    -- price_type yalnızca p_installer_fee'nin HANGİ breakdown kolonuna
    -- (bilgi amaçlı) yazılacağını belirler — tutarın kendisini değiştirmez.
    -- Adet/m2 + birim fiyat kombinasyonu artık yalnızca frontend'de bir
    -- ÖNERİ üretir; kullanıcı Hakediş alanını elle değiştirdiyse (veya
    -- öneri geçersizse) o son değer buraya p_installer_fee olarak gelir ve
    -- aynen kaydedilir. Firma sahibi kendi montajını yaptığında (hakediş
    -- istenmiyorsa) p_installer_fee=0 gönderilebilir — bu da geçerlidir.
    -- ========================================================================
    CASE p_price_type
        WHEN 'm2' THEN
            v_area_earning := p_installer_fee;
        WHEN 'adet' THEN
            v_quantity_earning := p_installer_fee;
        ELSE -- 'manuel'
            v_manual_earning := p_installer_fee;
    END CASE;

    -- ========================================================================
    -- STEP 5: installation_jobs GÜNCELLE (her zaman) — aynı transaction
    -- ========================================================================
    UPDATE public.installation_jobs
    SET
        price_type = p_price_type,
        unit_rate = p_unit_rate,
        installer_fee = p_installer_fee,
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
            total_earning = p_installer_fee,
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
        'total_earning', p_installer_fee,
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
UPDATE, asla yeni INSERT) günceller. p_installer_fee HER MODDA (manuel/m2/
adet) nihai tutar olarak doğrudan kaydedilir — sunucu tarafında yeniden
hesaplanmaz, yok sayılmaz veya area_m2/qty geçersiz diye reddedilmez (iş
kuralı: hakediş otomatik/zorunlu formülle kilitlenmez, dışarıdan montajcı
ücreti serbestçe belirlenebilir, 0 olabilir).
installation_jobs/installer_earnings tutarlılığını korur, ikinci earning
satırı oluşturmaz. Yetki: company admin/accounting veya super admin, aktif
abonelik gerekir.';

-- Notify schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;
