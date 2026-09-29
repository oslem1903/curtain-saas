-- ============================================================
-- Migration 020: supplier_transactions -- Super Admin "İşlem Modu" yazma izni
-- PRODUCTION'da elle çalıştırın. Eklemeli: mevcut politikalar KALIR (permissive politikalar
-- OR'lanır), yalnızca super admin için ek INSERT/UPDATE yolu açılır.
--
-- Bulgu: Super admin işlem modunda QA tedarikçisine borç insert'i
--   "new row violates row-level security policy for table supplier_transactions" (42501)
--   ile reddedildi (canlıda tekrarlandı). Normal firma kullanıcılarının yolu değişmez;
--   company_id izolasyonu: yalnızca is_super_admin() true ise ek yetki verilir.
-- ============================================================

ALTER TABLE public.supplier_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS supplier_transactions_super_admin_insert ON public.supplier_transactions;
CREATE POLICY supplier_transactions_super_admin_insert ON public.supplier_transactions
  FOR INSERT TO authenticated
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS supplier_transactions_super_admin_update ON public.supplier_transactions;
CREATE POLICY supplier_transactions_super_admin_update ON public.supplier_transactions
  FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

GRANT SELECT, INSERT, UPDATE ON public.supplier_transactions TO authenticated;

-- DOĞRULAMA: SELECT policyname, cmd, roles, qual, with_check FROM pg_policies
--   WHERE tablename = 'supplier_transactions' ORDER BY policyname;
-- Tetikleyiciler:
--   SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
--   WHERE tgrelid='public.supplier_transactions'::regclass AND NOT tgisinternal;
-- Not: Uygulamadan sonra hâlâ 42501 alınırsa sorun politika değil bir tetikleyici / başka tabloya
-- yazan fonksiyon olabilir; yukarıdaki iki sorgunun çıktısını paylaşın.
