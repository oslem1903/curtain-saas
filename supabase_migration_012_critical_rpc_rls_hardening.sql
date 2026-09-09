-- ============================================================================
-- MIGRATION 012: KRİTİK — finansal RPC'lere firma-yetki kontrolü ekleme,
-- supplier_transactions/installer_transactions RLS'ini kapatma, temel yetki
-- fonksiyonlarına search_path pinleme.
--
-- HENÜZ PRODUCTION'DA ÇALIŞTIRILMADI. Önce incelenip onaylanacak, sonra
-- Supabase SQL Editor'da elle çalıştırılacak.
--
-- BULGU (2026-09-09 denetimi — kod üzerinden doğrulandı, canlı DB'de ayrıca
-- teyit edilmeli):
--
-- 1) supabase_payment_transaction_safety.sql içindeki 7 fonksiyon
--    (record_order_payment, record_invoice_save, record_income_entry,
--    record_expense_entry, record_installer_payment, cancel_installer_payment,
--    record_supplier_payment) SECURITY DEFINER'dır, `authenticated`'a
--    GRANT EXECUTE edilmiştir, ve gövdelerinde p_company_id'nin ÇAĞIRANIN
--    GERÇEKTEN ÜYESİ OLDUĞU bir firma olup olmadığını kontrol eden HİÇBİR
--    satır yoktur. Giriş yapmış herhangi bir kullanıcı, başka bir firmanın
--    company_id'sini vererek o firmanın gelir/gider/tahsilat/tedarikçi/
--    montajcı defterine sahte kayıt ekleyebilir/silebilir.
--
--    Bu migration, DAHA YENİ ve DOĞRU yazılmış kardeş RPC'lerde (örn.
--    supabase_customer_collection_finance_rpc.sql'deki
--    customer_record_collection) ZATEN kullanılan AYNI deseni uygular:
--        IF NOT (p_company_id IN (SELECT public.my_company_ids()) OR public.is_super_admin()) THEN
--            RAISE EXCEPTION 'unauthorized: bu firmaya erisim yok';
--        END IF;
--        IF NOT public.is_company_accounting(p_company_id) THEN
--            RAISE EXCEPTION 'unauthorized: bu islem icin muhasebe yetkisi gerekli';
--        END IF;
--    Fonksiyonların GERİ KALANI (parametreler, dönüş tipi, iş mantığı,
--    RETURN/EXCEPTION yapısı) BİREBİR AYNI kalır — yalnızca en başa bu 2
--    kontrol ve `SET search_path = public` eklenir.
--
-- 2) supabase_rls_hardening_critical.sql'deki installer_transactions_insert
--    (WITH CHECK (TRUE)) ve supplier_transactions_insert/update
--    (WITH CHECK/USING (TRUE)) politikaları, herhangi bir authenticated
--    kullanıcının PostgREST üzerinden DOĞRUDAN (RPC'ye bile gerek olmadan)
--    başka bir firmanın tedarikçi/montajcı cari hareketini eklemesine/
--    değiştirmesine izin veriyor. Bu migration, AYNI dosyadaki `income`
--    tablosu için ZATEN kullanılan doğru deseni uygular:
--        FOR INSERT WITH CHECK (is_company_accounting(company_id))
--    installer_transactions_insert'in "Triggered by system, not user" yorumu
--    yanıltıcıdır — src/pages/NewOrder.tsx, OrderDetail.tsx, SupplierLedger.tsx,
--    utils/supplierCari.ts DOĞRUDAN supplier_transactions'a insert/update
--    yapıyor (installer_transactions'a doğrudan frontend insert'i YOK, ama
--    aynı sıkılaştırma zarar vermez — hiçbir canlı akış TRUE'ya bağımlı değil).
--
-- 3) is_super_admin(), is_company_member(uuid), is_company_accounting(uuid) —
--    SECURITY DEFINER ama search_path PINLENMEMİŞ (supabase_rls_hardening_
--    critical.sql:30-76). Bu 3 fonksiyon onlarca RLS politikası ve başka
--    fonksiyon tarafından unqualified çağrılıyor — search_path hijack riski.
--    Mantıkları BİREBİR AYNI kalır, yalnızca `SET search_path = public` eklenir.
--
-- BU MIGRATION'DA YAPILMAYANLAR (bilinçli, ayrı onay gerektirir):
--   - check_subscription_active(uuid)'nin trial_ends_at NULL durumunda
--     fail-OPEN davranışı (ayrı bir bulgu olarak raporlandı, bu migration'a
--     DAHİL EDİLMEDİ — kullanıcı ayrıca karar verecek).
--   - "Sertleştirilmiş" yeni RPC ailesinin (customer_record_collection vb.)
--     production'a deploy edilip edilmediği/frontend'e bağlanıp bağlanmadığı
--     bu migration'ın kapsamı DIŞINDA.
--   - update_installation_completion'a DOKUNULMADI (migration 008'deki güncel
--     hali zaten doğru — bu dosyanın İÇİNDE eski bir kopyası var ama bu
--     migration onu YENİDEN OLUŞTURMUYOR, CREATE OR REPLACE ETMİYOR).
--
-- ROLLBACK: Fonksiyonlar için, bu migration öncesi gövdeyi (supabase_payment_
-- transaction_safety.sql'deki orijinal hali) yeniden CREATE OR REPLACE ile
-- çalıştırın (ama bu güvenlik açığını geri getirir). Politikalar için:
--   DROP POLICY installer_transactions_insert ON public.installer_transactions;
--   CREATE POLICY installer_transactions_insert ON public.installer_transactions FOR INSERT WITH CHECK (TRUE);
--   (supplier_transactions için benzer şekilde — önerilmez.)
-- ============================================================================

BEGIN;

-- ============================================================================
-- PREFLIGHT — 7 fonksiyonun ve 2 tablonun production'da gerçekten beklenen
-- şekilde bulunduğunu doğrular. Sapma varsa hiçbir şey uygulanmaz.
-- ============================================================================

DO $preflight$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'my_company_ids') THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: public.my_company_ids() bulunamadi — migration DURDURULDU.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'is_company_accounting') THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: public.is_company_accounting(uuid) bulunamadi — migration DURDURULDU.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = 'is_super_admin') THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: public.is_super_admin() bulunamadi — migration DURDURULDU.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='installer_transactions' AND policyname='installer_transactions_insert') THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: installer_transactions_insert politikasi bulunamadi — migration DURDURULDU.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='supplier_transactions' AND policyname='supplier_transactions_insert') THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: supplier_transactions_insert politikasi bulunamadi — migration DURDURULDU.';
  END IF;
  RAISE NOTICE 'PREFLIGHT PASS.';
