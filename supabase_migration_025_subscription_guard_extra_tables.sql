-- ============================================================================
-- Migration 025 (v2): Deneme/abonelik yazma korumasini 8 is tablosuna genislet
--
-- CANLI YAPI INCELEMESI (salt okunur, 2026-10-02) — her tablo icin isletme
-- baglantisi ACIKCA tanimlandi; FK otomatik secilmez:
--
--   tablo                  company_id            dogrulanan ust baglantilar
--   ---------------------  --------------------  ------------------------------------------
--   accounts               NOT NULL (FK auth.users!) -  (deger companies.id'de OLMALI)
--   appointment_assignees  NOT NULL              appointment_id -> appointments.id
--   catalog_collections    NOT NULL              -
--   catalog_items          NOT NULL              collection_id  -> catalog_collections.id
--   expense_categories     NOT NULL              -
--   income_categories      NOT NULL              -
--   installer_payments     NULL olabilir         order_id       -> orders.id
--   supplier_work_orders   NULL olabilir         order_id -> orders.id, supplier_id -> suppliers.id
--
--   Not: accounts.company_id'nin FK'si auth.users'a gidiyor (eski sema). Mevcut
--   2 satirin degeri hem companies.id hem kullanici id'si (sahibinin id'si ile
--   ayni olan eski firma). Bu yuzden deger companies tablosunda ARANIR;
--   bulunamazsa yazma engellenir.
--
-- ISLETME BELIRLEME KURALI (yeni/degisen satir):
--   1) company_id doluysa companies'te var olmali.
--   2) Doldurulmus her ust baglanti ayni isletmeye cikmali; company_id ile de
--      ayni olmali. Farkliysa: PERDEPRO_COMPANY_MISMATCH.
--   3) Hicbir kaynaktan isletme belirlenemezse: PERDEPRO_COMPANY_UNRESOLVED.
--      Bu 8 tabloda ORTAK/SABLON kayit YOKTUR (dogrulanan kural: 6 tabloda
--      company_id NOT NULL; diger 2 tabloda company_id NULL satir sayisi 0 ve
--      hicbir RLS politikasi / uygulama ekrani / fonksiyon NULL isletmeli satir
--      kullanmiyor). Bu nedenle isletmesiz satir sessizce gecirilmez.
--   4) Kullanici o isletmenin aktif uyesi degilse (super admin haric):
--      PERDEPRO_COMPANY_FORBIDDEN. (SECURITY DEFINER RPC'ler RLS'i atlasa da
--      bu tetikleyici calisir.)
--   5) Isletmenin deneme/aboneligi yazmaya izin vermiyorsa (024 ile ayni karar,
--      super admin muaf): PERDEPRO_SUBSCRIPTION_READ_ONLY.
--   Oturumsuz islemler (SQL Editor / service role / cron; auth.uid() NULL) muaftir.
--
-- RLS politikalari, tablo yetkileri ve okuma (SELECT) DEGISTIRILMEZ.
-- Tekrar calistirilabilir. Gerekli: migration 024.
-- Sema incelemedeki halden farkliysa migration HICBIR SEY yapmadan durur.
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0) On kosullar ve CANLI SEMA DOGRULAMASI
-- ---------------------------------------------------------------------------
DO $pre$
DECLARE
  v_spec record;
  v_parent text;
  v_fk text;
  v_expected text[];
  v_actual text[];
