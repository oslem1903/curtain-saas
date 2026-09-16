-- ============================================================================
-- MIGRATION 012 (REVIZYON 2, DARALTILMIŞ) — KRİTİK: finansal RPC'lere firma-
-- yetki kontrolü ekleme + temel yetki fonksiyonlarına search_path pinleme.
--
-- HENÜZ PRODUCTION'DA ÇALIŞTIRILMADI. Önce incelenip onaylanacak, sonra
-- Supabase SQL Editor'da elle çalıştırılacak.
--
-- REVIZYON 2 (15.09.2026) — salt-okunur canlı durum tespiti sonrası daraltıldı:
--
--   0) DUZELTME (ilk calistirma denemesi sonrasi, 15.09.2026): GRANT EXECUTE
--      ON FUNCTION public.record_income_entry (parametre listesi olmadan)
--      "function name ... is not unique" (42725) hatasi verdi. Kok neden:
--      record_income_entry ve record_expense_entry'nin CANLI imzasi, bu
--      migration'ın (revizyon 1'den kalma) varsaydigi "orijinal guvenliksiz"
--      imzadan FARKLIYDI — production'da bu ikisi baska bir oturumda
--      IDEMPOTENCY_KEY destegiyle YENIDEN yazilmis (fazladan p_idempotency_key
--      parametresi + idempotency kontrol bloğu). Benim CREATE OR REPLACE'im
--      eski (yanlis) imzayla calisinca, transaction icinde GECICI olarak
--      IKINCI bir overload olusturdu — GRANT'i belirsiz hale getirdi. Simdi
--      bu iki fonksiyon icin CANLI GERCEK govde (idempotency dahil) BIREBIR
--      korunuyor, SADECE search_path ekleniyor. Ayrica tum GRANT ifadelerine
--      tam parametre-tipi listesi eklendi (bir daha ASLA belirsiz olmasin diye).
--
--   1) RLS/POLİTİKA BÖLÜMÜ TAMAMEN ÇIKARILDI. Revizyon 1, installer_transactions
--      / supplier_transactions üzerindeki `installer_transactions_insert`,
--      `supplier_transactions_insert`, `supplier_transactions_update` adlı
--      politikaların WITH CHECK/USING (TRUE) olduğunu varsayıyordu (2026-09-09
--      koddan denetimi). 15.09.2026 CANLI salt-okunur sorgu bu politikaların
--      ARTIK O ADLARLA MEVCUT OLMADIĞINI gösterdi — production'da bunların
--      yerini `installer_transactions_admin_update`, `company_members_
--      supplier_transactions` (cmd=ALL) gibi FARKLI adlı, zaten firma-kapsamlı
--      politikalar almış (`company_id IN (SELECT company_members.company_id
--      FROM company_members WHERE ...)` — TRUE değil). Yani bu güvenlik açığı
--      BAŞKA BİR YOLDAN ZATEN KAPANMIŞ. Revizyon 1'i olduğu gibi çalıştırmak,
--      kendi preflight kontrolünde ("installer_transactions_insert politikasi
--      bulunamadi") HATA VERİP migration'ı durdururdu. Bu revizyon o bölümü
--      tamamen kaldırır — artık hiçbir politika DROP/CREATE edilmiyor.
--
--   2) record_invoice_save BU MİGRASYONUN KAPSAMI DIŞINA ALINDI. Revizyon 1
--      bu fonksiyonu da CREATE OR REPLACE ediyordu, ama 15.09.2026 canlı
--      tespiti record_invoice_save'in ARTIK migration 014'ün (daha sonra
--      hazırlanan, atomik + is_company_writable lisans-yazma kontrollü, DAHA
--      KAPSAMLI) sürümüyle ÇALIŞTIĞINI gösterdi. Bu migration'ın record_
--      invoice_save'i BU DOSYADAKİ ESKİ (revizyon 1) haliyle CREATE OR REPLACE
--      etmesi, migration 014'ün iyileştirmelerini (invoice_items.company_id
--      yazımı, is_company_writable trial-kapısı, notes alanı) GERİYE ALIRDI.
--      Bu yüzden bu fonksiyona artık HİÇ DOKUNULMUYOR.
--
--   Geri kalan kapsam (revizyon 1'den DEĞİŞMEDİ, hâlâ CANLI olarak eksik
--   doğrulandı — 15.09.2026 salt-okunur tespit):
--     - record_order_payment, record_installer_payment, cancel_installer_payment,
--       record_supplier_payment: firma-yetki kontrolü YOK (has_012_check=false).
--     - record_income_entry, record_expense_entry: firma-yetki kontrolü ZATEN
--       VAR (başka bir yoldan/kısmi bir uygulamayla), ama search_path PİNLİ
--       DEĞİL. Bu migration onları da CREATE OR REPLACE eder — hedef gövde
--       değişmez (idempotent), yalnızca search_path eklenmiş olur.
--     - is_super_admin, is_company_member, is_company_accounting: search_path
--       PİNLİ DEĞİL (üçü de).
--
-- ============================================================================
-- BULGU (orijinal, 2026-09-09 kod denetimi — RPC kısmı hâlâ geçerli):
-- ============================================================================
--
-- supabase_payment_transaction_safety.sql içindeki fonksiyonlar SECURITY
-- DEFINER'dır, `authenticated`'a GRANT EXECUTE edilmiştir, ve (yukarıda
-- belirtilen 4'ünün) gövdelerinde p_company_id'nin ÇAĞIRANIN GERÇEKTEN ÜYESİ
-- OLDUĞU bir firma olup olmadığını kontrol eden HİÇBİR satır yoktur. Giriş
-- yapmış herhangi bir kullanıcı, başka bir firmanın company_id'sini vererek o
-- firmanın gelir/gider/tahsilat/tedarikçi/montajcı defterine sahte kayıt
-- ekleyebilir/silebilir.
--
-- Bu migration, DAHA YENİ ve DOĞRU yazılmış kardeş RPC'lerde (örn.
-- supabase_customer_collection_finance_rpc.sql'deki customer_record_collection)
-- ZATEN kullanılan AYNI deseni uygular:
--     IF NOT (p_company_id IN (SELECT public.my_company_ids()) OR public.is_super_admin()) THEN
--         RAISE EXCEPTION 'unauthorized: bu firmaya erisim yok';
--     END IF;
--     IF NOT public.is_company_accounting(p_company_id) THEN
--         RAISE EXCEPTION 'unauthorized: bu islem icin muhasebe yetkisi gerekli';
--     END IF;
-- Fonksiyonların GERİ KALANI (parametreler, dönüş tipi, iş mantığı,
-- RETURN/EXCEPTION yapısı) BİREBİR AYNI kalır — yalnızca en başa bu 2 kontrol
-- ve `SET search_path = public` eklenir.
--
-- is_super_admin(), is_company_member(uuid), is_company_accounting(uuid) —
-- SECURITY DEFINER ama search_path PINLENMEMİŞ. Bu 3 fonksiyon onlarca RLS
-- politikası ve başka fonksiyon tarafından unqualified çağrılıyor —
-- search_path hijack riski. Mantıkları BİREBİR AYNI kalır, yalnızca
-- `SET search_path = public` eklenir.
--
-- BU MIGRATION'DA YAPILMAYANLAR (bilinçli, ayrı onay gerektirir/kapsam dışı):
--   - check_subscription_active(uuid)'nin trial_ends_at NULL durumunda
--     fail-OPEN davranışı — migration 013 (ayrı, iş kararı gerektiren onay).
--   - record_invoice_save — migration 014'ün sürümü zaten canlı, DOKUNULMUYOR.
--   - installer_transactions / supplier_transactions RLS politikaları —
--     zaten başka bir yoldan firma-kapsamlı hale getirilmiş, DOKUNULMUYOR.
--
-- ROLLBACK: Fonksiyonlar için, bu migration öncesi gövdeyi yeniden CREATE OR
-- REPLACE ile çalıştırın (ama bu güvenlik açığını geri getirir — önerilmez).
-- ============================================================================

BEGIN;

-- ============================================================================
-- PREFLIGHT — yardımcı fonksiyonların production'da gerçekten bulunduğunu
-- doğrular. Sapma varsa hiçbir şey uygulanmaz. (Politika-varlığı kontrolleri
-- REVIZYON 2'de kaldırıldı — artık hiçbir politikaya dokunulmuyor.)
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
  RAISE NOTICE 'PREFLIGHT PASS.';
END;
$preflight$;

-- ============================================================================
-- 1) search_path PINLEME — is_super_admin/is_company_member/is_company_accounting.
--    Mantik BIREBIR AYNI, yalnizca SET search_path = public eklendi.
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
-- 2) FİNANSAL RPC'LERE FİRMA-YETKİ KONTROLÜ — 6 fonksiyon (record_invoice_save
--    HARİÇ — migration 014'ün sürümü zaten canlı, dokunulmuyor). Gövdelerin
--    geri kalanı (iş mantığı, RETURN/EXCEPTION yapısı) orijinaliyle BIREBIR
--    AYNI.
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

