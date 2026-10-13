-- SALT OKUNUR. Migration 029/029a oncesi canli durumu tek hucrede raporlar (hicbir sey degistirmez).
-- Repo tanimlariyla karsilastirma icin: node scripts/function-body-hashes.mjs
-- Normalizasyon repo betigiyle AYNI: btrim(regexp_replace(prosrc, '\s+', ' ', 'g')).
WITH
fn AS (
  SELECT 1 AS o,
         'FUNC ' || p.oid::regprocedure::text
         || ' | secdef=' || p.prosecdef::text
         || ' | config=' || coalesce(array_to_string(p.proconfig, ','), '-')
         || ' | md5=' || md5(btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g')))
         || ' | len=' || length(btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g'))) AS t
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname IN (
    'is_company_writable','check_subscription_active','company_subscription_allows_write',
    'company_subscription_access_allowed','company_subscription_access_snapshot',
    'register_device_and_touch_login','enforce_company_subscription_write','is_super_admin','is_company_member')
),
guard AS (
  SELECT 2 AS o, 'WRITE_GUARD_TRIGGER ' || c.relname || ' -> ' || t.tgname AS t
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE NOT t.tgisinternal AND p.proname = 'enforce_company_subscription_write'
),
pol AS (
  SELECT 3 AS o, 'POLICY_029_INSTALLED tables=' || count(*) AS t FROM pg_policies
  WHERE schemaname = 'public' AND policyname = 'perdepro_subscription_access_029'
),
pre AS (
  SELECT 4 AS o, 'PRECHECK ' || x.name || ' ' || x.status AS t FROM (
    SELECT e.t AS name,
      CASE WHEN c.oid IS NULL THEN 'MISSING_TABLE'
           WHEN NOT c.relrowsecurity THEN 'RLS_OFF'
           WHEN c.relforcerowsecurity THEN 'FORCE_RLS_ALREADY'
           WHEN a.atttypid IS DISTINCT FROM 'uuid'::regtype THEN 'COMPANY_ID_NOT_UUID'
           ELSE 'ok' END AS status
    FROM unnest(ARRAY[
      'customers','customer_rooms','appointments','measurements','orders','order_items',
      'order_payment_plans','order_installments','quotes','quote_items','products','catalogs',
      'catalog_series','catalog_variants','catalog_code_photos','suppliers','supplier_transactions',
      'supplier_payments','supplier_product_prices','installation_jobs','installer_transactions',
      'installer_earnings','employees','employee_transactions','staff','payments',
      'customer_collections','income','expenses','transactions','invoices','invoice_items',
      'visual_previews','field_info','branches','vehicles','warehouse_items','accounts',
      'appointment_assignees','catalog_collections','catalog_items','expense_categories',
      'income_categories','installer_payments','supplier_work_orders']) AS e(t)
    LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || e.t)
    LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'company_id' AND NOT a.attisdropped
  ) x WHERE x.status <> 'ok'
),
co AS (
  SELECT 5 AS o,
    'COMPANY #' || row_number() OVER (ORDER BY c.created_at)
    || CASE WHEN c.name ~* '^(apple test|test company)' THEN ' (' || c.name || ')' ELSE '' END
    || ' | plan=' || coalesce(c.plan_status,'-')
    || ' | pilot=' || coalesce(c.is_pilot,false)::text || ' until=' || coalesce(c.pilot_until::text,'-')
    || ' | trial_ends=' || coalesce(c.trial_ends_at::text,'-')
    || ' | license_ends=' || coalesce(c.license_expires_at::text,'-')
    || ' | active=' || coalesce(c.is_active,true)::text || ' read_only=' || coalesce(c.read_only,false)::text
    || ' | WOULD_ALLOW_029=' || (
         coalesce(c.is_active,true) AND lower(coalesce(c.plan_status,'')) <> 'suspended' AND (
           (coalesce(c.is_pilot,false) AND (c.pilot_until IS NULL OR c.pilot_until > now()))
           OR CASE lower(coalesce(c.plan_status,''))
                WHEN 'expired' THEN false WHEN 'lifetime' THEN true
                WHEN 'active' THEN c.license_expires_at IS NULL OR c.license_expires_at > now()
                ELSE c.trial_ends_at IS NOT NULL AND c.trial_ends_at > now() END))::text AS t
  FROM public.companies c
),
r AS (
  SELECT * FROM fn UNION ALL SELECT * FROM guard UNION ALL SELECT * FROM pol
  UNION ALL SELECT * FROM pre UNION ALL SELECT * FROM co
)
SELECT string_agg(t, E'\n' ORDER BY o, t) AS rapor FROM r;