BEGIN
  IF to_regprocedure('public.company_subscription_allows_write(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: once migration 024 calistirilmali.';
  END IF;
  IF to_regprocedure('public.is_super_admin()') IS NULL OR to_regprocedure('public.is_company_member(uuid)') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: is_super_admin()/is_company_member(uuid) bulunamadi.';
  END IF;

  FOR v_spec IN
    SELECT * FROM (VALUES
      ('accounts',              ARRAY[]::text[]),
      ('appointment_assignees', ARRAY['appointment_id=appointments']),
      ('catalog_collections',   ARRAY[]::text[]),
      ('catalog_items',         ARRAY['collection_id=catalog_collections']),
      ('expense_categories',    ARRAY[]::text[]),
      ('income_categories',     ARRAY[]::text[]),
      ('installer_payments',    ARRAY['order_id=orders']),
      ('supplier_work_orders',  ARRAY['order_id=orders', 'supplier_id=suppliers'])
    ) AS s(tbl, parents)
  LOOP
    IF to_regclass('public.' || v_spec.tbl) IS NULL THEN
      RAISE EXCEPTION 'SEMA: public.% bulunamadi.', v_spec.tbl;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute a
      WHERE a.attrelid = ('public.' || v_spec.tbl)::regclass AND a.attname = 'company_id'
        AND NOT a.attisdropped AND a.atttypid = 'uuid'::regtype
    ) THEN
      RAISE EXCEPTION 'SEMA: %.company_id uuid kolonu bulunamadi.', v_spec.tbl;
    END IF;

    -- Tanimli her ust baglanti: tek kolonlu FK, ust tablo id uuid ve company_id uuid
    FOREACH v_fk IN ARRAY v_spec.parents LOOP
      v_parent := split_part(v_fk, '=', 2);
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint con
        JOIN pg_attribute ca ON ca.attrelid = con.conrelid AND ca.attnum = con.conkey[1]
        JOIN pg_attribute pa ON pa.attrelid = con.confrelid AND pa.attnum = con.confkey[1]
        WHERE con.contype = 'f'
          AND con.conrelid = ('public.' || v_spec.tbl)::regclass
          AND con.confrelid = ('public.' || v_parent)::regclass
          AND array_length(con.conkey, 1) = 1
          AND ca.attname = split_part(v_fk, '=', 1)
          AND pa.attname = 'id' AND pa.atttypid = 'uuid'::regtype
      ) THEN
        RAISE EXCEPTION 'SEMA: %.% -> %.id (uuid) FK bulunamadi.', v_spec.tbl, split_part(v_fk, '=', 1), v_parent;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = ('public.' || v_parent)::regclass AND a.attname = 'company_id'
          AND NOT a.attisdropped AND a.atttypid = 'uuid'::regtype
      ) THEN
        RAISE EXCEPTION 'SEMA: ust tablo %.company_id uuid degil/yok.', v_parent;
      END IF;
    END LOOP;

    -- Inceleme sonrasi yeni bir isletme baglantisi (company_id'li ust tabloya FK)
    -- eklendiyse otomatik secme: dur ve incelet.
    SELECT coalesce(array_agg(ca.attname || '=' || pc.relname ORDER BY ca.attname || '=' || pc.relname), ARRAY[]::text[])
      INTO v_actual
    FROM pg_constraint con
    JOIN pg_class pc ON pc.oid = con.confrelid AND pc.relnamespace = 'public'::regnamespace
    JOIN pg_attribute ca ON ca.attrelid = con.conrelid AND ca.attnum = con.conkey[1]
    WHERE con.contype = 'f'
      AND con.conrelid = ('public.' || v_spec.tbl)::regclass
      AND pc.relname <> 'companies'
      AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = con.confrelid AND x.attname = 'company_id' AND NOT x.attisdropped);
    SELECT coalesce(array_agg(p ORDER BY p), ARRAY[]::text[]) INTO v_expected FROM unnest(v_spec.parents) p;
    IF v_actual IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'SEMA: % icin isletme baglantilari beklenenden farkli. Beklenen: %, canli: %. Migration durduruldu.',
        v_spec.tbl, v_expected, v_actual;
    END IF;
  END LOOP;
END
$pre$;

-- v1 taslagindan kalmis olabilecek nesneler (canliya hic uygulanmadi; temizlik)
DO $cleanup$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgname = 'trg_subscription_write_guard' AND p.proname = 'enforce_company_subscription_write_resolved'
  LOOP
    EXECUTE format('drop trigger if exists trg_subscription_write_guard on public.%I', r.relname);
  END LOOP;
