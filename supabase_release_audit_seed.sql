-- ============================================================
-- PERDEPRO - Release Audit Test Verisi
-- ⚠ SADECE TEST FİRMASINDA ÇALIŞTIRIN. Tüm kayıtlar 'RA-' önekiyle
-- işaretlidir; en alttaki TEMİZLİK bloğu ile tamamı geri alınır.
-- Kullanım: aşağıdaki company_id değerini test firmanızın id'siyle değiştirin.
-- ============================================================

DO $$
DECLARE
    cid UUID := 'BURAYA-TEST-COMPANY-ID';  -- ← değiştirin
    cust UUID; ord UUID; sup1 UUID; sup2 UUID;
    i INT;
    total NUMERIC;
BEGIN
    -- 2 test tedarikçisi
    INSERT INTO suppliers (company_id, name) VALUES (cid, 'RA-Tedarikçi A') RETURNING id INTO sup1;
    INSERT INTO suppliers (company_id, name) VALUES (cid, 'RA-Tedarikçi B') RETURNING id INTO sup2;

    FOR i IN 1..20 LOOP
        -- 20 müşteri
        INSERT INTO customers (company_id, name, phone)
        VALUES (cid, 'RA-Müşteri ' || i, '0500' || lpad(i::text, 7, '0'))
        RETURNING id INTO cust;

        -- 20 teklif (ölçü randevusu, done)
        INSERT INTO appointments (company_id, customer_id, type, status, start_at, notes)
        VALUES (cid, cust, 'measurement', 'done', now(), 'RA-Teklif ' || i);

        -- İlk 15'i sipariş
        IF i <= 15 THEN
            total := i * 1000;
            INSERT INTO orders (company_id, customer_id, status, total_amount, paid_amount, remaining_amount, payment_due_date)
            VALUES (cid, cust, 'open', total, 0, total,
                    CASE WHEN i <= 5 THEN (CURRENT_DATE + 7) ELSE NULL END)  -- 5 vadeli tahsilat
            RETURNING id INTO ord;

            -- Tedarikçi borcu (%40 maliyet); ilk 5'i vadeli borç
            INSERT INTO supplier_transactions (company_id, supplier_id, order_id, transaction_date, transaction_type, amount, description, due_date)
            VALUES (cid, CASE WHEN i % 2 = 0 THEN sup1 ELSE sup2 END, ord, now(), 'debt', total * 0.4,
                    'RA-Sipariş ' || i || ' maliyeti',
                    CASE WHEN i <= 5 THEN (CURRENT_DATE + 5) ELSE NULL END);

            -- İlk 10 siparişe yarı tahsilat
            IF i <= 10 THEN
                UPDATE orders SET paid_amount = total / 2, remaining_amount = total / 2 WHERE id = ord;
                INSERT INTO income (company_id, amount, income_date, payment_method, description, source, order_id)
                VALUES (cid, total / 2, now(), 'nakit', 'RA-Müşteri ' || i || ' - Sipariş tahsilatı', 'order_payment', ord);
            END IF;
        END IF;
    END LOOP;

    -- 10 tedarikçi ödemesi (5'er adet, payment türü + gider)
    FOR i IN 1..10 LOOP
        INSERT INTO supplier_transactions (company_id, supplier_id, transaction_date, transaction_type, amount, description, payment_method)
        VALUES (cid, CASE WHEN i % 2 = 0 THEN sup1 ELSE sup2 END, now(), 'payment', 500, 'RA-Tedarikçi ödemesi ' || i, 'nakit');
        INSERT INTO supplier_payments (company_id, supplier_id, payment_date, amount, payment_method, note)
        VALUES (cid, CASE WHEN i % 2 = 0 THEN sup1 ELSE sup2 END, now(), 500, 'nakit', 'RA-Ödeme ' || i);
        INSERT INTO expenses (company_id, supplier_id, amount, expense_date, category, status, note)
        VALUES (cid, CASE WHEN i % 2 = 0 THEN sup1 ELSE sup2 END, 500, now(), 'Tedarik', 'paid', 'RA-Tedarikçi ödemesi ' || i);
    END LOOP;

    -- 5 montajcı ödemesi (personel gideri)
    FOR i IN 1..5 LOOP
        INSERT INTO expenses (company_id, amount, expense_date, category, status, note)
        VALUES (cid, 2000, now(), 'Personel ödemesi', 'paid', 'RA-Montajcı ödemesi ' || i);
    END LOOP;
END $$;

-- ============================================================
-- DOĞRULAMA SORGULARI (beklenen değerler)
-- Toplam sipariş: 120.000 | Tahsilat: 27.500 | Bekleyen: 92.500
-- Tedarikçi borç: 48.000  | Tedarikçi ödenen: 5.000 | Kalan: 43.000
-- Toplam gider: 5.000 (tedarik) + 10.000 (montajcı) = 15.000
-- ============================================================
-- SELECT sum(remaining_amount) AS bekleyen FROM orders WHERE company_id='...' AND status NOT IN ('cancelled','draft');
-- SELECT sum(amount) AS bu_ay_tahsilat FROM income WHERE company_id='...' AND source='order_payment';
-- SELECT transaction_type, sum(amount) FROM supplier_transactions WHERE company_id='...' GROUP BY 1;
-- SELECT sum(amount) AS toplam_gider FROM expenses WHERE company_id='...';

-- ============================================================
-- TEMİZLİK (test bitince çalıştırın — tüm RA- kayıtlarını siler)
-- ============================================================
-- DELETE FROM income WHERE description LIKE 'RA-%';
-- DELETE FROM expenses WHERE note LIKE 'RA-%';
-- DELETE FROM supplier_payments WHERE note LIKE 'RA-%';
-- DELETE FROM supplier_transactions WHERE description LIKE 'RA-%';
-- DELETE FROM orders WHERE customer_id IN (SELECT id FROM customers WHERE name LIKE 'RA-%');
-- DELETE FROM appointments WHERE notes LIKE 'RA-%';
-- DELETE FROM customers WHERE name LIKE 'RA-%';
-- DELETE FROM suppliers WHERE name LIKE 'RA-%';
