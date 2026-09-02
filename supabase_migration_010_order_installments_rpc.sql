-- ============================================================================
-- MIGRATION 010: order_payment_plans / order_installments icin RPC katmani.
--
-- HENUZ PRODUCTION'DA CALISTIRILMADI. Ayrica incelenip onaylandiktan sonra
-- Supabase SQL Editor'da elle calistirilacak.
--
-- REVIZYON: 009 production'da zaten uygulanmis oldugundan, bu dosya once
-- guvenli (additive) ALTER TABLE ile eksik denetim/soft-delete alanlarini
-- ekler, sonra RPC'leri tanimlar.
--   - order_payment_plans.updated_by (kim son degistirdi)
--   - order_payment_plans.status / cancelled_at / cancelled_by (hard delete
--     YERINE soft-cancel — finansal/taksit gecmisi fiziksel olarak kaybolmaz)
--   - order_id UNIQUE constraint, yalniz AKTIF planlar icin gecerli PARTIAL
--     UNIQUE INDEX'e cevrilir (bir sipariste ayni anda yalniz 1 aktif plan,
--     ama iptal edilmis eski planlar tabloda kalabilir ve yeni bir aktif
--     plan olusturulabilir).
--
-- Kapsam: yalnizca create_order_installment_plan / rebuild_order_installment_plan
-- / cancel_order_installment_plan (eski adiyla delete_order_installment_plan —
-- artik hard delete yapmadigi icin adi degistirildi, henuz hicbir frontend
-- kodu buna baglanmadigindan yeniden adlandirma risksiz).
-- customer_record_collection / customer_cancel_collection fonksiyonlarina,
-- orders.payment_due_date kolonuna ve 009'daki tenant consistency
-- trigger'larina HIC DOKUNULMADI. Hacer Karaman backfill'i bu dosyada YOK,
-- ayri bir asamada yapilacak.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 0) GUVENLI (ADDITIVE) SEMA DUZELTMELERI — 009 zaten production'da oldugu
--    icin IF NOT EXISTS / IF EXISTS ile idempotent yazildi.
-- ============================================================================

ALTER TABLE public.order_payment_plans ADD COLUMN IF NOT EXISTS updated_by uuid;
ALTER TABLE public.order_payment_plans ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';
ALTER TABLE public.order_payment_plans ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE public.order_payment_plans ADD COLUMN IF NOT EXISTS cancelled_by uuid;

ALTER TABLE public.order_payment_plans DROP CONSTRAINT IF EXISTS order_payment_plans_status_check;
ALTER TABLE public.order_payment_plans ADD CONSTRAINT order_payment_plans_status_check CHECK (status IN ('active', 'cancelled'));

-- 009'da order_id UNIQUE olarak (tum satirlar icin) tanimlanmisti. Soft-cancel
-- ile ayni order_id'ye ait BIRDEN FAZLA (bir aktif + N iptal edilmis) satir
-- olabilmesi gerektigi icin, tablo-seviyesi UNIQUE kaldirilip yalniz
-- status='active' satirlar icin gecerli PARTIAL UNIQUE INDEX'e cevrilir.
-- Boylece "bir sipariste ayni anda yalniz 1 aktif plan" kurali korunur, ama
-- iptal edilmis eski planlar fiziksel olarak silinmeden tabloda kalabilir.
ALTER TABLE public.order_payment_plans DROP CONSTRAINT IF EXISTS order_payment_plans_order_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_order_payment_plans_active_order
    ON public.order_payment_plans(order_id)
    WHERE status = 'active';

-- ============================================================================
-- create_order_installment_plan — YALNIZCA AKTIF plan YOKKEN calisir.
-- Aktif plan varsa hata verir (sessiz upsert YOK) — odenmis bir planin
-- baseline'i farkinda olunmadan sifirlanamaz.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_order_installment_plan(
    p_company_id UUID,
    p_order_id UUID,
    p_installments JSONB  -- [{"installment_no":1,"amount":10000,"due_date":"2026-07-01"}, ...]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order orders%ROWTYPE;
    v_live_paid numeric;
    v_opening_remaining numeric;
    v_sum numeric;
    v_item jsonb;
    v_item_count int;
    v_distinct_count int;
    v_plan_id uuid;
    v_count int := 0;
