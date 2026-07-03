-- ============================================================
-- Migration: orders tablosuna işçilik ve nakliye maliyet sütunları
-- Tarih: 2026-06-10
-- Güvenli: IF NOT EXISTS + DEFAULT 0
-- Mevcut siparişler etkilenmez — mevcut sütunlar dokunulmaz.
-- İdempotent: birden fazla çalıştırılabilir.
-- ============================================================

-- ── PRE-MIGRATION KONTROL ────────────────────────────────────
DO $$
DECLARE
  v_order_count   INTEGER;
  v_mech_nonzero  INTEGER;
  v_inst_nonzero  INTEGER;
BEGIN
  SELECT COUNT(*)        INTO v_order_count  FROM public.orders;
  SELECT COUNT(*)        INTO v_mech_nonzero FROM public.orders WHERE mechanism_cost IS NOT NULL AND mechanism_cost <> 0;
  SELECT COUNT(*)        INTO v_inst_nonzero FROM public.orders WHERE installation_cost IS NOT NULL AND installation_cost <> 0;

  RAISE NOTICE '=== PRE-MIGRATION ===';
  RAISE NOTICE 'Toplam sipariş: %',              v_order_count;
  RAISE NOTICE 'Sıfır olmayan mechanism_cost: %',    v_mech_nonzero;
  RAISE NOTICE 'Sıfır olmayan installation_cost: %', v_inst_nonzero;
END;
$$;

-- ── SÜTUN EKLEME ─────────────────────────────────────────────
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS labor_cost     numeric DEFAULT 0;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS transport_cost numeric DEFAULT 0;

-- ── POST-MIGRATION KONTROL ───────────────────────────────────
DO $$
DECLARE
  v_order_count_after   INTEGER;
  v_mech_nonzero_after  INTEGER;
  v_inst_nonzero_after  INTEGER;
  v_labor_exists        BOOLEAN;
  v_transport_exists    BOOLEAN;
  v_labor_nulls         INTEGER;
  v_transport_nulls     INTEGER;
BEGIN
  SELECT COUNT(*)  INTO v_order_count_after   FROM public.orders;
  SELECT COUNT(*)  INTO v_mech_nonzero_after  FROM public.orders WHERE mechanism_cost IS NOT NULL AND mechanism_cost <> 0;
  SELECT COUNT(*)  INTO v_inst_nonzero_after  FROM public.orders WHERE installation_cost IS NOT NULL AND installation_cost <> 0;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'labor_cost'
  ) INTO v_labor_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'orders' AND column_name = 'transport_cost'
  ) INTO v_transport_exists;

  SELECT COUNT(*) INTO v_labor_nulls     FROM public.orders WHERE labor_cost IS NULL;
  SELECT COUNT(*) INTO v_transport_nulls FROM public.orders WHERE transport_cost IS NULL;

  RAISE NOTICE '=== POST-MIGRATION ===';
  RAISE NOTICE 'Sipariş sayısı (değişmemeli): %',       v_order_count_after;
  RAISE NOTICE 'mechanism_cost korundu (sıfır olmayan): %', v_mech_nonzero_after;
  RAISE NOTICE 'installation_cost korundu (sıfır olmayan): %', v_inst_nonzero_after;
  RAISE NOTICE 'labor_cost sütunu var: %',      v_labor_exists;
  RAISE NOTICE 'transport_cost sütunu var: %',  v_transport_exists;
  RAISE NOTICE 'labor_cost NULL olan satır (0 olmalı): %',     v_labor_nulls;
  RAISE NOTICE 'transport_cost NULL olan satır (0 olmalı): %', v_transport_nulls;

  -- Güvenlik kontrolü: sipariş sayısı değişmişse hata fırlat
  IF v_order_count_after <> (SELECT COUNT(*) FROM public.orders) THEN
    RAISE EXCEPTION 'HATA: Sipariş sayısı değişti!';
  END IF;

  -- Sütun oluşmamışsa hata fırlat
  IF NOT v_labor_exists OR NOT v_transport_exists THEN
    RAISE EXCEPTION 'HATA: Sütunlar oluşturulamadı!';
  END IF;

  -- NULL kalmışsa hata fırlat (DEFAULT 0 çalışmış olmalı)
  IF v_labor_nulls > 0 OR v_transport_nulls > 0 THEN
    RAISE EXCEPTION 'HATA: Bazı satırlarda labor_cost/transport_cost NULL kaldı!';
  END IF;

  RAISE NOTICE '✅ Migration başarılı — tüm kontroller geçti.';
END;
$$;