-- record_income_entry — CANLI GERCEK govde (idempotency_key destegi dahil)
-- BIREBIR korunuyor; TEK degisiklik SECURITY DEFINER'dan sonra eklenen
-- "SET search_path = public" satiridir. Firma-yetki kontrolu zaten canli
-- olarak mevcuttu (baska bir oturumda eklenmis), degistirilmedi.
CREATE OR REPLACE FUNCTION public.record_income_entry(
    p_company_id uuid,
    p_income_date timestamp with time zone,
    p_amount numeric,
    p_payment_method text DEFAULT NULL::text,
    p_description text DEFAULT NULL::text,
    p_note text DEFAULT NULL::text,
    p_source text DEFAULT 'manual'::text,
    p_order_id uuid DEFAULT NULL::uuid,
    p_create_transaction boolean DEFAULT false,
    p_idempotency_key text DEFAULT NULL::text
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
    v_income_id uuid;
    v_transaction_id uuid;
    v_existing public.income%ROWTYPE;
    v_result json;
BEGIN

    -- COMPANY / TENANT AUTHORIZATION
    IF NOT (
        p_company_id IN (SELECT public.my_company_ids())
        OR public.is_super_admin()
    ) THEN
        RAISE EXCEPTION 'unauthorized: bu firmaya erisim yok';
    END IF;

    -- RATE LIMIT
    IF NOT public.check_rate_limit(
        'record_income_entry',
        3,
        5
    ) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Rate limit exceeded. Please wait before creating more income entries.',
            'income_id', NULL
        );
    END IF;

    -- IDEMPOTENCY
    IF p_idempotency_key IS NOT NULL THEN

        SELECT *
        INTO v_existing
        FROM public.income
        WHERE company_id = p_company_id
          AND idempotency_key = p_idempotency_key
        LIMIT 1;

        IF FOUND THEN

            SELECT id
            INTO v_transaction_id
            FROM public.transactions
            WHERE reference_table = 'income'
              AND reference_id = v_existing.id
            LIMIT 1;

            RETURN json_build_object(
                'success', true,
                'income_id', v_existing.id,
                'transaction_id', v_transaction_id,
                'already_existed', true
            );

        END IF;

    END IF;

    -- INCOME INSERT
    INSERT INTO public.income (
        company_id,
        income_date,
        amount,
        payment_method,
        description,
        note,
        source,
        order_id,
        idempotency_key,
        created_at
    )
    VALUES (
        p_company_id,
        p_income_date,
        p_amount,
        p_payment_method,
        p_description,
        p_note,
        p_source,
        p_order_id,
        p_idempotency_key,
        now()
    )
    RETURNING id INTO v_income_id;

    -- OPTIONAL TRANSACTION LOG
    IF p_create_transaction THEN

        INSERT INTO public.transactions (
            company_id,
            transaction_type,
            amount,
            description,
            reference_table,
            reference_id,
            transaction_date,
            created_at
        )
        VALUES (
            p_company_id,
            'income',
            p_amount,
            p_description,
            'income',
            v_income_id,
            p_income_date,
            now()
        )
        RETURNING id INTO v_transaction_id;

    END IF;

    v_result := json_build_object(
        'success', true,
        'income_id', v_income_id,
        'transaction_id', v_transaction_id
    );

    RETURN v_result;