END;
$preflight$;

-- ============================================================================
-- 1) search_path PINLEME — is_super_admin/is_company_member/is_company_accounting.
--    Mantik BIREBIR AYNI (supabase_rls_hardening_critical.sql ile), yalnizca
--    SET search_path = public eklendi.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN (SELECT role = 'super_admin' FROM public.profiles WHERE user_id = auth.uid() LIMIT 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.is_company_member(p_company_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.company_members
    WHERE user_id = auth.uid()
    AND company_id = p_company_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.is_company_accounting(p_company_id uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  RETURN (
    is_super_admin()
    OR EXISTS (
      SELECT 1 FROM public.company_members
      WHERE user_id = auth.uid()
      AND company_id = p_company_id
      AND role IN ('admin', 'owner', 'accountant')
    )
  );
END;
$$;

-- ============================================================================
-- 2) FİNANSAL RPC'LERE FİRMA-YETKİ KONTROLÜ — 7 fonksiyon. Gövdelerin geri
--    kalanı (is mantigi, RETURN/EXCEPTION yapisi) supabase_payment_
--    transaction_safety.sql'deki orijinaliyle BIREBIR AYNI.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.record_order_payment(
    p_company_id uuid,
    p_order_id uuid,
    p_amount numeric,
    p_payment_method text DEFAULT NULL,
    p_note text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_current_paid numeric;
    v_order_total numeric;
    v_next_paid numeric;
    v_next_remaining numeric;
    v_overpayment numeric;
    v_now timestamptz;
    v_payment_id uuid;
    v_income_id uuid;
    v_customer_name text;
    v_order_note text;
    v_result json;
BEGIN
    IF NOT (p_company_id IN (SELECT public.my_company_ids()) OR public.is_super_admin()) THEN
        RAISE EXCEPTION 'unauthorized: bu firmaya erisim yok';
    END IF;
    IF NOT public.is_company_accounting(p_company_id) THEN
        RAISE EXCEPTION 'unauthorized: bu islem icin muhasebe yetkisi gerekli';
    END IF;

    v_now := now();

    IF NOT public.check_rate_limit('record_order_payment', 1, 5) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Rate limit exceeded. Please wait 5 seconds before the next payment.',
            'payment_id', NULL
        );
    END IF;

    SELECT
        total_amount,
        paid_amount,
        note,
        customers->>'name'
    INTO v_order_total, v_current_paid, v_order_note, v_customer_name
    FROM public.orders
    WHERE id = p_order_id AND company_id = p_company_id
    FOR UPDATE;

    IF v_order_total IS NULL THEN
        RAISE EXCEPTION 'Order not found: %', p_order_id;
    END IF;

    v_current_paid := COALESCE(v_current_paid, 0);
    v_next_paid := v_current_paid + p_amount;
    v_next_remaining := GREATEST(v_order_total - v_next_paid, 0);
    v_overpayment := GREATEST(v_next_paid - v_order_total, 0);

    INSERT INTO public.payments (
        company_id, order_id, payment_date, amount, method, note
    ) VALUES (
        p_company_id, p_order_id, v_now, p_amount, p_payment_method,
        CONCAT(
            COALESCE(p_note, 'Sipariş tahsilatı'),
            CASE WHEN v_overpayment > 0 THEN ' Fazla tahsilat / müşteri alacağı: ' || v_overpayment::text ELSE '' END
        )
    ) RETURNING id INTO v_payment_id;

    INSERT INTO public.income (
        company_id, income_date, amount, payment_method, description, note, source, order_id
    ) VALUES (
        p_company_id, v_now, p_amount, p_payment_method,
        'Sipariş tahsilatı - ' || COALESCE(v_customer_name, 'Müşteri'),
        CASE WHEN v_overpayment > 0 THEN 'Fazla tahsilat: ' || v_overpayment::text ELSE NULL END,
        'order_payment', p_order_id
    ) RETURNING id INTO v_income_id;

    UPDATE public.orders
    SET
        paid_amount = v_next_paid,
        remaining_amount = v_next_remaining,
        note = CASE
            WHEN v_overpayment > 0 THEN
                CONCAT(v_order_note, E'\n', 'Fazla tahsilat / müşteri alacağı: ' || v_overpayment::text)
            ELSE v_order_note
        END,
        updated_at = v_now
    WHERE id = p_order_id AND company_id = p_company_id;

    v_result := json_build_object(
        'success', true, 'payment_id', v_payment_id, 'income_id', v_income_id,
        'paid_amount', v_next_paid, 'remaining_amount', v_next_remaining, 'overpayment', v_overpayment
    );
    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    v_result := json_build_object('success', false, 'error', SQLERRM, 'error_code', SQLSTATE);
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_invoice_save(
    p_company_id uuid,
    p_invoice_id uuid,
    p_invoice_data jsonb,
    p_items_data jsonb[]
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_result json;
    v_item jsonb;
    v_count integer;
BEGIN
    IF NOT (p_company_id IN (SELECT public.my_company_ids()) OR public.is_super_admin()) THEN
        RAISE EXCEPTION 'unauthorized: bu firmaya erisim yok';
    END IF;
    IF NOT public.is_company_accounting(p_company_id) THEN
        RAISE EXCEPTION 'unauthorized: bu islem icin muhasebe yetkisi gerekli';
    END IF;

    IF NOT public.check_rate_limit('record_invoice_save', 1, 3) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Rate limit exceeded. Please wait 3 seconds before creating another invoice.',
            'invoice_id', NULL
        );
    END IF;

    INSERT INTO public.invoices (
        id, company_id, invoice_no, invoice_type, date, total_tax_exclusive, total_tax_amount,
        total_tax_inclusive, paid_amount, payment_method, due_date, status, order_id, customer_id,
        supplier_id, created_at, updated_at
    ) VALUES (
        COALESCE(p_invoice_id, gen_random_uuid()), p_company_id,
        p_invoice_data->>'invoice_no', p_invoice_data->>'invoice_type',
        (p_invoice_data->>'date')::timestamptz, (p_invoice_data->>'total_tax_exclusive')::numeric,
        (p_invoice_data->>'total_tax_amount')::numeric, (p_invoice_data->>'total_tax_inclusive')::numeric,
        (p_invoice_data->>'paid_amount')::numeric, p_invoice_data->>'payment_method',
        (p_invoice_data->>'due_date')::timestamptz, p_invoice_data->>'status',
        (p_invoice_data->>'order_id')::uuid, (p_invoice_data->>'customer_id')::uuid,
        (p_invoice_data->>'supplier_id')::uuid, now(), now()
    )
    ON CONFLICT (id) DO UPDATE SET
        invoice_no = EXCLUDED.invoice_no, total_tax_exclusive = EXCLUDED.total_tax_exclusive,
        total_tax_amount = EXCLUDED.total_tax_amount, total_tax_inclusive = EXCLUDED.total_tax_inclusive,
        paid_amount = EXCLUDED.paid_amount, payment_method = EXCLUDED.payment_method,
        due_date = EXCLUDED.due_date, status = EXCLUDED.status, updated_at = now()
    RETURNING id INTO p_invoice_id;

    DELETE FROM public.invoice_items WHERE invoice_id = p_invoice_id;

    v_count := 0;
    FOREACH v_item IN ARRAY p_items_data LOOP
        INSERT INTO public.invoice_items (
            invoice_id, description, quantity, unit_price, tax_rate, line_total
        ) VALUES (
            p_invoice_id, v_item->>'description', (v_item->>'quantity')::numeric,
            (v_item->>'unit_price')::numeric, (v_item->>'tax_rate')::numeric, (v_item->>'line_total')::numeric
        );
        v_count := v_count + 1;
    END LOOP;

    v_result := json_build_object('success', true, 'invoice_id', p_invoice_id, 'items_saved', v_count);
    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    v_result := json_build_object('success', false, 'error', SQLERRM, 'error_code', SQLSTATE);
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_income_entry(
    p_company_id uuid,
    p_income_date timestamptz,
    p_amount numeric,
    p_payment_method text DEFAULT NULL,
    p_description text DEFAULT NULL,
    p_note text DEFAULT NULL,
    p_source text DEFAULT 'manual',
    p_order_id uuid DEFAULT NULL,
    p_create_transaction bool DEFAULT false
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_income_id uuid;
    v_transaction_id uuid;
    v_result json;
BEGIN
    IF NOT (p_company_id IN (SELECT public.my_company_ids()) OR public.is_super_admin()) THEN
        RAISE EXCEPTION 'unauthorized: bu firmaya erisim yok';
    END IF;
    IF NOT public.is_company_accounting(p_company_id) THEN
        RAISE EXCEPTION 'unauthorized: bu islem icin muhasebe yetkisi gerekli';
    END IF;

    IF NOT public.check_rate_limit('record_income_entry', 3, 5) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Rate limit exceeded. Please wait before creating more income entries.',
            'income_id', NULL
        );
    END IF;

    INSERT INTO public.income (
        company_id, income_date, amount, payment_method, description, note, source, order_id, created_at
    ) VALUES (
        p_company_id, p_income_date, p_amount, p_payment_method, p_description, p_note, p_source, p_order_id, now()
    ) RETURNING id INTO v_income_id;

    IF p_create_transaction THEN
        INSERT INTO public.transactions (
            company_id, transaction_type, amount, description, reference_table, reference_id, transaction_date, created_at
        ) VALUES (
            p_company_id, 'income', p_amount, p_description, 'income', v_income_id, p_income_date, now()
        ) RETURNING id INTO v_transaction_id;
    END IF;

    v_result := json_build_object('success', true, 'income_id', v_income_id, 'transaction_id', v_transaction_id);
    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    v_result := json_build_object('success', false, 'error', SQLERRM, 'error_code', SQLSTATE);
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_expense_entry(
    p_company_id uuid,
    p_expense_date timestamptz,
    p_amount numeric,
    p_category text DEFAULT NULL,
    p_description text DEFAULT NULL,
    p_note text DEFAULT NULL,
    p_payment_method text DEFAULT NULL,
    p_status text DEFAULT 'pending',
    p_supplier_id uuid DEFAULT NULL,
    p_create_transaction bool DEFAULT false
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_expense_id uuid;
    v_transaction_id uuid;
    v_result json;
BEGIN
    IF NOT (p_company_id IN (SELECT public.my_company_ids()) OR public.is_super_admin()) THEN
        RAISE EXCEPTION 'unauthorized: bu firmaya erisim yok';
    END IF;
    IF NOT public.is_company_accounting(p_company_id) THEN
        RAISE EXCEPTION 'unauthorized: bu islem icin muhasebe yetkisi gerekli';
    END IF;

    IF NOT public.check_rate_limit('record_expense_entry', 3, 5) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Rate limit exceeded. Please wait before creating more expense entries.',
            'expense_id', NULL
        );
    END IF;

    INSERT INTO public.expenses (
        company_id, expense_date, amount, category, description, note, payment_method, status, supplier_id, created_at
    ) VALUES (
        p_company_id, p_expense_date, p_amount, p_category, p_description, p_note, p_payment_method, p_status, p_supplier_id, now()
    ) RETURNING id INTO v_expense_id;

    IF p_create_transaction THEN
        INSERT INTO public.transactions (
            company_id, transaction_type, amount, description, reference_table, reference_id, transaction_date, created_at
        ) VALUES (
            p_company_id, 'expense', p_amount, p_description, 'expenses', v_expense_id, p_expense_date, now()
        ) RETURNING id INTO v_transaction_id;
    END IF;

    v_result := json_build_object('success', true, 'expense_id', v_expense_id, 'transaction_id', v_transaction_id);
    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    v_result := json_build_object('success', false, 'error', SQLERRM, 'error_code', SQLSTATE);
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_installer_payment(
    p_company_id uuid,
    p_installer_id uuid,
    p_amount numeric,
    p_payment_date timestamptz DEFAULT NULL,
    p_description text DEFAULT NULL,
    p_note text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_expense_id uuid;
    v_transaction_id uuid;
    v_payment_date timestamptz;
    v_result json;
BEGIN
    IF NOT (p_company_id IN (SELECT public.my_company_ids()) OR public.is_super_admin()) THEN
        RAISE EXCEPTION 'unauthorized: bu firmaya erisim yok';
    END IF;
    IF NOT public.is_company_accounting(p_company_id) THEN
        RAISE EXCEPTION 'unauthorized: bu islem icin muhasebe yetkisi gerekli';
    END IF;

    v_payment_date := COALESCE(p_payment_date, now());

    IF NOT public.check_rate_limit('record_installer_payment', 1, 5) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Rate limit exceeded. Please wait 5 seconds before the next installer payment.',
            'payment_id', NULL
        );
    END IF;

    INSERT INTO public.expenses (
        company_id, expense_date, amount, category, description, note, status, created_at
    ) VALUES (
        p_company_id, v_payment_date, p_amount, 'installer_payment', COALESCE(p_description, 'Montajcı Ödemesi'), p_note, 'paid', now()
    ) RETURNING id INTO v_expense_id;

    INSERT INTO public.installer_transactions (
        company_id, installer_id, transaction_type, amount, description, transaction_date, expense_id, created_at
    ) VALUES (
        p_company_id, p_installer_id, 'payment', p_amount, COALESCE(p_description, 'Montajcı Ödemesi'), v_payment_date, v_expense_id, now()
    ) RETURNING id INTO v_transaction_id;

    v_result := json_build_object('success', true, 'expense_id', v_expense_id, 'transaction_id', v_transaction_id);
    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    v_result := json_build_object('success', false, 'error', SQLERRM, 'error_code', SQLSTATE);
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_installer_payment(
    p_company_id uuid,
    p_transaction_id uuid,
    p_reason text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_expense_id uuid;
    v_installer_id uuid;
    v_amount numeric;
    v_cancel_transaction_id uuid;
    v_result json;
BEGIN
    IF NOT (p_company_id IN (SELECT public.my_company_ids()) OR public.is_super_admin()) THEN
        RAISE EXCEPTION 'unauthorized: bu firmaya erisim yok';
    END IF;
    IF NOT public.is_company_accounting(p_company_id) THEN
        RAISE EXCEPTION 'unauthorized: bu islem icin muhasebe yetkisi gerekli';
    END IF;

    IF NOT public.check_rate_limit('cancel_installer_payment', 1, 5) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Rate limit exceeded. Please wait 5 seconds before cancelling another payment.',
            'transaction_id', NULL
        );
    END IF;

    SELECT installer_id, amount, expense_id
    INTO v_installer_id, v_amount, v_expense_id
    FROM public.installer_transactions
    WHERE id = p_transaction_id AND company_id = p_company_id AND transaction_type = 'payment'
    FOR UPDATE;

    IF v_installer_id IS NULL THEN
        RAISE EXCEPTION 'Payment transaction not found: %', p_transaction_id;
    END IF;

    INSERT INTO public.installer_transactions (
        company_id, installer_id, transaction_type, amount, description, transaction_date, parent_transaction_id, created_at
    ) VALUES (
        p_company_id, v_installer_id, 'payment_cancel', v_amount, COALESCE(p_reason, 'Ödeme iptal edildi'), now(), p_transaction_id, now()
    ) RETURNING id INTO v_cancel_transaction_id;

    DELETE FROM public.expenses WHERE id = v_expense_id AND company_id = p_company_id;

    v_result := json_build_object('success', true, 'cancel_transaction_id', v_cancel_transaction_id, 'expense_id', v_expense_id);
    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    v_result := json_build_object('success', false, 'error', SQLERRM, 'error_code', SQLSTATE);
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_supplier_payment(
    p_company_id uuid,
    p_supplier_id uuid,
    p_amount numeric,
    p_payment_method text DEFAULT NULL,
    p_description text DEFAULT NULL,
    p_payment_date timestamptz DEFAULT NULL,
    p_update_due_date bool DEFAULT false,
    p_new_due_date timestamptz DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_payment_date timestamptz;
    v_supplier_transaction_id uuid;
    v_payment_id uuid;
    v_expense_id uuid;
    v_transaction_id uuid;
    v_result json;
BEGIN
    IF NOT (p_company_id IN (SELECT public.my_company_ids()) OR public.is_super_admin()) THEN
        RAISE EXCEPTION 'unauthorized: bu firmaya erisim yok';
    END IF;
    IF NOT public.is_company_accounting(p_company_id) THEN
        RAISE EXCEPTION 'unauthorized: bu islem icin muhasebe yetkisi gerekli';
    END IF;

    v_payment_date := COALESCE(p_payment_date, now());

    IF NOT public.check_rate_limit('record_supplier_payment', 1, 5) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Rate limit exceeded. Please wait 5 seconds before the next supplier payment.',
            'payment_id', NULL
        );
    END IF;

    INSERT INTO public.supplier_transactions (
        company_id, supplier_id, transaction_type, amount, description, transaction_date, created_at
    ) VALUES (
        p_company_id, p_supplier_id, 'payment', p_amount, COALESCE(p_description, 'Tedarikçi Ödemesi'), v_payment_date, now()
    ) RETURNING id INTO v_supplier_transaction_id;

    IF p_update_due_date THEN
        WITH cte_to_update AS (
            SELECT id FROM public.supplier_transactions
            WHERE company_id = p_company_id AND supplier_id = p_supplier_id AND transaction_type = 'debt' AND status = 'pending'
            LIMIT 1
        )
        UPDATE public.supplier_transactions
        SET due_date = p_new_due_date
        WHERE id IN (SELECT id FROM cte_to_update);
    END IF;

    INSERT INTO public.supplier_payments (
        company_id, supplier_id, amount, payment_method, payment_date, description, created_at
    ) VALUES (
        p_company_id, p_supplier_id, p_amount, p_payment_method, v_payment_date, COALESCE(p_description, 'Tedarikçi Ödemesi'), now()
    ) RETURNING id INTO v_payment_id;

    INSERT INTO public.expenses (
        company_id, expense_date, amount, category, description, payment_method, status, supplier_id, created_at
    ) VALUES (
        p_company_id, v_payment_date, p_amount, 'supplier_payment', COALESCE(p_description, 'Tedarikçi Ödemesi'), p_payment_method, 'paid', p_supplier_id, now()
    ) RETURNING id INTO v_expense_id;

    INSERT INTO public.transactions (
        company_id, transaction_type, amount, description, reference_table, reference_id, transaction_date, created_at
    ) VALUES (
        p_company_id, 'supplier_payment', p_amount, COALESCE(p_description, 'Tedarikçi Ödemesi'), 'supplier_payments', v_payment_id, v_payment_date, now()
    ) RETURNING id INTO v_transaction_id;

    v_result := json_build_object(
        'success', true, 'supplier_transaction_id', v_supplier_transaction_id, 'payment_id', v_payment_id,
        'expense_id', v_expense_id, 'transaction_id', v_transaction_id
    );
    RETURN v_result;

EXCEPTION WHEN OTHERS THEN
    v_result := json_build_object('success', false, 'error', SQLERRM, 'error_code', SQLSTATE);
    RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_order_payment TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_invoice_save TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_income_entry TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_expense_entry TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_installer_payment TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_installer_payment TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_supplier_payment TO authenticated;

-- ============================================================================
-- 3) supplier_transactions / installer_transactions RLS — TRUE yerine
--    is_company_accounting(company_id) (income tablosuyla AYNI desen).
-- ============================================================================

