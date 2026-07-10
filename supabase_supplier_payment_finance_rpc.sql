-- ============================================================
-- PERDEPRO - Tedarikci Odemesi Finans Servis Katmani (FAZ 3)
-- SupplierPaymentService icin atomik RPC fonksiyonlari.
--
-- Kapsam: yalnizca supplier_record_payment / supplier_cancel_payment
-- RPC'leri + bunlarin ihtiyac duydugu ek (additive) kolonlar/constraint.
-- Hicbir mevcut kolon/tablo/politika/trigger degistirilmez veya silinmez.
-- Hicbir ekran bu RPC'leri henuz cagirmiyor (bkz. src/services/finance) —
-- bu dosya calistirilsa bile production davranisi degismez.
--
-- Eski src/utils/supplierCari.ts (borc olusturma, 'debt' tipi) BU DOSYADA
-- DEGISTIRILMEDI — o modul kendi basina calismaya devam ediyor. Bu dosya
-- yalnizca ODEME ve ODEME IPTALI icin yeni bir yol ekler.
--
-- transaction_type KARARI (kullanicidan onaylandi): odeme iptali icin
-- 'cancel' KULLANILMAZ, cunku mevcut sistemde 'cancel' zaten FARKLI bir
-- anlam tasiyor (siparis kalemi maliyeti dustugunde / tedarikci
-- degistiginde borc azaltma — bkz. src/pages/OrderDetail.tsx, DOKUNULMADI).
-- Bunun yerine YENI bir tip kullanilir: 'payment_reversal'.
--
-- Iptal (cancel) mantigi: TERS KAYIT (reverse entry). HARD DELETE YOK.
--   - supplier_transactions: yeni bir 'payment_reversal' satiri eklenir
--     (reverses_transaction_id ile orijinal 'payment' satirina baglanir).
--   - expenses: orijinal gider SILINMEZ; -tutarli yeni bir "iptal" gider
--     satiri eklenir (reversal_of_expense_id ile orijinale baglanir).
--
-- Idempotency: idempotency_key verilirse ayni anahtarla ikinci cagri yeni
-- kayit olusturmaz; orijinal sonucu ayni sekilde geri doner (already_existed).
-- Replay sorgulari transaction_type'a GORE FILTRELENIR (installer RPC'sinde
-- bulunan nullable-reference hatasinin tekrarlanmamasi icin, bkz.
-- supabase_installer_payment_finance_rpc.sql).
--
-- Bakiye formulu (mevcut SupplierDetail.tsx mantigiyla ayni + payment_reversal
-- eklendi): balance = debt - payment - cancel + payment_reversal.
-- NOT: bu RPC bakiyeyi 0'da KIRPMAZ (installer'daki GREATEST(...,0) aksine) —
-- tedarikci tarafinda "avans" kavrami mevcut kodda modellenmemis; negatif
-- bakiye = fazla odeme/alacak anlamina gelir ve oldugu gibi doner. Fazla
-- odeme ENGELLENMEZ de — bu politika henuz karara baglanmadi (bkz. onceki
-- mimari inceleme, "acik karar noktalari"); ekrana baglanmadan once netlesmeli.
--
-- NOT: Bu migration Supabase'e UYGULANMADI. Repo'ya sadece dosya olarak
-- eklendi; calistirilmasi ayri bir onay gerektirir.
-- ============================================================

-- 1. Ek (additive) kolonlar ve genisletilmis CHECK constraint --------------