EXCEPTION
    WHEN OTHERS THEN

        v_result := json_build_object(
            'success', false,
            'error', SQLERRM,
            'error_code', SQLSTATE
        );

        RETURN v_result;
END;
$function$;

-- record_expense_entry — CANLI GERCEK govde (idempotency_key destegi dahil)
-- BIREBIR korunuyor; TEK degisiklik SECURITY DEFINER'dan sonra eklenen
-- "SET search_path = public" satiridir. Firma-yetki kontrolu zaten canli
-- olarak mevcuttu (baska bir oturumda eklenmis), degistirilmedi.
CREATE OR REPLACE FUNCTION public.record_expense_entry(
    p_company_id uuid,
    p_expense_date timestamp with time zone,
    p_amount numeric,
    p_category text DEFAULT NULL::text,
    p_description text DEFAULT NULL::text,
    p_note text DEFAULT NULL::text,
    p_payment_method text DEFAULT NULL::text,
    p_status text DEFAULT 'pending'::text,
    p_supplier_id uuid DEFAULT NULL::uuid,
    p_create_transaction boolean DEFAULT false,
    p_idempotency_key text DEFAULT NULL::text
)
RETURNS json
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
    v_expense_id uuid;
    v_transaction_id uuid;
    v_existing public.expenses%ROWTYPE;
    v_result json;