DROP POLICY IF EXISTS installer_transactions_insert ON public.installer_transactions;
CREATE POLICY installer_transactions_insert ON public.installer_transactions
FOR INSERT WITH CHECK (
  is_company_accounting(company_id)
);

DROP POLICY IF EXISTS supplier_transactions_insert ON public.supplier_transactions;
CREATE POLICY supplier_transactions_insert ON public.supplier_transactions
FOR INSERT WITH CHECK (
  is_company_accounting(company_id)
);

DROP POLICY IF EXISTS supplier_transactions_update ON public.supplier_transactions;
CREATE POLICY supplier_transactions_update ON public.supplier_transactions
FOR UPDATE USING (
  is_company_accounting(company_id)
);

-- ============================================================================
-- POST-CHECK — 7 fonksiyonun hiçbirinin gövdesinde artık firma-yetki kontrolü
-- eksik değil; 3 politikanın hiçbiri artık ham TRUE değil. Herhangi biri
-- başarısızsa COMMIT ENGELLENİR.
-- ============================================================================

DO $postcheck$
DECLARE
  v_fn text;
  v_def text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['record_order_payment','record_invoice_save','record_income_entry','record_expense_entry','record_installer_payment','cancel_installer_payment','record_supplier_payment'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_fn;

    IF v_def IS NULL THEN
      RAISE EXCEPTION 'DOGRULAMA BASARISIZ: % bulunamadi — COMMIT ENGELLENDI.', v_fn;
    END IF;
    IF v_def NOT ILIKE '%unauthorized: bu firmaya erisim yok%' THEN
      RAISE EXCEPTION 'DOGRULAMA BASARISIZ: % icinde firma-yetki kontrolu yok — COMMIT ENGELLENDI.', v_fn;
    END IF;
    IF v_def NOT ILIKE '%SET search_path TO ''public''%' AND v_def NOT ILIKE '%search_path=public%' AND v_def NOT ILIKE '%search_path = public%' THEN
      RAISE EXCEPTION 'DOGRULAMA BASARISIZ: % icinde search_path pinlenmemis — COMMIT ENGELLENDI.', v_fn;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='installer_transactions' AND policyname='installer_transactions_insert' AND with_check = 'true'
  ) THEN
    RAISE EXCEPTION 'DOGRULAMA BASARISIZ: installer_transactions_insert hala TRUE — COMMIT ENGELLENDI.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='supplier_transactions' AND policyname='supplier_transactions_insert' AND with_check = 'true'
  ) THEN
    RAISE EXCEPTION 'DOGRULAMA BASARISIZ: supplier_transactions_insert hala TRUE — COMMIT ENGELLENDI.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='supplier_transactions' AND policyname='supplier_transactions_update' AND qual = 'true'
  ) THEN
    RAISE EXCEPTION 'DOGRULAMA BASARISIZ: supplier_transactions_update hala TRUE — COMMIT ENGELLENDI.';
  END IF;

  RAISE NOTICE 'DOGRULAMA PASS: 7 fonksiyon firma-yetki kontrollu + search_path pinli, 3 politika artik TRUE degil.';
