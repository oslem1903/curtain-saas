-- ============================================================================
-- PERDEPRO COMMERCIALIZATION SPRINT 3
-- DEMO DATA GENERATOR + FIRST EXPERIENCE
-- ============================================================================
-- Creates realistic Turkish demo data for new companies
-- Idempotent: aborts if demo data already exists
-- Safe: never overwrites existing business data
-- ============================================================================

-- ============================================================================
-- RPC: generate_demo_data
-- ============================================================================
-- Authorization: owner, admin, super_admin
-- Returns: {success: boolean, message: string}
-- ============================================================================

CREATE OR REPLACE FUNCTION public.generate_demo_data(p_company_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_is_super_admin boolean;
  v_is_owner boolean;
  v_is_admin boolean;
  v_has_access boolean;
  v_customer_count integer;
  v_order_count integer;
  v_has_existing_data boolean;
  v_customer_id uuid;
  v_supplier_id uuid;
  v_product_id uuid;
  v_order_id uuid;
  v_appointment_id uuid;
  v_i integer;
  v_total_amount numeric;
  v_date_offset integer;

  -- Turkish names and data
  v_first_names text[] := ARRAY[
    'Ahmet', 'Mehmet', 'Ali', 'Mustafa', 'İbrahim', 'Hasan', 'Fatih', 'Murat',
    'Ayşe', 'Emine', 'Zeynep', 'Leyla', 'Selma', 'Gülşah', 'Hülya', 'Neşe',
    'Emrah', 'Kerem', 'Serkan', 'Yasin'
  ];

  v_last_names text[] := ARRAY[
    'Yılmaz', 'Demir', 'Şahin', 'Kaya', 'Arslan', 'Eren', 'Çelik', 'Durmaz',
    'Karaca', 'Uçar', 'Taş', 'Akçay', 'Köprübaşı', 'Turhan', 'Bayram', 'Gürsoy',
    'Çinko', 'Albayrak', 'Tekcan', 'Sazak'
  ];

  v_districts text[] := ARRAY[
    'Nilüfer', 'Osmangazi', 'Yıldırım', 'İnegöl', 'Karacabey', 'Keles', 'Gemlik', 'Mustafakemalpaşa'
  ];

  v_products text[] := ARRAY[
    'Stor Perde Beyaz', 'Stor Perde Gri', 'Zebra Perde Krem', 'Zebra Perde Antrasit',
    'Plise Perde Beyaz', 'Plise Perde Şeffaf', 'Fon Perde Sal', 'Fon Perde Gümüş',
    'Jaluzi Alu 25mm', 'Jaluzi Alu 50mm', 'Tül Perde Beyaz', 'Tül Perde Krem',
    'Blackout Perde Gri', 'Blackout Perde Siyah', 'Panel Kanat Beyaz', 'Panel Kanat Gri',
    'Laminat Jaluzi', 'Ahşap Jaluzi', 'Cam Balkon Profili', 'Alüminyum Çıta',
    'Montaj Malzemesi Seti', 'Dekoratif Çubuk', 'Perde İpi Seti', 'Zincir Sistemi',
    'Motorlu Perde Seti'
  ];

  v_supplier_names text[] := ARRAY[
    'TSD Perde Ünü Ltd.',
    'Ekol Tekstil A.Ş.',
    'Bursa Kumaş İthalatçıları',
    'Nilüfer Aksesuarlar Ltd.',
    'Ulus Metal Alüminyum',
    'Türkteks Dokuma',
    'Perde Tarihi Bursa',
    'Modern Tekstil Merkezi'
  ];

  v_addresses text[] := ARRAY[
    'Nilüfer, Orhangazi Cad. No:42', 'Osmangazi, İskender Pş. Cad. No:78',
    'Yıldırım, Mimar Sinan Cad. No:15', 'İnegöl, Sakarya Cad. No:33',
    'Karacabey, Cumhuriyet Cad. No:9', 'Keles, Orman Cad. No:21',
    'Gemlik, Liman Cad. No:56', 'Mustafakemalpaşa, Saraçlar Cad. No:12'
  ];

BEGIN
  v_company_id := p_company_id;

  -- Check authorization
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = auth.uid() AND role = 'super_admin'
  ) INTO v_is_super_admin;

  SELECT EXISTS (
    SELECT 1 FROM companies
    WHERE id = v_company_id AND owner_id = auth.uid()
  ) INTO v_is_owner;

  SELECT EXISTS (
    SELECT 1 FROM company_members
    WHERE company_id = v_company_id
      AND user_id = auth.uid()
      AND role = 'admin'
      AND is_active = true
  ) INTO v_is_admin;

  v_has_access := v_is_super_admin OR v_is_owner OR v_is_admin;

  IF NOT v_has_access THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Yetkiniz yok. Demo verisi oluşturmak için admin olmanız gerekir.'
    );
  END IF;

  -- Check if ANY business data already exists (comprehensive safety check)
  IF EXISTS (SELECT 1 FROM customers WHERE company_id = v_company_id)
  OR EXISTS (SELECT 1 FROM suppliers WHERE company_id = v_company_id)
  OR EXISTS (SELECT 1 FROM products WHERE company_id = v_company_id)
  OR EXISTS (SELECT 1 FROM orders WHERE company_id = v_company_id)
  OR EXISTS (SELECT 1 FROM order_items WHERE company_id = v_company_id)
  OR EXISTS (SELECT 1 FROM appointments WHERE company_id = v_company_id)
  OR EXISTS (SELECT 1 FROM installation_jobs WHERE company_id = v_company_id)
  OR EXISTS (SELECT 1 FROM income WHERE company_id = v_company_id)
  OR EXISTS (SELECT 1 FROM expenses WHERE company_id = v_company_id)
  OR EXISTS (SELECT 1 FROM supplier_payments WHERE company_id = v_company_id)
  THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Bu firmada mevcut iş verileri bulunduğu için demo veri oluşturulamaz.'
    );
  END IF;

  -- CREATE DEMO DATA
  -- 8 suppliers
  FOR v_i IN 1..8 LOOP
    INSERT INTO suppliers (company_id, name, created_at)
    VALUES (v_company_id, v_supplier_names[v_i], now())
    RETURNING id INTO v_supplier_id;
  END LOOP;

  -- 25 products
  FOR v_i IN 1..25 LOOP
    INSERT INTO products (
      company_id, name, category, unit_price, is_active, option_pricing, created_at
    )
    VALUES (
      v_company_id,
      v_products[v_i],
      CASE WHEN v_i <= 4 THEN 'stor'
           WHEN v_i <= 8 THEN 'zebra'
           WHEN v_i <= 12 THEN 'plise'
           WHEN v_i <= 14 THEN 'jaluzi'
           ELSE 'aksesuar' END,
      CASE WHEN v_i <= 4 THEN 3500 + (v_i * 100)
           WHEN v_i <= 8 THEN 4200 + (v_i * 150)
           WHEN v_i <= 12 THEN 2800 + (v_i * 80)
           WHEN v_i <= 14 THEN 3200 + (v_i * 120)
           ELSE 800 + (v_i * 50) END::numeric,
      true,
      '{}'::jsonb,
      now()
    );
  END LOOP;

  -- 20 customers with data
  FOR v_i IN 1..20 LOOP
    INSERT INTO customers (
      company_id, name, phone, email, created_at
    )
    VALUES (
      v_company_id,
      v_first_names[(v_i % 20) + 1] || ' ' || v_last_names[(v_i % 20) + 1],
      '0(532)' || lpad((v_i * 17)::text, 7, '0'),
      lower(v_first_names[(v_i % 20) + 1]) || '.' || lower(v_last_names[(v_i % 20) + 1]) || '@example.com',
      now() - ((20 - v_i) || ' days')::interval
    )
    RETURNING id INTO v_customer_id;

    -- 15 measurements (appointments)
    IF v_i <= 15 THEN
      INSERT INTO appointments (
        company_id, customer_id, type, status, start_at, notes, created_at
      )
      VALUES (
        v_company_id,
        v_customer_id,
        'measurement',
        CASE WHEN v_i <= 8 THEN 'done' ELSE 'scheduled' END,
        now() - ((15 - v_i) || ' days')::interval,
        v_districts[(v_i % 8) + 1] || ' Cad. - ' || v_i || '. kat ölçümü',
        now() - ((15 - v_i) || ' days')::interval
      );
    END IF;

    -- 12 orders
    IF v_i <= 12 THEN
      v_total_amount := (2000 + (v_i * 500))::numeric;
      v_date_offset := 12 - v_i;

      INSERT INTO orders (
        company_id, customer_id, status, total_amount, paid_amount, remaining_amount,
        payment_due_date, notes, created_at
      )
      VALUES (
        v_company_id,
        v_customer_id,
        CASE WHEN v_i <= 4 THEN 'completed'
             WHEN v_i <= 8 THEN 'in_progress'
             ELSE 'pending' END,
        v_total_amount,
        CASE WHEN v_i <= 4 THEN v_total_amount
             WHEN v_i <= 8 THEN v_total_amount * 0.5
             ELSE 0 END,
        CASE WHEN v_i <= 4 THEN 0
             WHEN v_i <= 8 THEN v_total_amount * 0.5
             ELSE v_total_amount END,
        CASE WHEN v_i > 4 THEN now() + ((7 + v_i) || ' days')::interval ELSE NULL END,
        'Müşteri ' || v_i || ' - ' || v_products[(v_i % 25) + 1],
        now() - (v_date_offset || ' days')::interval
      )
      RETURNING id INTO v_order_id;

      -- Add order_items for cost tracking (Dashboard monthCost KPI)
      INSERT INTO order_items (
        company_id, order_id, product_id, qty, supplier_unit_cost, supplier_total_cost, profit, line_total, created_at
      )
      SELECT
        v_company_id,
        v_order_id,
        id,
        1,
        (unit_price * 0.6)::numeric,
        (unit_price * 0.6)::numeric,
        (unit_price * 0.4)::numeric,
        unit_price,
        now() - (v_date_offset || ' days')::interval
      FROM products
      WHERE company_id = v_company_id
      LIMIT 2;

      -- Add income for paid orders
      IF v_i <= 8 THEN
        INSERT INTO income (
          company_id, amount, income_date, payment_method, description, source, order_id, created_at
        )
        VALUES (
          v_company_id,
          CASE WHEN v_i <= 4 THEN v_total_amount ELSE v_total_amount * 0.5 END,
          now() - (v_date_offset || ' days')::interval,
          CASE WHEN v_i % 3 = 0 THEN 'eft' WHEN v_i % 3 = 1 THEN 'kredi_karti' ELSE 'nakit' END,
          'Müşteri ' || v_i || ' Tahsilatı',
          'order_payment',
          v_order_id,
          now() - (v_date_offset || ' days')::interval
        );
      END IF;
    END IF;

    -- 8 completed installations (as installation_jobs)
    IF v_i <= 8 THEN
      -- Get the order for this customer
      SELECT id INTO v_order_id FROM orders
      WHERE company_id = v_company_id AND customer_id = v_customer_id
      ORDER BY created_at DESC LIMIT 1;

      IF v_order_id IS NOT NULL THEN
        INSERT INTO installation_jobs (
          company_id, order_id, customer_name, status, scheduled_date, scheduled_time, total_amount, created_at
        )
        VALUES (
          v_company_id,
          v_order_id,
          v_first_names[(v_i % 20) + 1] || ' ' || v_last_names[(v_i % 20) + 1],
          CASE WHEN v_i <= 6 THEN 'completed' ELSE 'pending' END,
          now() - ((16 - v_i) || ' days')::interval,
          '09:00',
          v_total_amount,
          now() - ((16 - v_i) || ' days')::interval
        );
      END IF;
    END IF;

    -- 10 appointments (general)
    IF v_i <= 10 THEN
      INSERT INTO appointments (
        company_id, customer_id, type, status, start_at, notes, created_at
      )
      VALUES (
        v_company_id,
        v_customer_id,
        CASE WHEN v_i % 3 = 0 THEN 'consultation'
             WHEN v_i % 3 = 1 THEN 'installation'
             ELSE 'delivery' END,
        CASE WHEN v_i <= 3 THEN 'done'
             WHEN v_i <= 7 THEN 'scheduled'
             ELSE 'pending' END,
        now() + ((5 + v_i) || ' days')::interval,
        'Randevu ' || v_i || ' - ' || v_districts[(v_i % 8) + 1],
        now()
      );
    END IF;
  END LOOP;

  -- 10 payments (cycle through suppliers safely)
  FOR v_i IN 1..10 LOOP
    SELECT id INTO v_supplier_id FROM suppliers
    WHERE company_id = v_company_id
    ORDER BY created_at, id
    LIMIT 1 OFFSET ((v_i - 1) % 8);

    IF v_supplier_id IS NULL THEN
      RAISE EXCEPTION 'No suppliers found for payment %', v_i;
    END IF;

    INSERT INTO supplier_payments (
      company_id, supplier_id, payment_date, amount, payment_method, note, created_at
    )
    VALUES (
      v_company_id,
      v_supplier_id,
      now() - ((10 - v_i) || ' days')::interval,
      (1000 + (v_i * 200))::numeric,
      CASE WHEN v_i % 3 = 0 THEN 'eft' WHEN v_i % 3 = 1 THEN 'çek' ELSE 'nakit' END,
      'Tedarikçi Ödeme ' || v_i,
      now() - ((10 - v_i) || ' days')::interval
    );
  END LOOP;

  -- 8 expenses
  FOR v_i IN 1..8 LOOP
    INSERT INTO expenses (
      company_id, amount, expense_date, category, status, note, created_at
    )
    VALUES (
      v_company_id,
      (500 + (v_i * 150))::numeric,
      now() - ((8 - v_i) || ' days')::interval,
      CASE WHEN v_i % 4 = 0 THEN 'Transport'
           WHEN v_i % 4 = 1 THEN 'Personel'
           WHEN v_i % 4 = 2 THEN 'Malzeme'
           ELSE 'Diğer' END,
      'paid',
      'Gider ' || v_i,
      now() - ((8 - v_i) || ' days')::interval
    );
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Demo verisi başarıyla oluşturuldu. 20 müşteri, 25 ürün, 12 sipariş, 8 teslim ve daha fazlası eklenmiştir.'
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'message', 'Hata: ' || SQLERRM
  );
END $$;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
SELECT 'MIGRATION: Demo Data Generator Complete' AS status;