END
$cleanup$;
DROP FUNCTION IF EXISTS public.enforce_company_subscription_write_resolved();
DROP FUNCTION IF EXISTS public.resolve_row_company_for_guard(jsonb, text, text, text, text);

-- ---------------------------------------------------------------------------
-- 1) Satirin isletmesini belirle
--    p_parents: {'fk_kolonu=ust_tablo', ...}  (ust anahtar her zaman id uuid)
--    p_strict = true  -> yeni/degisen satir: belirlenemezse veya tutarsizsa hata
--    p_strict = false -> eski satir (UPDATE/DELETE oncesi hali): silinmis ust kayit
--                        atlanir (cascade silmeler icin), tutarsizlikta satirin
--                        kendi company_id'si esas alinir; belirlenemezse NULL
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_resolve_row_company(
  p_table text,
  p_row jsonb,
  p_parents text[],
  p_strict boolean
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_result uuid;
  v_parent_company uuid;
  v_spec text;
  v_fk_col text;
  v_parent text;
  v_fk_value text;
BEGIN
  IF p_row IS NULL THEN
    RETURN NULL;
  END IF;

  IF nullif(p_row->>'company_id', '') IS NOT NULL THEN
    v_result := (p_row->>'company_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.companies c WHERE c.id = v_result) THEN
      IF p_strict THEN
        RAISE EXCEPTION 'PERDEPRO_COMPANY_UNRESOLVED: %.company_id bir işletmeye ait değil.', p_table
          USING ERRCODE = '23503';
      END IF;
      v_result := NULL;
    END IF;
  END IF;

  FOREACH v_spec IN ARRAY coalesce(p_parents, ARRAY[]::text[]) LOOP
    v_fk_col := split_part(v_spec, '=', 1);
    v_parent := split_part(v_spec, '=', 2);
    v_fk_value := nullif(p_row->>v_fk_col, '');
    CONTINUE WHEN v_fk_value IS NULL;

    v_parent_company := NULL;
    EXECUTE format('select company_id from public.%I where id = $1::uuid', v_parent)
      INTO v_parent_company USING v_fk_value;

    IF v_parent_company IS NULL THEN
      IF p_strict THEN
        RAISE EXCEPTION 'PERDEPRO_COMPANY_UNRESOLVED: %.% bağlı kaydı bulunamadı veya işletmesi yok.', p_table, v_fk_col
          USING ERRCODE = '23503';
      END IF;
      CONTINUE;
    END IF;

    IF v_result IS NULL THEN
      v_result := v_parent_company;
    ELSIF v_result <> v_parent_company AND p_strict THEN
      RAISE EXCEPTION 'PERDEPRO_COMPANY_MISMATCH: %.% başka bir işletmenin kaydına bağlanamaz.', p_table, v_fk_col
        USING ERRCODE = '23514';
    END IF;
  END LOOP;

  IF v_result IS NULL AND p_strict THEN
    RAISE EXCEPTION 'PERDEPRO_COMPANY_UNRESOLVED: % kaydının işletmesi belirlenemedi; işletmesiz kayıt kabul edilmez.', p_table
      USING ERRCODE = '23502';
  END IF;

  RETURN v_result;
END;
$fn$;

REVOKE ALL ON FUNCTION public.guard_resolve_row_company(text, jsonb, text[], boolean) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) Tetikleyici: TG_ARGV = tablonun ust baglantilari ('fk=ust_tablo')
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_company_subscription_write_linked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_parents text[] := coalesce(tg_argv::text[], ARRAY[]::text[]);
  v_new_company uuid;
  v_old_company uuid;
  v_is_super boolean;
BEGIN
  -- Oturumsuz bakim islemleri (SQL Editor, service role, cron) muaf.
  IF auth.uid() IS NULL THEN
    IF tg_op = 'DELETE' THEN RETURN old; END IF;
    RETURN new;
  END IF;

  v_is_super := public.is_super_admin();

  IF tg_op IN ('INSERT', 'UPDATE') THEN
    v_new_company := public.guard_resolve_row_company(tg_table_name, to_jsonb(new), v_parents, true);
    -- company_id bos birakildiysa ust kayittan bulunan isletme yazilir; boylece
    -- ust kayit sonradan silinse (FK SET NULL) bile satir isletmesiz kalmaz.
    IF to_jsonb(new)->>'company_id' IS NULL THEN
      new := jsonb_populate_record(new, jsonb_build_object('company_id', v_new_company));
    END IF;
  END IF;

  IF tg_op IN ('UPDATE', 'DELETE') THEN
    v_old_company := public.guard_resolve_row_company(tg_table_name, to_jsonb(old), v_parents, false);
    -- Isletmesi belirlenemeyen eski satiri yalnizca super admin (veya oturumsuz
    -- bakim) silebilir; sessizce gecilmez.
    IF tg_op = 'DELETE' AND v_old_company IS NULL AND NOT v_is_super THEN
      RAISE EXCEPTION 'PERDEPRO_COMPANY_UNRESOLVED: % kaydının işletmesi belirlenemedi; silme yalnızca süper yönetici tarafından yapılabilir.', tg_table_name
        USING ERRCODE = '23502';
    END IF;
  END IF;

  IF NOT v_is_super THEN
    IF (v_new_company IS NOT NULL AND NOT public.is_company_member(v_new_company))
       OR (v_old_company IS NOT NULL AND NOT public.is_company_member(v_old_company)) THEN
      RAISE EXCEPTION 'PERDEPRO_COMPANY_FORBIDDEN: Bu işletmenin kaydını değiştirme yetkiniz yok.'
        USING ERRCODE = '42501';
    END IF;

    IF (v_new_company IS NOT NULL AND NOT public.company_subscription_allows_write(v_new_company))
       OR (v_old_company IS NOT NULL AND NOT public.company_subscription_allows_write(v_old_company)) THEN
      RAISE EXCEPTION 'PERDEPRO_SUBSCRIPTION_READ_ONLY: Deneme veya abonelik süreniz dolduğu için yeni kayıt ve değişiklik yapılamaz. Verileriniz korunuyor ve görüntülenebilir.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF tg_op = 'DELETE' THEN RETURN old; END IF;
  RETURN new;
END;
$fn$;

-- ---------------------------------------------------------------------------
-- 3) Kurulum (acik tablo -> baglanti listesi; otomatik FK secimi YOK)
-- ---------------------------------------------------------------------------
DO $install$
DECLARE
  v_spec record;
  v_args text;
