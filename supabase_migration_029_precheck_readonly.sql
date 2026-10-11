-- Salt okunur: migration 029'un bekledigi subscription/RLS tablolari ve
-- restrictive policy eklenmesine engel olabilecek sema durumlarini raporlar.
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
SELECT e.table_name,
       (c.oid IS NOT NULL) AS table_exists,
      coalesce(c.relrowsecurity, false) AS rls_enabled,
      coalesce(c.relforcerowsecurity, false) AS force_rls_already_enabled,
       a.atttypid = 'uuid'::regtype AS company_id_is_uuid,
       EXISTS (SELECT 1 FROM pg_policies p
               WHERE p.schemaname='public' AND p.tablename=e.table_name) AS has_existing_policies
FROM expected e
LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || e.table_name)
LEFT JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='company_id' AND NOT a.attisdropped
ORDER BY e.table_name;

-- Tum company_id'li public tablolar: 029 listesinde bulunmayanlari elle inceleyin.
SELECT c.relname AS table_name,c.relrowsecurity AS rls_enabled,a.atttypid::regtype AS company_id_type,
       EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=c.relname
         AND p.policyname='perdepro_subscription_access_029') AS subscription_policy_installed
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
JOIN pg_attribute a ON a.attrelid=c.oid AND a.attname='company_id' AND NOT a.attisdropped
WHERE n.nspname='public' AND c.relkind IN ('r','p')
ORDER BY c.relname;

SELECT p.oid::regprocedure AS function_name, p.prosecdef AS security_definer
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN (
  'company_subscription_access_allowed','company_subscription_access_snapshot',
  'company_subscription_allows_write','is_company_writable',
  'check_subscription_active','register_device_and_touch_login',
  'is_super_admin','is_company_member'
)
ORDER BY p.proname;