END;
$postcheck$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- COMMIT SONRASI, GÖZLE TEYİT İÇİN (opsiyonel):
--
-- 1) select proname, prosecdef, proconfig from pg_proc
--    where proname in ('is_super_admin','is_company_member','is_company_accounting',
--    'record_order_payment','record_invoice_save','record_income_entry','record_expense_entry',
--    'record_installer_payment','cancel_installer_payment','record_supplier_payment');
--    -- Beklenen: proconfig içinde her satırda 'search_path=public' görünmeli.
--
-- 2) select tablename, policyname, cmd, qual, with_check from pg_policies
--    where schemaname='public' and tablename in ('supplier_transactions','installer_transactions')
--    order by tablename, policyname;
--    -- Beklenen: hiçbir with_check/qual değeri artık 'true' değil.
--
-- 3) Regresyon: mevcut bir test firmasıyla (Test Company 1/2) gelir/gider
--    kaydı, sipariş tahsilatı, montajcı ödemesi, tedarikçi ödemesi dene —
--    hepsi eskisi gibi ÇALIŞMALI (accounting/admin/owner rolündeyken).
--    Sonra BAŞKA bir firmanın gerçek ID'siyle aynı RPC'leri manuel çağırıp
--    (örn. tarayıcı konsolundan) 'unauthorized' hatası aldığını doğrula.
-- ============================================================================

COMMIT;