BEGIN
    IF NOT (
        public.is_super_admin()
        OR public.is_company_admin(p_company_id)
        OR public.is_company_accounting(p_company_id)
    ) THEN
        RAISE EXCEPTION 'unauthorized: bu islem icin admin veya muhasebe yetkisi gerekli';
    END IF;

    IF NOT public.check_subscription_active(p_company_id) THEN
        RAISE EXCEPTION 'unauthorized: firma lisansi/deneme suresi aktif degil';
    END IF;

    SELECT * INTO v_order FROM orders WHERE id = p_order_id AND company_id = p_company_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found: siparis bulunamadi';
    END IF;

    IF EXISTS (
        SELECT 1 FROM order_payment_plans
        WHERE order_id = p_order_id AND company_id = p_company_id AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'plan_exists: bu siparis icin zaten AKTIF bir odeme plani var — degistirmek icin rebuild_order_installment_plan kullanin';
    END IF;

    IF p_installments IS NULL THEN
        RAISE EXCEPTION 'invalid_installments: taksit listesi bos olamaz (NULL)';
    END IF;
    IF jsonb_typeof(p_installments) <> 'array' THEN
        RAISE EXCEPTION 'invalid_installments: taksit listesi bir JSON array olmali';
    END IF;
    IF jsonb_array_length(p_installments) = 0 THEN
        RAISE EXCEPTION 'invalid_installments: en az 1 taksit girilmeli';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_installments) LOOP
        IF NOT (v_item ? 'installment_no') OR (v_item->>'installment_no') IS NULL THEN
            RAISE EXCEPTION 'invalid_installments: installment_no zorunlu, satir: %', v_item;
        END IF;
        IF (v_item->>'installment_no') !~ '^[0-9]+$' THEN
            RAISE EXCEPTION 'invalid_installments: installment_no pozitif tam sayi olmali, satir: %', v_item;
        END IF;
        IF (v_item->>'installment_no')::int <= 0 THEN
            RAISE EXCEPTION 'invalid_installments: installment_no pozitif olmali, satir: %', v_item;
        END IF;

        IF NOT (v_item ? 'amount') OR (v_item->>'amount') IS NULL THEN
            RAISE EXCEPTION 'invalid_installments: amount zorunlu, satir: %', v_item;
        END IF;
        IF (v_item->>'amount')::numeric <= 0 THEN
            RAISE EXCEPTION 'invalid_installments: amount sifirdan buyuk olmali, satir: %', v_item;
        END IF;

        IF NOT (v_item ? 'due_date') OR (v_item->>'due_date') IS NULL THEN
            RAISE EXCEPTION 'invalid_installments: due_date zorunlu, satir: %', v_item;
        END IF;
        PERFORM (v_item->>'due_date')::date;
    END LOOP;

    SELECT count(*), count(DISTINCT (item->>'installment_no')::int)
    INTO v_item_count, v_distinct_count
    FROM jsonb_array_elements(p_installments) item;

    IF v_item_count <> v_distinct_count THEN
        RAISE EXCEPTION 'invalid_installments: installment_no degerleri tekrar edemez';
    END IF;

    SELECT COALESCE(SUM(CASE WHEN reverses_payment_id IS NULL THEN amount ELSE -amount END), 0)
    INTO v_live_paid
    FROM payments WHERE order_id = p_order_id AND company_id = p_company_id;

    v_opening_remaining := GREATEST(COALESCE(v_order.total_amount, 0) - v_live_paid, 0);

    SELECT COALESCE(SUM((item->>'amount')::numeric), 0) INTO v_sum
    FROM jsonb_array_elements(p_installments) AS item;

    IF abs(v_sum - v_opening_remaining) > 0.01 THEN
        RAISE EXCEPTION 'invalid_amount: taksit toplami (%) kalan borca (%) esit degil', v_sum, v_opening_remaining;
    END IF;

    INSERT INTO order_payment_plans (
        company_id, order_id, opening_total_amount, opening_paid_amount, opening_remaining_amount,
        status, created_by, updated_by
    )
    VALUES (
        p_company_id, p_order_id, v_order.total_amount, v_live_paid, v_opening_remaining,
        'active', auth.uid(), auth.uid()
    )
    RETURNING id INTO v_plan_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_installments) LOOP
        INSERT INTO order_installments (plan_id, company_id, order_id, installment_no, amount, due_date)
        VALUES (
            v_plan_id, p_company_id, p_order_id,
            (v_item->>'installment_no')::int,
            (v_item->>'amount')::numeric,
            (v_item->>'due_date')::date
        );
        v_count := v_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'plan_id', v_plan_id,
        'order_id', p_order_id,
        'installment_count', v_count,
        'opening_total_amount', v_order.total_amount,
        'opening_paid_amount', v_live_paid,
        'opening_remaining_amount', v_opening_remaining
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_order_installment_plan(UUID, UUID, JSONB) TO authenticated;

