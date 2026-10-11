-- Salt okunur: 029 sonrasinda policy/RLS kapsamini dogrular.
WITH expected(table_name) AS (
  SELECT unnest(ARRAY[
    'customers','customer_rooms','appointments','measurements','orders','order_items',
    'order_payment_plans','order_installments','quotes','quote_items','products','catalogs',
    'catalog_series','catalog_variants','catalog_code_photos','suppliers','supplier_transactions',
    'supplier_payments','supplier_product_prices','installation_jobs','installer_transactions',
    'installer_earnings','employees','employee_transactions','staff','payments',
    'customer_collections','income','expenses','transactions','invoices','invoice_items',
    'visual_previews','field_info','branches','vehicles','warehouse_items','accounts',
    'appointment_assignees','catalog_collections','catalog_items','expense_categories',
    'income_categories','installer_payments','supplier_work_orders'
  ])
)
SELECT e.table_name, c.relrowsecurity AS rls_enabled,c.relforcerowsecurity AS force_rls_enabled,
       EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public'
         AND p.tablename=e.table_name AND p.policyname='perdepro_subscription_access_029'
         AND p.permissive='RESTRICTIVE' AND 'public'=ANY(p.roles)) AS subscription_policy_installed
FROM expected e
JOIN pg_class c ON c.oid=to_regclass('public.' || e.table_name)
ORDER BY e.table_name;

SELECT p.oid::regprocedure AS function_name, p.prosecdef AS security_definer,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_can_execute
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN (
  'company_subscription_access_allowed','company_subscription_access_snapshot','company_subscription_allows_write',
  'is_company_writable','check_subscription_active','register_device_and_touch_login'
)
ORDER BY p.proname;

SELECT has_function_privilege('authenticated','public.company_subscription_access_allowed(uuid)','EXECUTE') AS authenticated_access_check,
       has_function_privilege('anon','public.company_subscription_access_allowed(uuid)','EXECUTE') AS anonymous_access_check;