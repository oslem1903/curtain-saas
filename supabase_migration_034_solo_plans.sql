-- =============================================================================
-- Migration 034: Solo plan fiyatlari (onayli) + "satin almaya acik" sunucu anahtari
--
--   * billing_plans.is_purchasable (varsayilan false): fiyat gosterilebilir, ODEME ALMA
--     ayri ve sunucu tarafli bir anahtardir. billing_create_intent yalnizca
--     is_purchasable=true planlar icin niyet olusturur; PayTR test modunda dogrulanip
--     acikca true yapilana kadar hicbir istemci odeme baslatamaz.
--   * Onayli Solo fiyatlari (KDV dahil, TRY): 1 aylik 499 TL, 1 yillik 4.990 TL.
--     Otomatik yenileme yok; tek seferlik donem satin alma.
--   * Normal fiyat / kampanya bitis tarihi ONAYLI DEGILDIR; bu tabloda tutulmaz.
-- ONKOSUL: migration 033.   GERI ALMA: supabase_migration_034_rollback.sql
-- =============================================================================
BEGIN;

ALTER TABLE public.billing_plans ADD COLUMN IF NOT EXISTS is_purchasable boolean NOT NULL DEFAULT false;
ALTER TABLE public.billing_plans ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.billing_create_intent(p_channel text, p_company_id uuid, p_plan_code text, p_created_by uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
DECLARE v_plan public.billing_plans%ROWTYPE; v_id uuid;
BEGIN
  IF auth.uid() IS NOT NULL THEN RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: yalnizca sunucu cagrisi'; END IF;
  SELECT * INTO v_plan FROM public.billing_plans WHERE code = p_plan_code AND is_active AND is_purchasable;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERDEPRO_NOT_FOUND: plan'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id) THEN RAISE EXCEPTION 'PERDEPRO_NOT_FOUND: firma'; END IF;
  INSERT INTO public.billing_intents(company_id, plan_code, channel, amount_minor, currency, created_by)
  VALUES (p_company_id, p_plan_code, p_channel, v_plan.price_minor, v_plan.currency, p_created_by) RETURNING id INTO v_id;
  RETURN jsonb_build_object('intent_id', v_id, 'amount_minor', v_plan.price_minor, 'currency', v_plan.currency, 'plan_name', v_plan.name);
END
$fn$;
REVOKE ALL ON FUNCTION public.billing_create_intent(text,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_create_intent(text,uuid,text,uuid) TO service_role;

INSERT INTO public.billing_plans (code, name, period, price_minor, currency, package_code, is_active, is_purchasable, sort_order)
VALUES
  ('solo_monthly', 'PerdePRO Solo — 1 Aylık Kullanım', 'month',  49900, 'TRY', 'solo', true, false, 1),
  ('solo_yearly',  'PerdePRO Solo — 1 Yıllık Kullanım', 'year', 499000, 'TRY', 'solo', true, false, 2)
ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name, period = EXCLUDED.period, price_minor = EXCLUDED.price_minor,
      currency = EXCLUDED.currency, package_code = EXCLUDED.package_code, sort_order = EXCLUDED.sort_order;

NOTIFY pgrst, 'reload schema';
COMMIT;