BEGIN

    -- COMPANY / TENANT AUTHORIZATION
    IF NOT (
        p_company_id IN (SELECT public.my_company_ids())
        OR public.is_super_admin()
    ) THEN
        RAISE EXCEPTION 'unauthorized: bu firmaya erisim yok';
    END IF;

    -- RATE LIMIT
    IF NOT public.check_rate_limit(
        'record_expense_entry',
        3,
        5
    ) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Rate limit exceeded. Please wait before creating more expense entries.',
            'expense_id', NULL
        );
    END IF;

    -- IDEMPOTENCY
    IF p_idempotency_key IS NOT NULL THEN

        SELECT *
        INTO v_existing
        FROM public.expenses
        WHERE company_id = p_company_id
          AND idempotency_key = p_idempotency_key
        LIMIT 1;

        IF FOUND THEN

            SELECT id
            INTO v_transaction_id
            FROM public.transactions
            WHERE reference_table = 'expenses'
              AND reference_id = v_existing.id
            LIMIT 1;

            RETURN json_build_object(
                'success', true,
                'expense_id', v_existing.id,
                'transaction_id', v_transaction_id,
                'already_existed', true
            );

        END IF;

    END IF;

    -- EXPENSE INSERT
    INSERT INTO public.expenses (
        company_id,
        expense_date,
        amount,
        category,
        description,
        note,
        payment_method,
        status,
        supplier_id,
        idempotency_key,
        created_at
    )
    VALUES (
        p_company_id,
        p_expense_date,
        p_amount,
        p_category,
        p_description,
        p_note,
        p_payment_method,
        p_status,
        p_supplier_id,
        p_idempotency_key,
        now()
    )
    RETURNING id INTO v_expense_id;

    -- OPTIONAL TRANSACTION LOG
    IF p_create_transaction THEN

        INSERT INTO public.transactions (
            company_id,
            transaction_type,
            amount,
            description,
            reference_table,
            reference_id,
            transaction_date,
            created_at
        )
        VALUES (
            p_company_id,
            'expense',
            p_amount,
            p_description,
            'expenses',
            v_expense_id,
            p_expense_date,
            now()
        )
        RETURNING id INTO v_transaction_id;

    END IF;

    v_result := json_build_object(
        'success', true,
        'expense_id', v_expense_id,
        'transaction_id', v_transaction_id
    );

    RETURN v_result;

