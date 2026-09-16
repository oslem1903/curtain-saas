-- =====================================================================
-- supplier_product_prices RLS -> projenin standart yetki modeli
--
-- SORUN: Onceki politika dogrudan company_members.role in ('admin','accountant')
--   yaziyordu ve 'owner' rolunu disarida birakiyordu. Owner kullanicida UPDATE/INSERT
--   0 satir etkiliyor, PostgREST bunu "JSON object requested, multiple (or no)
--   rows returned" seklinde bildiriyordu.
--
-- COZUM: suppliers tablosuyla AYNI yardimci fonksiyonlari kullan:
--   is_super_admin() / is_company_member() / is_company_accounting()
--   / is_company_admin() / is_company_writable()
-- Idempotenttir, tekrar calistirilabilir.
-- =====================================================================

BEGIN;

DROP POLICY IF EXISTS "supplier_product_prices_select_company"      ON public.supplier_product_prices;
DROP POLICY IF EXISTS "supplier_product_prices_write_company_admin" ON public.supplier_product_prices;
DROP POLICY IF EXISTS spp_tenant_select ON public.supplier_product_prices;
DROP POLICY IF EXISTS spp_tenant_insert ON public.supplier_product_prices;
DROP POLICY IF EXISTS spp_tenant_update ON public.supplier_product_prices;
DROP POLICY IF EXISTS spp_tenant_delete ON public.supplier_product_prices;

ALTER TABLE public.supplier_product_prices ENABLE ROW LEVEL SECURITY;

-- SELECT: super admin veya firma uyesi
CREATE POLICY spp_tenant_select ON public.supplier_product_prices
FOR SELECT TO authenticated
USING (public.is_super_admin() OR public.is_company_member(company_id));

-- INSERT: super admin veya (owner/admin/accountant + firma yazilabilir)
CREATE POLICY spp_tenant_insert ON public.supplier_product_prices
FOR INSERT TO authenticated
WITH CHECK (
  public.is_super_admin() OR
  (public.is_company_accounting(company_id) AND public.is_company_writable(company_id))
);

-- UPDATE: super admin veya (owner/admin/accountant + firma yazilabilir)
CREATE POLICY spp_tenant_update ON public.supplier_product_prices
FOR UPDATE TO authenticated
USING (
  public.is_super_admin() OR
  (public.is_company_accounting(company_id) AND public.is_company_writable(company_id))
)
WITH CHECK (
  public.is_super_admin() OR
  (public.is_company_accounting(company_id) AND public.is_company_writable(company_id))
);

-- DELETE: super admin veya (owner/admin + firma yazilabilir)
CREATE POLICY spp_tenant_delete ON public.supplier_product_prices
FOR DELETE TO authenticated
USING (
  public.is_super_admin() OR
  (public.is_company_admin(company_id) AND public.is_company_writable(company_id))
);

COMMIT;

NOTIFY pgrst, 'reload schema';

-- Dogrulama: 4 politika listelenmeli
SELECT policyname, cmd
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'supplier_product_prices'
 ORDER BY cmd;
