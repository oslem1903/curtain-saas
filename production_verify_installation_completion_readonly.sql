-- ============================================================================
-- PRODUCTION VERIFICATION: Installation Job Completion Workflow
-- PURPOSE: Read-only diagnostics for montaj tamamlama feature atomicity
-- DATE: 2026-07-11
-- ============================================================================
-- This file contains ONLY SELECT queries. Zero data modification.
-- Safe to run in production SQL Editor.
-- ============================================================================


-- ============================================================================
-- QUERY 1: installation_jobs table triggers
-- ============================================================================
-- Find all active custom triggers on installation_jobs table
SELECT
  tg.tgname AS trigger_name,
  tg.tgenabled AS is_enabled,
  p.proname AS function_name,
  pg_get_triggerdef(tg.oid) AS trigger_definition
FROM pg_trigger tg
JOIN pg_proc p ON p.oid = tg.tgfoid
JOIN pg_class c ON c.oid = tg.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'installation_jobs'
  AND NOT tg.tgisinternal
ORDER BY tg.tgname;


-- ============================================================================
-- QUERY 2: on_installation_job_completed() function definition
-- ============================================================================
-- Get full function definition to verify production state
SELECT
  p.proname AS function_name,
  n.nspname AS schema_name,
  pg_get_functiondef(p.oid) AS full_function_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'on_installation_job_completed'
LIMIT 1;


-- ============================================================================
-- QUERY 3: Extract expected status value from trigger function
-- ============================================================================
-- Parse function definition to identify status check value
SELECT
  p.proname AS function_name,
  CASE
    WHEN pg_get_functiondef(p.oid) LIKE '%installation_completed%'
      THEN 'installation_completed'
    WHEN pg_get_functiondef(p.oid) LIKE '%''completed''%'
      THEN 'completed'
    ELSE 'UNKNOWN'
  END AS expected_status_value
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'on_installation_job_completed';


-- ============================================================================
-- QUERY 4: installation_jobs.status column definition
-- ============================================================================
-- Verify column type and nullability
SELECT
  attr.attname AS column_name,
  t.typname AS data_type,
  NOT attr.attnotnull AS is_nullable,
  pg_get_expr(ad.adbin, ad.adrelid) AS column_default
FROM pg_attribute attr
JOIN pg_class cls ON cls.oid = attr.attrelid
JOIN pg_namespace ns ON ns.oid = cls.relnamespace
JOIN pg_type t ON t.oid = attr.atttypid
LEFT JOIN pg_attrdef ad ON ad.adrelid = attr.attrelid AND ad.adnum = attr.attnum
WHERE ns.nspname = 'public'
  AND cls.relname = 'installation_jobs'
  AND attr.attname = 'status'
  AND attr.attnum > 0;


-- ============================================================================
-- QUERY 5: installation_jobs.status CHECK constraints
-- ============================================================================
-- Find CHECK constraints on status column using pg_catalog
SELECT
  conname AS constraint_name,
  pg_get_constraintdef(con.oid) AS constraint_definition
FROM pg_constraint con
JOIN pg_class cls ON cls.oid = con.conrelid
JOIN pg_namespace ns ON ns.oid = cls.relnamespace
WHERE ns.nspname = 'public'
  AND cls.relname = 'installation_jobs'
  AND con.contype = 'c'
ORDER BY conname;


-- ============================================================================
-- QUERY 6: installation_jobs current distinct status values
-- ============================================================================
-- What status values actually exist in production?
SELECT
  status,
  COUNT(*) AS record_count,
  MIN(created_at) AS first_seen,
  MAX(updated_at) AS last_updated
FROM public.installation_jobs
GROUP BY status
ORDER BY record_count DESC;


-- ============================================================================
-- QUERY 7: orders.status column definition
-- ============================================================================
-- Verify orders status column type and nullability
SELECT
  attr.attname AS column_name,
  t.typname AS data_type,
  NOT attr.attnotnull AS is_nullable,
  pg_get_expr(ad.adbin, ad.adrelid) AS column_default
FROM pg_attribute attr
JOIN pg_class cls ON cls.oid = attr.attrelid
JOIN pg_namespace ns ON ns.oid = cls.relnamespace
JOIN pg_type t ON t.oid = attr.atttypid
LEFT JOIN pg_attrdef ad ON ad.adrelid = attr.attrelid AND ad.adnum = attr.attnum
WHERE ns.nspname = 'public'
  AND cls.relname = 'orders'
  AND attr.attname = 'status'
  AND attr.attnum > 0;


-- ============================================================================
-- QUERY 8: orders.status CHECK constraints
-- ============================================================================
-- Find CHECK constraints on orders.status
SELECT
  conname AS constraint_name,
  pg_get_constraintdef(con.oid) AS constraint_definition