EXCEPTION
    WHEN OTHERS THEN

        v_result := json_build_object(
            'success', false,
            'error', SQLERRM,
            'error_code', SQLSTATE
        );

        RETURN v_result;
END;
$function$;

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

-- Tam parametre-tipi listesiyle: "GRANT ... FUNCTION public.x TO ..." adsiz
-- hali, birden fazla overload olustugunda (bu migration'in ilk denemesinde
-- oldugu gibi) "function name ... is not unique" hatasi verebiliyor. Tam
-- imzayla bu risk tamamen ortadan kalkar.
GRANT EXECUTE ON FUNCTION public.record_order_payment(uuid, uuid, numeric, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_income_entry(uuid, timestamp with time zone, numeric, text, text, text, text, uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_expense_entry(uuid, timestamp with time zone, numeric, text, text, text, text, text, uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_installer_payment(uuid, uuid, numeric, timestamp with time zone, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_installer_payment(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_supplier_payment(uuid, uuid, numeric, text, text, timestamp with time zone, boolean, timestamp with time zone) TO authenticated;

-- ============================================================================
-- POST-CHECK — 6 fonksiyonun (record_invoice_save HARİÇ) hiçbirinin gövdesinde
-- artık firma-yetki kontrolü eksik değil, hepsinde search_path pinli; 3
-- yardımcı fonksiyonda da search_path pinli. Herhangi biri başarısızsa
-- COMMIT ENGELLENİR. (Politika kontrolleri REVIZYON 2'de kaldırıldı.)
-- ============================================================================

DO $postcheck$
DECLARE
  v_fn text;
  v_def text;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY['record_order_payment','record_income_entry','record_expense_entry','record_installer_payment','cancel_installer_payment','record_supplier_payment'] LOOP
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

  FOREACH v_fn IN ARRAY ARRAY['is_super_admin','is_company_member','is_company_accounting'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_fn;

    IF v_def IS NULL THEN
      RAISE EXCEPTION 'DOGRULAMA BASARISIZ: % bulunamadi — COMMIT ENGELLENDI.', v_fn;
    END IF;
    IF v_def NOT ILIKE '%SET search_path TO ''public''%' AND v_def NOT ILIKE '%search_path=public%' AND v_def NOT ILIKE '%search_path = public%' THEN
      RAISE EXCEPTION 'DOGRULAMA BASARISIZ: % icinde search_path pinlenmemis — COMMIT ENGELLENDI.', v_fn;
    END IF;
  END LOOP;

  RAISE NOTICE 'DOGRULAMA PASS: 6 finansal RPC firma-yetki kontrollu + search_path pinli, 3 yardimci fonksiyon search_path pinli.';
END;
$postcheck$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- COMMIT SONRASI, GÖZLE TEYİT İÇİN (opsiyonel):
--
-- 1) select proname, prosecdef, proconfig from pg_proc
--    where proname in ('is_super_admin','is_company_member','is_company_accounting',
--    'record_order_payment','record_income_entry','record_expense_entry',
--    'record_installer_payment','cancel_installer_payment','record_supplier_payment');
--    -- Beklenen: proconfig içinde her satırda 'search_path=public' görünmeli.
--
-- 2) Regresyon: mevcut bir test firmasıyla (Test Company 1/2) gelir/gider
--    kaydı, sipariş tahsilatı, montajcı ödemesi, tedarikçi ödemesi dene —
--    hepsi eskisi gibi ÇALIŞMALI (accounting/admin/owner rolündeyken).
--    Sonra BAŞKA bir firmanın gerçek ID'siyle aynı RPC'leri manuel çağırıp
--    (örn. tarayıcı konsolundan) 'unauthorized' hatası aldığını doğrula.
-- ============================================================================

COMMIT;
