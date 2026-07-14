-- ============================================================
-- PERDEPRO - Montajci Odemesi Finans Servis Katmani (FAZ 2)
-- InstallerPaymentService icin atomik RPC fonksiyonlari.
--
-- Kapsam: yalnizca installer_record_payment / installer_cancel_payment
-- RPC'leri + bunlarin ihtiyac duydugu ek (additive) kolonlar.
-- Hicbir mevcut kolon/tablo/politika degistirilmez veya silinmez.
-- Hicbir ekran bu RPC'leri henuz cagirmiyor (bkz. src/services/finance) —
-- bu dosya calistirilsa bile production davranisi degismez.
--
-- Iptal (cancel) mantigi: TERS KAYIT (reverse entry). HARD DELETE YOK.
--   - installer_transactions: yeni bir 'cancel' satiri eklenir
--     (reverses_transaction_id ile orijinal 'payment' satirina baglanir).
--   - expenses: orijinal gider SILINMEZ; -tutarli yeni bir "iptal" gider
--     satiri eklenir (reversal_of_expense_id ile orijinale baglanir).
--     Boylece "Toplam Gider" toplami dogru netlesir, denetim izi tam kalir
--     (eski InstallerLedger.tsx::cancelPayment'in hard-delete davranisindan
--     BILINCLI olarak farklidir).
--
-- Idempotency: idempotency_key verilirse ayni anahtarla ikinci cagri yeni
-- kayit olusturmaz; orijinal sonucu ayni sekilde geri doner (already_existed).
--
-- NOT: Bu migration Supabase'e UYGULANMADI. Repo'ya sadece dosya olarak
-- eklendi; calistirilmasi ayri bir onay gerektirir (bkz. proje konvansiyonu:
-- diger supabase_*.sql dosyalari gibi SQL Editor'de tek Run'da islenir).
-- ============================================================

-- 1. Ek (additive) kolonlar --------------------------------------------------