FROM pg_constraint con
JOIN pg_class cls ON cls.oid = con.conrelid
JOIN pg_namespace ns ON ns.oid = cls.relnamespace
WHERE ns.nspname = 'public'
  AND cls.relname = 'orders'
  AND con.contype = 'c'
ORDER BY conname;


-- ============================================================================
-- QUERY 9: orders current distinct status values
-- ============================================================================
-- What order status values exist in production?
SELECT
  status,
  COUNT(*) AS record_count,
  MIN(created_at) AS first_seen,
  MAX(updated_at) AS last_updated
FROM public.orders
GROUP BY status
ORDER BY record_count DESC;


-- ============================================================================
-- QUERY 10: Recent installation jobs with earnings cross-check
-- ============================================================================
-- Recent completions with earning record status
SELECT
  ij.id AS job_id,
  ij.order_id,
  ij.company_id,
  ij.status AS job_status,
  ij.assigned_staff_id,
  o.status AS order_status,
  ie.id AS earning_id,
  ie.total_earning,
  ie.earning_type,
  ij.updated_at,
  ie.created_at AS earning_created_at
FROM public.installation_jobs ij
LEFT JOIN public.orders o ON ij.order_id = o.id
LEFT JOIN public.installer_earnings ie ON ij.id = ie.installation_job_id
ORDER BY ij.updated_at DESC
LIMIT 20;


-- ============================================================================
-- QUERY 11: Completed jobs missing earnings (trigger failure detection)
-- ============================================================================
-- Find jobs marked completed but no earning record exists
SELECT
  ij.id AS job_id,
  ij.order_id,
  ij.company_id,
  ij.status,
  ij.assigned_staff_id,
  ij.updated_at,
  COUNT(ie.id) AS earning_count
FROM public.installation_jobs ij
LEFT JOIN public.installer_earnings ie ON ij.id = ie.installation_job_id
WHERE ij.status IN ('completed', 'installation_completed')
GROUP BY ij.id, ij.order_id, ij.company_id, ij.status, ij.assigned_staff_id, ij.updated_at
HAVING COUNT(ie.id) = 0
ORDER BY ij.updated_at DESC;


-- ============================================================================
-- QUERY 12: Duplicate earnings for same job (data integrity check)
-- ============================================================================
-- Verify trigger's double-create prevention works
SELECT
  installation_job_id,
  COUNT(*) AS earning_count,
  STRING_AGG(id::text, ', ') AS earning_ids
FROM public.installer_earnings
WHERE installation_job_id IS NOT NULL
GROUP BY installation_job_id
HAVING COUNT(*) > 1
ORDER BY earning_count DESC;


-- ============================================================================
-- QUERY 13: Completed jobs without installer assigned
-- ============================================================================
-- Check behavior when trigger has null installer_id
SELECT
  ij.id AS job_id,
  ij.order_id,
  ij.company_id,
  ij.status,
  ij.assigned_staff_id,
  ij.updated_at,
  COUNT(ie.id) AS earning_count
FROM public.installation_jobs ij
LEFT JOIN public.installer_earnings ie ON ij.id = ie.installation_job_id
WHERE ij.status IN ('completed', 'installation_completed')
  AND ij.assigned_staff_id IS NULL
GROUP BY ij.id, ij.order_id, ij.company_id, ij.status, ij.assigned_staff_id, ij.updated_at
ORDER BY ij.updated_at DESC;


-- ============================================================================
-- QUERY 14: Manual commission type completions and earnings
-- ============================================================================
-- Verify manual commission jobs completed with zero earnings
SELECT
  ij.id AS job_id,
  ij.order_id,
  ij.status,
  e.commission_type,
  ie.total_earning,
  ie.earning_type,
  ie.manual_earning,
  ij.updated_at
FROM public.installation_jobs ij
LEFT JOIN public.employees e ON ij.assigned_staff_id = e.id
LEFT JOIN public.installer_earnings ie ON ij.id = ie.installation_job_id
WHERE ij.status IN ('completed', 'installation_completed')
  AND e.commission_type = 'manual'
ORDER BY ij.updated_at DESC
LIMIT 20;


-- ============================================================================
-- QUERY 15: Check for existing complete_installation RPC functions
-- ============================================================================
-- Verify no conflicting completion RPC already exists
SELECT
  p.proname AS function_name,
  n.nspname AS schema_name,
  pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (
    p.proname LIKE '%complete%installation%'
    OR p.proname LIKE '%finish%installation%'
    OR p.proname LIKE '%installation%complete%'
  )
ORDER BY p.proname;


-- ============================================================================
-- END OF FILE
-- This file contains ONLY READ-ONLY SELECT queries.
-- Zero data modification. Safe for production.
-- ============================================================================