ALTER TABLE public.supplier_transactions ADD COLUMN IF NOT EXISTS expense_id UUID REFERENCES public.expenses(id);
ALTER TABLE public.supplier_transactions ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE public.supplier_transactions ADD COLUMN IF NOT EXISTS reverses_transaction_id UUID REFERENCES public.supplier_transactions(id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_tx_company_idempotency
    ON public.supplier_transactions (company_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- Bir 'payment' satiri en fazla bir kez iptal edilebilir.
CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_tx_reverses_once
    ON public.supplier_transactions (reverses_transaction_id)
    WHERE reverses_transaction_id IS NOT NULL;

-- Mevcut CHECK constraint transaction_type'i ('debt','payment','cancel') ile
-- sinirliyor; 'payment_reversal' eklemek icin genisletilmesi gerekiyor.
-- Constraint adi dinamik olarak bulunur (elle isimlendirilmemisti, Postgres
-- varsayilan adini kullanmis olabilir) — hangi isimle olursa olsun guvenle
-- degistirilir. Mevcut satirlar etkilenmez (hepsi zaten izinli degerlerde).
DO $$
DECLARE
    v_constraint_name text;
BEGIN
    SELECT con.conname INTO v_constraint_name
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'supplier_transactions'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%transaction_type%'
    LIMIT 1;

    IF v_constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.supplier_transactions DROP CONSTRAINT %I', v_constraint_name);
    END IF;

    ALTER TABLE public.supplier_transactions
        ADD CONSTRAINT supplier_transactions_transaction_type_check
        CHECK (transaction_type IN ('debt', 'payment', 'cancel', 'payment_reversal'));
END $$;

-- expenses.reversal_of_expense_id FAZ 2'de eklenmisti; bu dosya bagimsiz
-- calistirilabilsin diye ayni ekleme burada da idempotent olarak tekrarlanir.
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS reversal_of_expense_id UUID REFERENCES public.expenses(id);

-- 2. supplier_record_payment --------------------------------------------------
--    Tek RPC cagrisi = tek DB transaction'i: expenses insert + supplier_
--    transactions insert + bakiye hesaplama, hepsi ayni fonksiyon govdesinde.
--    Herhangi bir adim basarisiz olursa TUMU geri alinir — bakiye ASLA
--    yaridan yazilmis veriyle hesaplanmaz.

-- Atomic drop + create to avoid overload ambiguity
BEGIN;

DROP FUNCTION IF EXISTS public.supplier_record_payment(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, TEXT) CASCADE;

CREATE FUNCTION public.supplier_record_payment(
    p_company_id UUID,
    p_supplier_id UUID,
    p_amount NUMERIC,
    p_payment_method TEXT DEFAULT NULL,
    p_note TEXT DEFAULT NULL,
    p_order_id UUID DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL,
    p_payment_date TIMESTAMPTZ DEFAULT NULL,
    p_update_due_date BOOLEAN DEFAULT false,
    p_new_due_date DATE DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existing supplier_transactions%ROWTYPE;
    v_expense_id UUID;
    v_transaction_id UUID;
    v_new_balance NUMERIC;
    v_payment_date TIMESTAMPTZ;
    v_debt_id UUID;
BEGIN
    IF NOT (p_company_id IN (SELECT public.my_company_ids()) OR public.is_super_admin()) THEN
        RAISE EXCEPTION 'unauthorized: bu firmaya erisim yok';
    END IF;

    -- SECURITY DEFINER fonksiyonlar RLS'i bypass eder; expenses uzerindeki
    -- "Block all if trial expired" politikasi burada devreye girmez —
    -- bu yuzden ayni kontrol acikca burada tekrarlanir.
    IF NOT public.check_subscription_active(p_company_id) THEN
        RAISE EXCEPTION 'unauthorized: firma lisansi/deneme suresi aktif degil';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'invalid_amount: tutar sifirdan buyuk olmali';
    END IF;

    IF p_supplier_id IS NULL THEN
        RAISE EXCEPTION 'invalid_reference: supplier_id gerekli';
    END IF;

    -- Payment date: use provided date or default to now
    v_payment_date := COALESCE(p_payment_date, now());

    -- Idempotency replay: ayni anahtarla ikinci cagri -> yeni kayit ACILMAZ,
    -- orijinal sonuc aynen geri donulur. transaction_type = 'payment' filtresi
    -- kasitlidir (bkz. dosya basi not — installer RPC'sindeki hatanin
    -- tekrarlanmamasi icin).
    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existing
        FROM supplier_transactions
        WHERE company_id = p_company_id AND idempotency_key = p_idempotency_key
              AND transaction_type = 'payment'
        LIMIT 1;

        IF FOUND THEN
            SELECT
                COALESCE(SUM(CASE WHEN transaction_type = 'debt' THEN amount ELSE 0 END), 0)
                - COALESCE(SUM(CASE WHEN transaction_type = 'payment' THEN amount ELSE 0 END), 0)
                - COALESCE(SUM(CASE WHEN transaction_type = 'cancel' THEN amount ELSE 0 END), 0)
                + COALESCE(SUM(CASE WHEN transaction_type = 'payment_reversal' THEN amount ELSE 0 END), 0)
            INTO v_new_balance
            FROM supplier_transactions
            WHERE supplier_id = v_existing.supplier_id AND company_id = p_company_id;

            RETURN jsonb_build_object(
                'transaction_id', v_existing.id,
                'expense_id', v_existing.expense_id,
                'supplier_id', v_existing.supplier_id,
                'amount', v_existing.amount,
                'new_balance', v_new_balance,
                'already_existed', true
            );
        END IF;
    END IF;

    -- 1) Gider kaydi (expenses) — Giderler ekraniyla senkron (eski
    --    SupplierDetail/SupplierLedger davranisiyla ayni kategori/status).
    --    expense_date now v_payment_date kullanir.
    INSERT INTO expenses (company_id, supplier_id, amount, expense_date, category, status, note)
    VALUES (p_company_id, p_supplier_id, p_amount, v_payment_date, 'Tedarik', 'paid', p_note)
    RETURNING id INTO v_expense_id;

    -- 2) Tedarikci cari hareketi (supplier_transactions).
    --    transaction_date now v_payment_date kullanir.
    INSERT INTO supplier_transactions (
        company_id, supplier_id, order_id, transaction_date, transaction_type,
        amount, description, payment_method, expense_id, idempotency_key
    )
    VALUES (
        p_company_id, p_supplier_id, p_order_id, v_payment_date, 'payment',
        p_amount, p_note, p_payment_method, v_expense_id, p_idempotency_key
    )
    RETURNING id INTO v_transaction_id;

    -- 3) Due-date guncelleme (opsiyonel).
    --    Sadece p_update_due_date = true VE p_new_due_date IS NOT NULL ise calisir.
    --    Replay'de (already_existed=true) bu blok execute edilmez.
    IF p_update_due_date AND p_new_due_date IS NOT NULL THEN
        -- Alistirma 1: p_order_id doluysa, aynı order'a bagli borcu sec.
        IF p_order_id IS NOT NULL THEN
            SELECT id INTO v_debt_id
            FROM supplier_transactions
            WHERE company_id = p_company_id
              AND supplier_id = p_supplier_id
              AND order_id = p_order_id
              AND transaction_type = 'debt'
            LIMIT 1;
        END IF;

        -- Geri plan: order_id ile eslesme yoksa (veya p_order_id NULL ise),
        -- en eski Borc satiri seç (Fifo: oldest due_date, then oldest transaction).
        IF v_debt_id IS NULL THEN
            SELECT id INTO v_debt_id
            FROM supplier_transactions
            WHERE company_id = p_company_id
              AND supplier_id = p_supplier_id
              AND transaction_type = 'debt'
            ORDER BY due_date ASC NULLS FIRST, transaction_date ASC, id ASC
            LIMIT 1;
        END IF;

        -- Seçilen debt satiri varsa, due_date'i güncelle.
        IF v_debt_id IS NOT NULL THEN
            UPDATE supplier_transactions
            SET due_date = p_new_due_date
            WHERE id = v_debt_id;
        END IF;
    END IF;

    -- 4) Bakiye SADECE yukaridaki insert/update'ler basariyla tamamlandiktan sonra
    --    hesaplanir (tedarikci bakiyesi stored bir kolon degil, her zaman
    --    ledger'dan turetilir — "guncelleme" degil "hesaplama"dir).
    SELECT
        COALESCE(SUM(CASE WHEN transaction_type = 'debt' THEN amount ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN transaction_type = 'payment' THEN amount ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN transaction_type = 'cancel' THEN amount ELSE 0 END), 0)
        + COALESCE(SUM(CASE WHEN transaction_type = 'payment_reversal' THEN amount ELSE 0 END), 0)
    INTO v_new_balance
    FROM supplier_transactions
    WHERE supplier_id = p_supplier_id AND company_id = p_company_id;

    RETURN jsonb_build_object(
        'transaction_id', v_transaction_id,
        'expense_id', v_expense_id,
        'supplier_id', p_supplier_id,
        'amount', p_amount,
        'new_balance', v_new_balance,
        'already_existed', false
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.supplier_record_payment(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, TEXT, TIMESTAMPTZ, BOOLEAN, DATE) TO authenticated;

COMMIT;

-- 3. supplier_cancel_payment — ters kayit (reverse entry), HARD DELETE YOK ---
--    transaction_type = 'payment_reversal' (KESINLIKLE 'cancel' DEGIL —
--    bkz. dosya basi karar notu).

CREATE OR REPLACE FUNCTION public.supplier_cancel_payment(
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
    v_original supplier_transactions%ROWTYPE;
    v_already_reversed supplier_transactions%ROWTYPE;
    v_existing_replay supplier_transactions%ROWTYPE;
    v_reversal_expense_id UUID;
    v_reversal_id UUID;
    v_new_balance NUMERIC;
BEGIN
    IF NOT (p_company_id IN (SELECT public.my_company_ids()) OR public.is_super_admin()) THEN
        RAISE EXCEPTION 'unauthorized: bu firmaya erisim yok';
    END IF;

    IF NOT public.check_subscription_active(p_company_id) THEN
        RAISE EXCEPTION 'unauthorized: firma lisansi/deneme suresi aktif degil';
    END IF;

    IF p_transaction_id IS NULL THEN
        RAISE EXCEPTION 'invalid_reference: transaction_id gerekli';
    END IF;

    -- Replay sorgusu transaction_type = 'payment_reversal' ile filtrelenir —
    -- ayni idempotency_key yanlislikla hem odeme hem iptal icin kullanilsa
    -- bile bu sorgu asla bir 'payment' satirini bulamaz.
    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existing_replay
        FROM supplier_transactions
        WHERE company_id = p_company_id AND idempotency_key = p_idempotency_key
              AND transaction_type = 'payment_reversal'
        LIMIT 1;

        IF FOUND THEN
            SELECT
                COALESCE(SUM(CASE WHEN transaction_type = 'debt' THEN amount ELSE 0 END), 0)
                - COALESCE(SUM(CASE WHEN transaction_type = 'payment' THEN amount ELSE 0 END), 0)
                - COALESCE(SUM(CASE WHEN transaction_type = 'cancel' THEN amount ELSE 0 END), 0)
                + COALESCE(SUM(CASE WHEN transaction_type = 'payment_reversal' THEN amount ELSE 0 END), 0)
            INTO v_new_balance
            FROM supplier_transactions
            WHERE supplier_id = v_existing_replay.supplier_id AND company_id = p_company_id;

            RETURN jsonb_build_object(
                'transaction_id', v_existing_replay.id,
                'reversed_transaction_id', v_existing_replay.reverses_transaction_id,
                'expense_id', v_existing_replay.expense_id,
                'supplier_id', v_existing_replay.supplier_id,
                'amount', v_existing_replay.amount,
                'new_balance', v_new_balance,
                'already_existed', true
            );
        END IF;
    END IF;

    SELECT * INTO v_original
    FROM supplier_transactions
    WHERE id = p_transaction_id AND company_id = p_company_id AND transaction_type = 'payment';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'not_found: iptal edilecek odeme bulunamadi';
    END IF;

    SELECT * INTO v_already_reversed
    FROM supplier_transactions
    WHERE reverses_transaction_id = p_transaction_id;

    IF FOUND THEN
        RAISE EXCEPTION 'invalid_reference: bu odeme zaten iptal edilmis';
    END IF;

    -- 1) Ters gider kaydi — orijinal expenses satiri SILINMEZ; -tutarli yeni
    --    bir satir eklenir (reversal_of_expense_id ile orijinale baglanir).
    IF v_original.expense_id IS NOT NULL THEN
        INSERT INTO expenses (company_id, supplier_id, amount, expense_date, category, status, note, reversal_of_expense_id)
        VALUES (
            p_company_id, v_original.supplier_id, -v_original.amount, now(), 'Tedarik Odemesi Iptali', 'paid',
            COALESCE(p_note, 'Iptal: ' || COALESCE(v_original.description, 'odeme')),
            v_original.expense_id
        )
        RETURNING id INTO v_reversal_expense_id;
    END IF;

    -- 2) Ters cari hareket — 'payment_reversal' turunde yeni satir (hard
    --    delete YOK, append-only kalir; 'cancel' ile KARISTIRILMAZ).
    INSERT INTO supplier_transactions (
        company_id, supplier_id, order_id, transaction_date, transaction_type,
        amount, description, expense_id, reverses_transaction_id, idempotency_key
    )
    VALUES (
        p_company_id, v_original.supplier_id, v_original.order_id, now(), 'payment_reversal',
        v_original.amount,
        COALESCE(p_note, 'Iptal: ' || COALESCE(v_original.description, 'odeme')),
        v_reversal_expense_id, p_transaction_id, p_idempotency_key
    )
    RETURNING id INTO v_reversal_id;

    -- 3) Bakiye SADECE yukaridaki insert'ler basariyla tamamlandiktan sonra
    --    hesaplanir.
    SELECT
        COALESCE(SUM(CASE WHEN transaction_type = 'debt' THEN amount ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN transaction_type = 'payment' THEN amount ELSE 0 END), 0)
        - COALESCE(SUM(CASE WHEN transaction_type = 'cancel' THEN amount ELSE 0 END), 0)
        + COALESCE(SUM(CASE WHEN transaction_type = 'payment_reversal' THEN amount ELSE 0 END), 0)
    INTO v_new_balance
    FROM supplier_transactions
    WHERE supplier_id = v_original.supplier_id AND company_id = p_company_id;

    RETURN jsonb_build_object(
        'transaction_id', v_reversal_id,
        'reversed_transaction_id', p_transaction_id,
        'expense_id', v_reversal_expense_id,
        'supplier_id', v_original.supplier_id,
        'amount', v_original.amount,
        'new_balance', v_new_balance,
        'already_existed', false
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.supplier_cancel_payment(UUID, UUID, TEXT, TEXT) TO authenticated;

-- 4. Schema cache
NOTIFY pgrst, 'reload schema';

-- SONUC
SELECT 'SONUC: supplier_record_payment/supplier_cancel_payment hazir' AS check_name,
       to_regprocedure('public.supplier_record_payment(uuid, uuid, numeric, text, text, uuid, text, timestamptz, boolean, date)') IS NOT NULL
       AND to_regprocedure('public.supplier_cancel_payment(uuid, uuid, text, text)') IS NOT NULL AS ok;
