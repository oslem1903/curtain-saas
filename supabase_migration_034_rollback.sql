-- Geri alma: 034. billing_create_intent 033 surumune doner; plan satirlari silinir (odeme kaydi yoksa).
BEGIN;
DELETE FROM public.billing_plans WHERE code IN ('solo_monthly','solo_yearly')
  AND NOT EXISTS (SELECT 1 FROM public.billing_intents i WHERE i.plan_code = billing_plans.code)
  AND NOT EXISTS (SELECT 1 FROM public.billing_subscriptions s WHERE s.plan_code = billing_plans.code);
CREATE OR REPLACE FUNCTION public.billing_create_intent(p_channel text, p_company_id uuid, p_plan_code text, p_created_by uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_plan public.billing_plans%ROWTYPE; v_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: yalnizca sunucu cagrisi'; END IF;
  SELECT * INTO v_plan FROM public.billing_plans WHERE code = p_plan_code AND is_active;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERDEPRO_NOT_FOUND: plan'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id) THEN RAISE EXCEPTION 'PERDEPRO_NOT_FOUND: firma'; END IF;
  INSERT INTO public.billing_intents(company_id, plan_code, channel, amount_minor, currency, created_by)
  VALUES (p_company_id, p_plan_code, p_channel, v_plan.price_minor, v_plan.currency, p_created_by) RETURNING id INTO v_id;
  RETURN jsonb_build_object('intent_id', v_id, 'amount_minor', v_plan.price_minor, 'currency', v_plan.currency, 'plan_name', v_plan.name);
END
$fn$;
ALTER TABLE public.billing_plans DROP COLUMN IF EXISTS is_purchasable, DROP COLUMN IF EXISTS sort_order;
COMMIT;