-- ============================================================================
-- rebuild_order_installment_plan — MEVCUT AKTIF bir plani, baseline'i o anki
-- CANLI ledger durumuna SIFIRLAYARAK yeniden kurar. created_by DEGISMEZ;
-- yalnizca updated_by = auth.uid() olarak guncellenir. Kullanici arayuzu bunu
-- "bu islem gecmis taksit takibini sifirlar" uyarisiyla gostermeli.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rebuild_order_installment_plan(
    p_company_id UUID,
    p_order_id UUID,
    p_installments JSONB
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_order orders%ROWTYPE;
    v_live_paid numeric;
    v_opening_remaining numeric;
    v_sum numeric;
    v_item jsonb;
    v_item_count int;
    v_distinct_count int;
    v_plan_id uuid;
    v_count int := 0;
BEGIN
    IF NOT (
        public.is_super_admin()
        OR public.is_company_admin(p_company_id)
        OR public.is_company_accounting(p_company_id)
    ) THEN
        RAISE EXCEPTION 'unauthorized: bu islem icin admin veya muhasebe yetkisi gerekli';
    END IF;

    IF NOT public.check_subscription_active(p_company_id) THEN
        RAISE EXCEPTION 'unauthorized: firma lisansi/deneme suresi aktif degil';
    END IF;

    SELECT * INTO v_order FROM orders WHERE id = p_order_id AND company_id = p_company_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found: siparis bulunamadi';
    END IF;

    SELECT id INTO v_plan_id
    FROM order_payment_plans
    WHERE order_id = p_order_id AND company_id = p_company_id AND status = 'active';

    IF v_plan_id IS NULL THEN
        RAISE EXCEPTION 'not_found: bu siparis icin aktif bir plan yok — once create_order_installment_plan kullanin';
    END IF;

    IF p_installments IS NULL THEN
        RAISE EXCEPTION 'invalid_installments: taksit listesi bos olamaz (NULL)';
    END IF;
    IF jsonb_typeof(p_installments) <> 'array' THEN
        RAISE EXCEPTION 'invalid_installments: taksit listesi bir JSON array olmali';
    END IF;
    IF jsonb_array_length(p_installments) = 0 THEN
        RAISE EXCEPTION 'invalid_installments: en az 1 taksit girilmeli';
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_installments) LOOP
        IF NOT (v_item ? 'installment_no') OR (v_item->>'installment_no') IS NULL THEN
            RAISE EXCEPTION 'invalid_installments: installment_no zorunlu, satir: %', v_item;
        END IF;
        IF (v_item->>'installment_no') !~ '^[0-9]+$' THEN
            RAISE EXCEPTION 'invalid_installments: installment_no pozitif tam sayi olmali, satir: %', v_item;
        END IF;
        IF (v_item->>'installment_no')::int <= 0 THEN
            RAISE EXCEPTION 'invalid_installments: installment_no pozitif olmali, satir: %', v_item;
        END IF;

        IF NOT (v_item ? 'amount') OR (v_item->>'amount') IS NULL THEN
            RAISE EXCEPTION 'invalid_installments: amount zorunlu, satir: %', v_item;
        END IF;
        IF (v_item->>'amount')::numeric <= 0 THEN
            RAISE EXCEPTION 'invalid_installments: amount sifirdan buyuk olmali, satir: %', v_item;
        END IF;

        IF NOT (v_item ? 'due_date') OR (v_item->>'due_date') IS NULL THEN
            RAISE EXCEPTION 'invalid_installments: due_date zorunlu, satir: %', v_item;
        END IF;
        PERFORM (v_item->>'due_date')::date;
    END LOOP;

    SELECT count(*), count(DISTINCT (item->>'installment_no')::int)
    INTO v_item_count, v_distinct_count
    FROM jsonb_array_elements(p_installments) item;

    IF v_item_count <> v_distinct_count THEN
        RAISE EXCEPTION 'invalid_installments: installment_no degerleri tekrar edemez';
    END IF;

    SELECT COALESCE(SUM(CASE WHEN reverses_payment_id IS NULL THEN amount ELSE -amount END), 0)
    INTO v_live_paid
    FROM payments WHERE order_id = p_order_id AND company_id = p_company_id;

    v_opening_remaining := GREATEST(COALESCE(v_order.total_amount, 0) - v_live_paid, 0);

    SELECT COALESCE(SUM((item->>'amount')::numeric), 0) INTO v_sum
    FROM jsonb_array_elements(p_installments) AS item;

    IF abs(v_sum - v_opening_remaining) > 0.01 THEN
        RAISE EXCEPTION 'invalid_amount: taksit toplami (%) kalan borca (%) esit degil', v_sum, v_opening_remaining;
    END IF;

    -- created_by KASITLI OLARAK burada yok — degismez. Yalniz updated_by yenilenir.
    UPDATE order_payment_plans
    SET opening_total_amount = v_order.total_amount,
        opening_paid_amount = v_live_paid,
        opening_remaining_amount = v_opening_remaining,
        updated_by = auth.uid(),
        updated_at = now()
    WHERE id = v_plan_id;

    DELETE FROM order_installments WHERE plan_id = v_plan_id;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_installments) LOOP
        INSERT INTO order_installments (plan_id, company_id, order_id, installment_no, amount, due_date)
        VALUES (
            v_plan_id, p_company_id, p_order_id,
            (v_item->>'installment_no')::int,
            (v_item->>'amount')::numeric,
            (v_item->>'due_date')::date
        );
        v_count := v_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'plan_id', v_plan_id,
        'order_id', p_order_id,
        'installment_count', v_count,
        'baseline_reset', true,
        'opening_total_amount', v_order.total_amount,
        'opening_paid_amount', v_live_paid,
        'opening_remaining_amount', v_opening_remaining
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rebuild_order_installment_plan(UUID, UUID, JSONB) TO authenticated;

