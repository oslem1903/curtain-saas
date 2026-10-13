-- =============================================================================
-- Migration 036: test firmasi icin kapali plan uzerinden ODEME NIYETI
--
--   * billing_create_intent: plan aktif VE (is_purchasable VEYA firma billing_test_companies'te).
--     Herkese acik satin alma (is_purchasable) kapali kalirken yalniz isaretli test firmasi
--     PayTR TEST modunda odeme baslatabilir.
--   * billing_test_companies: kendi firmasinin yoneticisi satirini OKUYABILIR (istemci "Test odemesine
--     gec" dugmesini gostersin diye). Yazma yalniz service_role/SQL.
-- ONKOSUL: 033, 034.   GERI ALMA: supabase_migration_036_rollback.sql
-- =============================================================================
BEGIN;

CREATE OR REPLACE FUNCTION public.billing_create_intent(p_channel text, p_company_id uuid, p_plan_code text, p_created_by uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_plan public.billing_plans%ROWTYPE; v_id uuid; v_test boolean;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: yalnizca sunucu cagrisi'; END IF;
  SELECT EXISTS (SELECT 1 FROM public.billing_test_companies t WHERE t.company_id = p_company_id) INTO v_test;
  SELECT * INTO v_plan FROM public.billing_plans
   WHERE code = p_plan_code AND is_active AND (is_purchasable OR v_test);
  IF NOT FOUND THEN RAISE EXCEPTION 'PERDEPRO_NOT_FOUND: plan'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id) THEN RAISE EXCEPTION 'PERDEPRO_NOT_FOUND: firma'; END IF;
  INSERT INTO public.billing_intents(company_id, plan_code, channel, amount_minor, currency, created_by)
  VALUES (p_company_id, p_plan_code, p_channel, v_plan.price_minor, v_plan.currency, p_created_by) RETURNING id INTO v_id;
  RETURN jsonb_build_object('intent_id', v_id, 'amount_minor', v_plan.price_minor, 'currency', v_plan.currency, 'plan_name', v_plan.name);
END
$fn$;
REVOKE ALL ON FUNCTION public.billing_create_intent(text,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_create_intent(text,uuid,text,uuid) TO service_role;

DROP POLICY IF EXISTS billing_test_companies_read ON public.billing_test_companies;
CREATE POLICY billing_test_companies_read ON public.billing_test_companies FOR SELECT TO authenticated
  USING (public.is_company_admin(company_id));
GRANT SELECT ON public.billing_test_companies TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