BEGIN
  FOR v_spec IN
    SELECT * FROM (VALUES
      ('accounts',              ARRAY[]::text[]),
      ('appointment_assignees', ARRAY['appointment_id=appointments']),
      ('catalog_collections',   ARRAY[]::text[]),
      ('catalog_items',         ARRAY['collection_id=catalog_collections']),
      ('expense_categories',    ARRAY[]::text[]),
      ('income_categories',     ARRAY[]::text[]),
      ('installer_payments',    ARRAY['order_id=orders']),
      ('supplier_work_orders',  ARRAY['order_id=orders', 'supplier_id=suppliers'])
    ) AS s(tbl, parents)
  LOOP
    SELECT coalesce(string_agg(quote_literal(p), ', '), '') INTO v_args FROM unnest(v_spec.parents) p;
    EXECUTE format('drop trigger if exists trg_subscription_write_guard on public.%I', v_spec.tbl);
    EXECUTE format(
      'create trigger trg_subscription_write_guard before insert or update or delete on public.%I '
      || 'for each row execute function public.enforce_company_subscription_write_linked(%s)',
      v_spec.tbl, v_args
    );
    RAISE NOTICE '025: % korundu (baglantilar: %)', v_spec.tbl,
      CASE WHEN cardinality(v_spec.parents) = 0 THEN 'yalnizca company_id' ELSE 'company_id + ' || array_to_string(v_spec.parents, ', ') END;
  END LOOP;
END
$install$;

COMMIT;