ALTER TABLE installer_transactions ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE installer_transactions ADD COLUMN IF NOT EXISTS reverses_transaction_id UUID REFERENCES installer_transactions(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_installer_tx_company_idempotency
    ON installer_transactions (company_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- Bir 'payment' satiri en fazla bir kez iptal edilebilir.
CREATE UNIQUE INDEX IF NOT EXISTS uq_installer_tx_reverses_once
    ON installer_transactions (reverses_transaction_id)
    WHERE reverses_transaction_id IS NOT NULL;

ALTER TABLE expenses ADD COLUMN IF NOT EXISTS reversal_of_expense_id UUID REFERENCES expenses(id);

-- 2. installer_record_payment -------------------------------------------------
--    Tek RPC cagrisi = tek DB transaction'i: expenses insert + installer_
--    transactions insert + bakiye hesaplama, hepsi ayni fonksiyon govdesinde.
--    Herhangi bir adim basarisiz olursa TUMU geri alinir (Postgres fonksiyon
--    govdesi tek transaction'dir) — bakiye ASLA yaridan yazilmis veriyle
--    hesaplanmaz.

CREATE OR REPLACE FUNCTION public.installer_record_payment(
    p_company_id UUID,
    p_installer_id UUID,
    p_amount NUMERIC,
    p_payment_method TEXT DEFAULT NULL,
    p_period_start DATE DEFAULT NULL,
    p_period_end DATE DEFAULT NULL,
    p_note TEXT DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existing installer_transactions%ROWTYPE;
    v_expense_id UUID;
    v_transaction_id UUID;
    v_earned NUMERIC;
    v_paid NUMERIC;
    v_new_balance NUMERIC;
    v_automatic_earned NUMERIC;
    v_manual_earned NUMERIC;
BEGIN
    IF NOT (p_company_id IN (SELECT public.my_company_ids()) OR public.is_super_admin()) THEN
        RAISE EXCEPTION 'unauthorized: bu firmaya erisim yok';
    END IF;

    -- SECURITY DEFINER fonksiyonlar RLS'i bypass eder, dolayisiyla expenses
    -- uzerindeki "Block all if trial expired" politikasi burada devreye
    -- girmez — bu yuzden ayni kontrol acikca burada tekrarlanir.
    IF NOT public.check_subscription_active(p_company_id) THEN
        RAISE EXCEPTION 'unauthorized: firma lisansi/deneme suresi aktif degil';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'invalid_amount: tutar sifirdan buyuk olmali';
    END IF;

    IF p_installer_id IS NULL THEN
        RAISE EXCEPTION 'invalid_reference: installer_id gerekli';
    END IF;

    -- Idempotency replay: ayni anahtarla ikinci cagri -> yeni kayit ACILMAZ,
    -- orijinal sonuc aynen geri donulur (cift tiklama / ag retry guvenli).
    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existing
        FROM installer_transactions
        WHERE company_id = p_company_id AND idempotency_key = p_idempotency_key
        LIMIT 1;

        IF FOUND THEN
            -- Idempotency replay: recalculate balance (may have changed since first request)
            SELECT COALESCE(SUM(ij.installer_fee), 0)
            INTO v_automatic_earned
            FROM installation_jobs ij
            WHERE ij.assigned_staff_id = v_existing.installer_id AND ij.status = 'completed';

            SELECT COALESCE(SUM(ie.total_earning), 0)
            INTO v_manual_earned
            FROM installer_earnings ie
            WHERE ie.installer_id = v_existing.installer_id
              AND ie.company_id = p_company_id
              AND ie.earning_type = 'manual'
              AND ie.installation_job_id IS NULL;

            SELECT COALESCE(SUM(CASE WHEN it.transaction_type = 'payment' THEN it.amount WHEN it.transaction_type = 'cancel' THEN -it.amount ELSE 0 END), 0)
            INTO v_paid
            FROM installer_transactions it
            WHERE it.installer_id = v_existing.installer_id
              AND it.company_id = p_company_id
              AND it.transaction_type NOT IN ('earning');

            v_earned := v_automatic_earned + v_manual_earned;
            v_new_balance := GREATEST(v_earned - v_paid, 0);

            RETURN jsonb_build_object(
                'transaction_id', v_existing.id,
                'expense_id', v_existing.expense_id,
                'installer_id', v_existing.installer_id,
                'amount', v_existing.amount,
                'new_balance', v_new_balance,
                'already_existed', true
            );
        END IF;
    END IF;

    -- 1) Gider kaydi (expenses) — Giderler ekraniyla senkron (eski InstallerLedger
    --    davranisiyla ayni kategori/status).
    INSERT INTO expenses (company_id, amount, expense_date, category, status, note)
    VALUES (p_company_id, p_amount, now(), 'Montajci Odemesi', 'paid', p_note)
    RETURNING id INTO v_expense_id;

    -- 2) Montajci cari hareketi (installer_transactions).
    INSERT INTO installer_transactions (
        company_id, installer_id, transaction_date, transaction_type,
        amount, description, payment_method, period_start, period_end,
        expense_id, idempotency_key
    )
    VALUES (
        p_company_id, p_installer_id, now(), 'payment',
        p_amount, p_note, p_payment_method, p_period_start, p_period_end,
        v_expense_id, p_idempotency_key
    )
    RETURNING id INTO v_transaction_id;

    -- 3) Bakiye SADECE yukaridaki iki insert basariyla tamamlandiktan sonra
    --    hesaplanir (montajci bakiyesi zaten stored bir kolon degil, her
    --    zaman ledger'dan turetilir — "guncelleme" degil "hesaplama"dir).
    --
    --    UPDATED for manual earnings support:
    --    Balance = automatic_earned + manual_earned - paid
    --    Where:
    --    - automatic_earned = SUM(installation_jobs.installer_fee) WHERE status='completed'
    --    - manual_earned = SUM(installer_earnings.total_earning) WHERE earning_type='manual' AND installation_job_id IS NULL
    --    - paid = SUM(payment - cancel) excludes 'earning' type transactions

    -- Automatic earned (from completed jobs)
    SELECT COALESCE(SUM(ij.installer_fee), 0)
    INTO v_automatic_earned
    FROM installation_jobs ij
    WHERE ij.assigned_staff_id = p_installer_id
      AND ij.status = 'completed'
      AND ij.company_id = p_company_id;

    -- Manual earned (from manual earnings entries)
    SELECT COALESCE(SUM(ie.total_earning), 0)
    INTO v_manual_earned
    FROM installer_earnings ie
    WHERE ie.installer_id = p_installer_id
      AND ie.company_id = p_company_id
      AND ie.earning_type = 'manual'
      AND ie.installation_job_id IS NULL;

    -- Paid (exact formula: exclude 'earning' type transactions)
    SELECT COALESCE(SUM(
        CASE
            WHEN it.transaction_type = 'payment' THEN it.amount
            WHEN it.transaction_type = 'cancel' THEN -it.amount
            ELSE 0
        END
    ), 0)
    INTO v_paid
    FROM installer_transactions it
    WHERE it.installer_id = p_installer_id
      AND it.company_id = p_company_id
      AND it.transaction_type NOT IN ('earning');

    -- Balance = automatic + manual - paid
    v_earned := v_automatic_earned + v_manual_earned;
    v_new_balance := GREATEST(v_earned - v_paid, 0);

    RETURN jsonb_build_object(
        'transaction_id', v_transaction_id,
        'expense_id', v_expense_id,
        'installer_id', p_installer_id,
        'amount', p_amount,
        'new_balance', v_new_balance,
        'already_existed', false
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.installer_record_payment(UUID, UUID, NUMERIC, TEXT, DATE, DATE, TEXT, TEXT) TO authenticated;

-- 3. installer_cancel_payment — ters kayit (reverse entry), HARD DELETE YOK ---

CREATE OR REPLACE FUNCTION public.installer_cancel_payment(
    p_company_id UUID,
    p_transaction_id UUID,
    p_note TEXT DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_original installer_transactions%ROWTYPE;
    v_already_cancelled installer_transactions%ROWTYPE;
    v_existing_replay installer_transactions%ROWTYPE;
    v_reversal_expense_id UUID;
    v_cancel_id UUID;
    v_earned NUMERIC;
    v_paid NUMERIC;
    v_new_balance NUMERIC;
    v_automatic_earned NUMERIC;
    v_manual_earned NUMERIC;
BEGIN
    IF NOT (p_company_id IN (SELECT public.my_company_ids()) OR public.is_super_admin()) THEN
        RAISE EXCEPTION 'unauthorized: bu firmaya erisim yok';
    END IF;

    -- SECURITY DEFINER fonksiyonlar RLS'i bypass eder, dolayisiyla expenses
    -- uzerindeki "Block all if trial expired" politikasi burada devreye
    -- girmez — bu yuzden ayni kontrol acikca burada tekrarlanir.
    IF NOT public.check_subscription_active(p_company_id) THEN
        RAISE EXCEPTION 'unauthorized: firma lisansi/deneme suresi aktif degil';
    END IF;

    IF p_transaction_id IS NULL THEN
        RAISE EXCEPTION 'invalid_reference: transaction_id gerekli';
    END IF;

    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existing_replay
        FROM installer_transactions
        WHERE company_id = p_company_id AND idempotency_key = p_idempotency_key
              AND transaction_type = 'cancel'
        LIMIT 1;

        IF FOUND THEN
            -- Automatic earned (from completed jobs)
            SELECT COALESCE(SUM(ij.installer_fee), 0)
            INTO v_automatic_earned
            FROM installation_jobs ij
            WHERE ij.assigned_staff_id = v_existing_replay.installer_id AND ij.status = 'completed';

            -- Manual earned (from manual earnings entries)
            SELECT COALESCE(SUM(ie.total_earning), 0)
            INTO v_manual_earned
            FROM installer_earnings ie
            WHERE ie.installer_id = v_existing_replay.installer_id
              AND ie.company_id = p_company_id
              AND ie.earning_type = 'manual'
              AND ie.installation_job_id IS NULL;

            -- Paid (exclude 'earning' type transactions)
            SELECT COALESCE(SUM(CASE WHEN it.transaction_type = 'payment' THEN it.amount WHEN it.transaction_type = 'cancel' THEN -it.amount ELSE 0 END), 0)
            INTO v_paid
            FROM installer_transactions it
            WHERE it.installer_id = v_existing_replay.installer_id
              AND it.company_id = p_company_id
              AND it.transaction_type NOT IN ('earning');

            v_earned := v_automatic_earned + v_manual_earned;
            v_new_balance := GREATEST(v_earned - v_paid, 0);

            RETURN jsonb_build_object(
                'transaction_id', v_existing_replay.id,
                'reversed_transaction_id', v_existing_replay.reverses_transaction_id,
                'expense_id', v_existing_replay.expense_id,
                'installer_id', v_existing_replay.installer_id,
                'amount', v_existing_replay.amount,
                'new_balance', v_new_balance,
                'already_existed', true
            );
        END IF;
    END IF;

    SELECT * INTO v_original
    FROM installer_transactions
    WHERE id = p_transaction_id AND company_id = p_company_id AND transaction_type = 'payment';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found: iptal edilecek odeme bulunamadi';
    END IF;

    SELECT * INTO v_already_cancelled
    FROM installer_transactions
    WHERE reverses_transaction_id = p_transaction_id;

    IF FOUND THEN
        RAISE EXCEPTION 'invalid_reference: bu odeme zaten iptal edilmis';
    END IF;

    -- 1) Ters gider kaydi — orijinal expenses satiri SILINMEZ; -tutarli yeni
    --    bir satir eklenir (reversal_of_expense_id ile orijinale baglanir).
    IF v_original.expense_id IS NOT NULL THEN
        INSERT INTO expenses (company_id, amount, expense_date, category, status, note, reversal_of_expense_id)
        VALUES (
            p_company_id, -v_original.amount, now(), 'Montajci Odemesi Iptali', 'paid',
            COALESCE(p_note, 'Iptal: ' || COALESCE(v_original.description, 'odeme')),
            v_original.expense_id
        )
        RETURNING id INTO v_reversal_expense_id;
    END IF;

    -- 2) Ters cari hareket — 'cancel' turunde yeni satir (hard delete YOK,
    --    eski cari ekstre gecmisi gibi append-only kalir).
    INSERT INTO installer_transactions (
        company_id, installer_id, transaction_date, transaction_type,
        amount, description, expense_id, reverses_transaction_id, idempotency_key
    )
    VALUES (
        p_company_id, v_original.installer_id, now(), 'cancel',
        v_original.amount,
        COALESCE(p_note, 'Iptal: ' || COALESCE(v_original.description, 'odeme')),
        v_reversal_expense_id, p_transaction_id, p_idempotency_key
    )
    RETURNING id INTO v_cancel_id;

    -- 3) Bakiye SADECE yukaridaki insert'ler basariyla tamamlandiktan sonra
    --    hesaplanir.
    --
    --    Balance formula (same as installer_record_payment):
    --    Balance = automatic_earned + manual_earned - paid
    --    Where:
    --    - automatic_earned = SUM(installation_jobs.installer_fee) WHERE status='completed'
    --    - manual_earned = SUM(installer_earnings.total_earning) WHERE earning_type='manual' AND installation_job_id IS NULL
    --    - paid = SUM(payment - cancel) excludes 'earning' type transactions

    -- Automatic earned (from completed jobs)
    SELECT COALESCE(SUM(ij.installer_fee), 0)
    INTO v_automatic_earned
    FROM installation_jobs ij
    WHERE ij.assigned_staff_id = v_original.installer_id
      AND ij.status = 'completed'
      AND ij.company_id = p_company_id;

    -- Manual earned (from manual earnings entries)
    SELECT COALESCE(SUM(ie.total_earning), 0)
    INTO v_manual_earned
    FROM installer_earnings ie
    WHERE ie.installer_id = v_original.installer_id
      AND ie.company_id = p_company_id
      AND ie.earning_type = 'manual'
      AND ie.installation_job_id IS NULL;

    -- Paid (exact formula: exclude 'earning' type transactions)
    SELECT COALESCE(SUM(
        CASE
            WHEN it.transaction_type = 'payment' THEN it.amount
            WHEN it.transaction_type = 'cancel' THEN -it.amount
            ELSE 0
        END
    ), 0)
    INTO v_paid
    FROM installer_transactions it
    WHERE it.installer_id = v_original.installer_id
      AND it.company_id = p_company_id
      AND it.transaction_type NOT IN ('earning');

    -- Balance = automatic + manual - paid
    v_earned := v_automatic_earned + v_manual_earned;
    v_new_balance := GREATEST(v_earned - v_paid, 0);

    RETURN jsonb_build_object(
        'transaction_id', v_cancel_id,
        'reversed_transaction_id', p_transaction_id,
        'expense_id', v_reversal_expense_id,
        'installer_id', v_original.installer_id,
        'amount', v_original.amount,
        'new_balance', v_new_balance,
        'already_existed', false
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.installer_cancel_payment(UUID, UUID, TEXT, TEXT) TO authenticated;

-- 4. Schema cache
NOTIFY pgrst, 'reload schema';

-- SONUC
SELECT 'SONUC: installer_record_payment/installer_cancel_payment hazir' AS check_name,
       to_regprocedure('public.installer_record_payment(uuid, uuid, numeric, text, date, date, text, text)') IS NOT NULL
       AND to_regprocedure('public.installer_cancel_payment(uuid, uuid, text, text)') IS NOT NULL AS ok;