-- ============================================================================
-- cancel_order_installment_plan (ONCEKI TASLAKTA delete_order_installment_plan
-- idi — artik hard delete yapmadigi icin adi degistirildi; henuz hicbir
-- frontend kodu bu RPC'lere baglanmadigindan bu yeniden adlandirma risksiz).
--
-- HARD DELETE YOK. order_payment_plans satiri status='cancelled' olarak
-- isaretlenir, cancelled_at/cancelled_by doldurulur. order_installments
-- satirlari da FIZIKSEL OLARAK SILINMEZ (plan_id hala gecerli, taksit
-- gecmisi tamamen korunur). payments/income tablolarina HIC DOKUNULMAZ.
--
-- Iptalden sonra ayni siparis icin create_order_installment_plan tekrar
-- cagrilarak YENI bir aktif plan olusturulabilir (partial unique index bunu
-- destekler — status='active' olan en fazla 1 satir olabilir, cancelled
-- satirlar sinirlamaya dahil degildir).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cancel_order_installment_plan(
    p_company_id UUID,
    p_order_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_plan_id uuid;
BEGIN
    IF NOT (
        public.is_super_admin()
        OR public.is_company_admin(p_company_id)
        OR public.is_company_accounting(p_company_id)
    ) THEN
        RAISE EXCEPTION 'unauthorized: bu islem icin admin veya muhasebe yetkisi gerekli';
    END IF;

    IF NOT public.check_subscription_active(p_company_id) THEN
        RAISE EXCEPTION 'unauthorized: firma lisansi/deneme suresi aktif degil';
    END IF;

    SELECT id INTO v_plan_id
    FROM order_payment_plans
    WHERE order_id = p_order_id AND company_id = p_company_id AND status = 'active';

    IF v_plan_id IS NULL THEN
        RAISE EXCEPTION 'not_found: bu siparis icin aktif bir odeme plani yok';
    END IF;

    UPDATE order_payment_plans
    SET status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = auth.uid(),
        updated_by = auth.uid(),
        updated_at = now()
    WHERE id = v_plan_id;

    RETURN jsonb_build_object('success', true, 'plan_id', v_plan_id, 'order_id', p_order_id, 'status', 'cancelled');
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_order_installment_plan(UUID, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
