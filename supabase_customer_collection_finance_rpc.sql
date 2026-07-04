-- ============================================================
-- PERDEPRO - Musteri Tahsilati Finans Servis Katmani (FAZ 4)
-- CustomerCollectionService icin atomik RPC fonksiyonlari.
--
-- Kapsam: yalnizca customer_record_collection / customer_cancel_collection
-- RPC'leri + bunlarin ihtiyac duydugu ek (additive) kolonlar/index'ler.
-- Hicbir mevcut kolon/tablo/politika/trigger degistirilmez veya silinmez.
-- Hicbir ekran bu RPC'leri henuz cagirmiyor (bkz. src/services/finance) —
-- bu dosya calistirilsa bile production davranisi degismez.
--
-- ARASTIRMA BULGULARI (uygulamadan once incelendi):
--
-- 1) payments/income tablolari icin CREATE TABLE bu repoda YOK (dashboard'da
--    veya takip edilmeyen bir temel semada olusturulmus). Bilinen kolonlar
--    mevcut ekran kodundan (Accounting.tsx, OrderDetail.tsx) dogrulandi:
--      payments: id, company_id, order_id (nullable — bkz. supabase_
--        customer_collections.sql), customer_id (nullable), payment_date,
--        amount, method, note.
--      income:   id, company_id, income_date, amount, payment_method,
--        description, note, source, order_id.
--    Hicbir CHECK constraint bulunamadi (supplier_transactions.transaction_type
--    icin bulunan turden bir kisit YOK).
--
-- 2) KRITIK BULGU: payments ve income tablolari public.install_tenant_policy(
--    table, true) ile kurulmus ("p_accounting_only = true"). Bu, INSERT/UPDATE/
--    DELETE icin public.is_company_accounting(company_id) sartini (yalnizca
--    is_company_member DEGIL) getiriyor — supplier_transactions/installer_
--    transactions icin bu sart YOKTU. SECURITY DEFINER fonksiyon RLS'i bypass
--    ettigi icin bu sart burada ACIKCA tekrarlanir (asagida), aksi halde RPC,
--    dogrudan tablo yazan mevcut RLS'ten daha GEVSEK olurdu.
--
-- 3) install_tenant_policy ayrica her tabloya (payments/income/orders dahil)
--    "trg_<table>_tenant_write" adinda BEFORE INSERT/UPDATE trigger'i
--    (enforce_tenant_write()) kuruyor. Bu fonksiyonlarin (is_company_accounting,
--    is_company_writable, enforce_tenant_write) kaynak kodu bu repoda
--    bulunamadi (dashboard'da tanimlanmis) — davranislari DOGRULANAMADI.
--    Bu trigger'lar RLS bypass'inden ETKILENMEZ (trigger her zaman calisir).
--    Orders/payments/income zaten mevcut ekranlardan rutin olarak yaziliyor
--    ve calisiyor, bu yuzden trigger'in normal ayni-firma yazimlarini
--    engellemedigi varsayilir — ama tam davranis production'da RPC
--    calistirilmadan once dogrulanmalidir (bkz. rapor "kalan teknik borc").
--
-- 4) KRITIK BULGU: orders.status kolonu IKI FARKLI amac icin kullaniliyor:
--    (a) is akisi durumu (quote/received/production/.../archived — bkz.
--        src/utils/order.ts::ORDER_STATUS) VE (b) Accounting.tsx::saveIncome()
--        tarafindan odeme durumu ("paid"/"partial"/"open") icin — AYNI KOLONA
--        yaziyor, birbirini EZIYOR. Bu, bu RPC'nin YARATTIGI bir sorun DEGIL,
--        MEVCUT bir celiskidir. Bu RPC bilincli olarak orders.status'A HIC
--        DOKUNMAZ (yalnizca paid_amount/remaining_amount) — cakismayi
--        buyutmemek icin en guvenli mevcut davranisi (saveCollection()'in
--        status'a dokunmama yaklasimini) tercih eder. Hesaplanan odeme
--        durumu ("paid"/"partial"/"open") yine de jsonb yanitinda
--        DONDURULUR (yalniz bilgi amacli, DB'ye yazilmaz).
--
-- Reverse-entry (iptal) mantigi: HARD DELETE YOK.
--   - payments: yeni bir satir eklenir (reverses_payment_id ile orijinale
--     baglanir), orijinal satir SILINMEZ/degistirilmez.
--   - income: orijinal SILINMEZ; ayni mantikla -tutarli yeni bir satir
--     eklenir (reversal_of_income_id ile orijinale baglanir).
--
-- Fazla tahsilat politikasi: OrderDetail.tsx'teki EN ESKSIKSIZ davranis
-- (kabul et + bilgi olarak isaretle) referans alindi — saveIncome()/
-- saveCollection() farkli politikalar uyguluyor (biri kontrolsuz, biri sert
-- engelliyor); bu RPC hicbirini "duzeltmeye" calismaz, sadece en guvenli/
-- en az yikici olani (kabul et, veriyi kaybetme) uygular. Ekrana baglanmadan
-- once TEK politika karari verilmeli (bkz. onceki mimari inceleme).
--
-- Idempotency: idempotency_key verilirse ayni anahtarla ikinci cagri yeni
-- kayit olusturmaz; orijinal sonucu ayni sekilde geri doner (already_existed).
-- Replay sorgulari reverses_payment_id'ye GORE FILTRELENIR (installer/
-- supplier RPC'lerindeki derste oldugu gibi, nullable-reference hatasi
-- onlenir).
--
-- NOT: Bu migration Supabase'e UYGULANMADI. Repo'ya sadece dosya olarak
-- eklendi; calistirilmasi ayri bir onay gerektirir.
-- ============================================================

-- 1. Ek (additive) kolonlar ve index'ler --------------------------------------

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS reverses_payment_id UUID REFERENCES public.payments(id);
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS income_id UUID REFERENCES public.income(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_company_idempotency
    ON public.payments (company_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- Bir tahsilat satiri en fazla bir kez iptal edilebilir.
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_reverses_once
    ON public.payments (reverses_payment_id)
    WHERE reverses_payment_id IS NOT NULL;

ALTER TABLE public.income ADD COLUMN IF NOT EXISTS reversal_of_income_id UUID REFERENCES public.income(id);

-- 2. customer_record_collection ----------------------------------------------
--    Tek RPC cagrisi = tek DB transaction'i: income insert + payments insert
--    + orders.paid_amount/remaining_amount guncelleme, hepsi ayni fonksiyon
--    govdesinde. Herhangi bir adim basarisiz olursa TUMU geri alinir.

CREATE OR REPLACE FUNCTION public.customer_record_collection(
    p_company_id UUID,
    p_order_id UUID,
    p_amount NUMERIC,
    p_payment_method TEXT DEFAULT NULL,
    p_note TEXT DEFAULT NULL,
    p_collection_date TIMESTAMPTZ DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existing payments%ROWTYPE;
    v_order orders%ROWTYPE;
    v_income_id UUID;
    v_payment_id UUID;
    v_collection_ts TIMESTAMPTZ;
    v_current_paid NUMERIC;
    v_next_paid NUMERIC;
    v_next_remaining NUMERIC;
    v_computed_status TEXT;
    v_overpayment NUMERIC;
BEGIN
    IF NOT (p_company_id IN (SELECT public.my_company_ids()) OR public.is_super_admin()) THEN
        RAISE EXCEPTION 'unauthorized: bu firmaya erisim yok';
    END IF;

    -- SECURITY DEFINER fonksiyonlar RLS'i bypass eder; payments/income
    -- "accounting only" yazim politikasina sahiptir (bkz. dosya basi not) —
    -- bu yuzden ayni rol kontrolu burada acikca tekrarlanir.
    IF NOT public.is_company_accounting(p_company_id) THEN
        RAISE EXCEPTION 'unauthorized: bu islem icin muhasebe yetkisi gerekli';
    END IF;

    IF NOT public.check_subscription_active(p_company_id) THEN
        RAISE EXCEPTION 'unauthorized: firma lisansi/deneme suresi aktif degil';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'invalid_amount: tutar sifirdan buyuk olmali';
    END IF;

    IF p_order_id IS NULL THEN
        RAISE EXCEPTION 'invalid_reference: order_id gerekli';
    END IF;

    SELECT * INTO v_order FROM orders WHERE id = p_order_id AND company_id = p_company_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found: siparis bulunamadi';
    END IF;

    v_collection_ts := COALESCE(p_collection_date, now());

    -- Idempotency replay: ayni anahtarla ikinci cagri -> yeni kayit ACILMAZ,
    -- orijinal sonuc aynen geri donulur. reverses_payment_id IS NULL filtresi
    -- kasitlidir (bir iptal satirini yanlislikla "orijinal tahsilat" olarak
    -- eslestirmemek icin).
    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existing
        FROM payments
        WHERE company_id = p_company_id AND idempotency_key = p_idempotency_key
              AND reverses_payment_id IS NULL
        LIMIT 1;

        IF FOUND THEN
            SELECT COALESCE(SUM(CASE WHEN reverses_payment_id IS NULL THEN amount ELSE -amount END), 0)
            INTO v_current_paid
            FROM payments
            WHERE order_id = v_existing.order_id AND company_id = p_company_id;

            v_next_remaining := GREATEST(COALESCE(v_order.total_amount, 0) - v_current_paid, 0);
            v_computed_status := CASE
                WHEN v_next_remaining <= 0 THEN 'paid'
                WHEN v_current_paid > 0 THEN 'partial'
                ELSE 'open'
            END;
            v_overpayment := GREATEST(v_current_paid - COALESCE(v_order.total_amount, 0), 0);

            RETURN jsonb_build_object(
                'payment_id', v_existing.id,
                'income_id', v_existing.income_id,
                'order_id', v_existing.order_id,
                'amount', v_existing.amount,
                'new_paid_amount', v_current_paid,
                'new_remaining_amount', v_next_remaining,
                'new_status', v_computed_status,
                'is_overpayment', v_overpayment > 0,
                'overpayment_amount', v_overpayment,
                'already_existed', true
            );
        END IF;
    END IF;

    -- 1) Gelir kaydi (income) — mevcut ekranlarla senkron (source=order_payment).
    INSERT INTO income (company_id, income_date, amount, payment_method, description, note, source, order_id)
    VALUES (
        p_company_id, v_collection_ts, p_amount, p_payment_method,
        COALESCE(p_note, 'Siparis tahsilati'), p_note, 'order_payment', p_order_id
    )
    RETURNING id INTO v_income_id;

    -- 2) Tahsilat kaydi (payments) — income'a income_id ile baglanir.
    INSERT INTO payments (company_id, order_id, payment_date, amount, method, note, income_id, idempotency_key)
    VALUES (p_company_id, p_order_id, v_collection_ts, p_amount, p_payment_method, p_note, v_income_id, p_idempotency_key)
    RETURNING id INTO v_payment_id;

    -- 3) Bakiye SADECE yukaridaki iki insert basariyla tamamlandiktan sonra
    --    hesaplanir (siparis bakiyesi payments ledger'indan turetilir, cache
    --    kolonundan degil — surukleme/sapma riskini ortadan kaldirir).
    SELECT COALESCE(SUM(CASE WHEN reverses_payment_id IS NULL THEN amount ELSE -amount END), 0)
    INTO v_next_paid
    FROM payments
    WHERE order_id = p_order_id AND company_id = p_company_id;

    v_next_remaining := GREATEST(COALESCE(v_order.total_amount, 0) - v_next_paid, 0);
    v_overpayment := GREATEST(v_next_paid - COALESCE(v_order.total_amount, 0), 0);
    v_computed_status := CASE
        WHEN v_next_remaining <= 0 THEN 'paid'
        WHEN v_next_paid > 0 THEN 'partial'
        ELSE 'open'
    END;

    -- orders.status'A BILINCLI OLARAK DOKUNULMAZ (bkz. dosya basi bulgu #4) —
    -- yalnizca paid_amount/remaining_amount guncellenir.
    UPDATE orders
    SET paid_amount = v_next_paid,
        remaining_amount = v_next_remaining
    WHERE id = p_order_id AND company_id = p_company_id;

    RETURN jsonb_build_object(
        'payment_id', v_payment_id,
        'income_id', v_income_id,
        'order_id', p_order_id,
        'amount', p_amount,
        'new_paid_amount', v_next_paid,
        'new_remaining_amount', v_next_remaining,
        'new_status', v_computed_status,
        'is_overpayment', v_overpayment > 0,
        'overpayment_amount', v_overpayment,
        'already_existed', false
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.customer_record_collection(UUID, UUID, NUMERIC, TEXT, TEXT, TIMESTAMPTZ, TEXT) TO authenticated;

-- 3. customer_cancel_collection — ters kayit (reverse entry), HARD DELETE YOK -

CREATE OR REPLACE FUNCTION public.customer_cancel_collection(
    p_company_id UUID,
    p_payment_id UUID,
    p_note TEXT DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_original payments%ROWTYPE;
    v_order orders%ROWTYPE;
    v_already_reversed payments%ROWTYPE;
    v_existing_replay payments%ROWTYPE;
    v_reversal_income_id UUID;
    v_reversal_payment_id UUID;
    v_next_paid NUMERIC;
    v_next_remaining NUMERIC;
    v_computed_status TEXT;
    v_overpayment NUMERIC;
BEGIN
    IF NOT (p_company_id IN (SELECT public.my_company_ids()) OR public.is_super_admin()) THEN
        RAISE EXCEPTION 'unauthorized: bu firmaya erisim yok';
    END IF;

    IF NOT public.is_company_accounting(p_company_id) THEN
        RAISE EXCEPTION 'unauthorized: bu islem icin muhasebe yetkisi gerekli';
    END IF;

    IF NOT public.check_subscription_active(p_company_id) THEN
        RAISE EXCEPTION 'unauthorized: firma lisansi/deneme suresi aktif degil';
    END IF;

    IF p_payment_id IS NULL THEN
        RAISE EXCEPTION 'invalid_reference: payment_id gerekli';
    END IF;

    -- Replay sorgusu reverses_payment_id IS NOT NULL ile filtrelenir — ayni
    -- idempotency_key yanlislikla hem tahsilat hem iptal icin kullanilsa bile
    -- bu sorgu asla bir orijinal tahsilat satirini bulamaz.
    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existing_replay
        FROM payments
        WHERE company_id = p_company_id AND idempotency_key = p_idempotency_key
              AND reverses_payment_id IS NOT NULL
        LIMIT 1;

        IF FOUND THEN
            SELECT * INTO v_order FROM orders WHERE id = v_existing_replay.order_id AND company_id = p_company_id;

            SELECT COALESCE(SUM(CASE WHEN reverses_payment_id IS NULL THEN amount ELSE -amount END), 0)
            INTO v_next_paid
            FROM payments
            WHERE order_id = v_existing_replay.order_id AND company_id = p_company_id;

            v_next_remaining := GREATEST(COALESCE(v_order.total_amount, 0) - v_next_paid, 0);
            v_overpayment := GREATEST(v_next_paid - COALESCE(v_order.total_amount, 0), 0);
            v_computed_status := CASE
                WHEN v_next_remaining <= 0 THEN 'paid'
                WHEN v_next_paid > 0 THEN 'partial'
                ELSE 'open'
            END;

            RETURN jsonb_build_object(
                'payment_id', v_existing_replay.id,
                'reversed_payment_id', v_existing_replay.reverses_payment_id,
                'income_id', v_existing_replay.income_id,
                'order_id', v_existing_replay.order_id,
                'amount', v_existing_replay.amount,
                'new_paid_amount', v_next_paid,
                'new_remaining_amount', v_next_remaining,
                'new_status', v_computed_status,
                'is_overpayment', v_overpayment > 0,
                'overpayment_amount', v_overpayment,
                'already_existed', true
            );
        END IF;
    END IF;

    SELECT * INTO v_original
    FROM payments
    WHERE id = p_payment_id AND company_id = p_company_id AND reverses_payment_id IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found: iptal edilecek tahsilat bulunamadi';
    END IF;

    SELECT * INTO v_already_reversed
    FROM payments
    WHERE reverses_payment_id = p_payment_id;

    IF FOUND THEN
        RAISE EXCEPTION 'invalid_reference: bu tahsilat zaten iptal edilmis';
    END IF;

    SELECT * INTO v_order FROM orders WHERE id = v_original.order_id AND company_id = p_company_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found: siparis bulunamadi';
    END IF;

    -- 1) Ters gelir kaydi — orijinal income satiri SILINMEZ; -tutarli yeni
    --    bir satir eklenir (reversal_of_income_id ile orijinale baglanir).
    IF v_original.income_id IS NOT NULL THEN
        INSERT INTO income (company_id, income_date, amount, payment_method, description, note, source, order_id, reversal_of_income_id)
        VALUES (
            p_company_id, now(), -v_original.amount, NULL,
            'Tahsilat iptali', COALESCE(p_note, 'Iptal edilen tahsilat'),
            'order_payment', v_original.order_id, v_original.income_id
        )
        RETURNING id INTO v_reversal_income_id;
    END IF;

    -- 2) Ters tahsilat kaydi — yeni satir (hard delete YOK, append-only kalir).
    INSERT INTO payments (company_id, order_id, payment_date, amount, method, note, income_id, reverses_payment_id, idempotency_key)
    VALUES (
        p_company_id, v_original.order_id, now(), v_original.amount, v_original.method,
        COALESCE(p_note, 'Iptal: ' || COALESCE(v_original.note, 'tahsilat')),
        v_reversal_income_id, p_payment_id, p_idempotency_key
    )
    RETURNING id INTO v_reversal_payment_id;

    -- 3) Bakiye SADECE yukaridaki insert'ler basariyla tamamlandiktan sonra
    --    hesaplanir.
    SELECT COALESCE(SUM(CASE WHEN reverses_payment_id IS NULL THEN amount ELSE -amount END), 0)
    INTO v_next_paid
    FROM payments
    WHERE order_id = v_original.order_id AND company_id = p_company_id;

    v_next_remaining := GREATEST(COALESCE(v_order.total_amount, 0) - v_next_paid, 0);
    v_overpayment := GREATEST(v_next_paid - COALESCE(v_order.total_amount, 0), 0);
    v_computed_status := CASE
        WHEN v_next_remaining <= 0 THEN 'paid'
        WHEN v_next_paid > 0 THEN 'partial'
        ELSE 'open'
    END;

    -- orders.status'A BILINCLI OLARAK DOKUNULMAZ (bkz. dosya basi bulgu #4).
    UPDATE orders
    SET paid_amount = v_next_paid,
        remaining_amount = v_next_remaining
    WHERE id = v_original.order_id AND company_id = p_company_id;

    RETURN jsonb_build_object(
        'payment_id', v_reversal_payment_id,
        'reversed_payment_id', p_payment_id,
        'income_id', v_reversal_income_id,
        'order_id', v_original.order_id,
        'amount', v_original.amount,
        'new_paid_amount', v_next_paid,
        'new_remaining_amount', v_next_remaining,
        'new_status', v_computed_status,
        'is_overpayment', v_overpayment > 0,
        'overpayment_amount', v_overpayment,
        'already_existed', false
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.customer_cancel_collection(UUID, UUID, TEXT, TEXT) TO authenticated;

-- 4. Schema cache
NOTIFY pgrst, 'reload schema';

-- SONUC
SELECT 'SONUC: customer_record_collection/customer_cancel_collection hazir' AS check_name,
       to_regprocedure('public.customer_record_collection(uuid, uuid, numeric, text, text, timestamptz, text)') IS NOT NULL
       AND to_regprocedure('public.customer_cancel_collection(uuid, uuid, text, text)') IS NOT NULL AS ok;
