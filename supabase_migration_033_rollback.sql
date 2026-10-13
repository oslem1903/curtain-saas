-- Geri alma: migration 033 (Solo satin alma cekirdegi + modul korumasi).
-- UYARI: billing_* tablolarindaki odeme kayitlari SILINIR. Odeme alinmis ise once disa aktarin.
BEGIN;
DO $m$
DECLARE r record;
BEGIN
  FOR r IN SELECT unnest(ARRAY['invoices','invoice_items','catalog_series','catalog_variants','branches','vehicles','warehouse_items']) AS tbl LOOP
    IF to_regclass('public.' || r.tbl) IS NOT NULL THEN
      EXECUTE format('drop policy if exists perdepro_module_gate on public.%I', r.tbl);
      EXECUTE format('drop trigger if exists trg_module_write_guard on public.%I', r.tbl);
    END IF;
  END LOOP;
END $m$;
DROP FUNCTION IF EXISTS public.enforce_company_module_write();
DROP FUNCTION IF EXISTS public.company_has_module(uuid, text);
DROP FUNCTION IF EXISTS public.billing_is_test_company(uuid);
DROP FUNCTION IF EXISTS public.billing_mark_intent(uuid, text);
DROP FUNCTION IF EXISTS public.billing_set_intent_token(uuid, text);
DROP FUNCTION IF EXISTS public.billing_get_intent(uuid);
DROP FUNCTION IF EXISTS public.billing_create_intent(text, uuid, text, uuid);
DROP FUNCTION IF EXISTS public.billing_record_failure(text, text, uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.billing_apply_charge(text, text, uuid, text, text, integer, text, text, jsonb, boolean);
DROP TABLE IF EXISTS public.module_enforcement, public.billing_test_companies, public.billing_intents, public.billing_payments,
  public.billing_events, public.billing_subscriptions, public.billing_plans;
NOTIFY pgrst, 'reload schema';
COMMIT;
