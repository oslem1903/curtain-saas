-- ============================================================================
-- PRODUCTION VERIFICATION: Minimal Safe Query Set
-- PURPOSE: Determine earnings table existence and trigger mechanism
-- DATE: 2026-07-11
-- SAFETY: No column assumptions. Schema validation first.
-- ============================================================================
-- ONLY SELECT queries. Safe to run in production SQL Editor.
-- ============================================================================


-- ============================================================================
-- PHASE 1: TABLE EXISTENCE VERIFICATION
-- ============================================================================

-- Query A1: Check if installer_earnings table exists
SELECT
  schemaname,
  tablename,
  rowsecurity AS has_rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'installer_earnings';


-- Query A2: Check if installer_transactions table exists
SELECT
  schemaname,
  tablename,
  rowsecurity AS has_rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'installer_transactions';


-- Query A3: Verify installation_jobs table exists
SELECT
  schemaname,
  tablename,
  rowsecurity AS has_rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'installation_jobs';


-- ============================================================================
-- PHASE 2: COLUMN VALIDATION (Safe - Information Schema)
-- ============================================================================

-- Query B1: Verify installer_earnings columns (safely via information_schema)
-- Do NOT assume: created_by, metadata, or any columns exist
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'installer_earnings'
ORDER BY ordinal_position;


-- Query B2: Verify installation_jobs columns
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'installation_jobs'
ORDER BY ordinal_position;


-- Query B3: Verify orders columns
SELECT
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'orders'
ORDER BY ordinal_position;


-- ============================================================================
-- PHASE 3: TRIGGER VERIFICATION (No Assumptions)
-- ============================================================================

-- Query C1: Check for ANY triggers on installation_jobs table
SELECT
  tg.tgname AS trigger_name,
  tg.tgenabled AS is_enabled,
  tg.tgisinternal AS is_internal,
  p.proname AS function_name
FROM pg_trigger tg
LEFT JOIN pg_proc p ON p.oid = tg.tgfoid
JOIN pg_class c ON c.oid = tg.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'installation_jobs'
ORDER BY tg.tgname;


-- Query C2: Count of triggers on installation_jobs
SELECT
  COUNT(*) AS trigger_count
FROM pg_trigger tg
JOIN pg_class c ON c.oid = tg.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'installation_jobs'
  AND NOT tg.tgisinternal;


-- ============================================================================
-- PHASE 4: RELATED FUNCTIONS SEARCH (Safe - No Assumptions)
-- ============================================================================

-- Query D1: All functions mentioning 'installation' in name
SELECT
  p.proname AS function_name,
  n.nspname AS schema_name,
  p.prokind AS function_type,
  p.provolatility AS volatility
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname ILIKE '%installation%'
ORDER BY p.proname;


-- Query D2: All functions mentioning 'complete' or 'completion' in name
SELECT
  p.proname AS function_name,
  n.nspname AS schema_name,
  p.prokind AS function_type,
  p.provolatility AS volatility
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (p.proname ILIKE '%complete%' OR p.proname ILIKE '%completion%')
ORDER BY p.proname;


-- Query D3: All functions mentioning 'earning' in name
SELECT
  p.proname AS function_name,
  n.nspname AS schema_name,
  p.prokind AS function_type,
  p.provolatility AS volatility
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname ILIKE '%earning%'
ORDER BY p.proname;


-- Query D4: All functions mentioning 'commission' in name
SELECT
  p.proname AS function_name,
  n.nspname AS schema_name,
  p.prokind AS function_type,
  p.provolatility AS volatility
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname ILIKE '%commission%'
ORDER BY p.proname;


-- ============================================================================
-- PHASE 5: DATA EXISTENCE CHECKS (Safe - Table existence verified in A1/A2/A3)
-- ============================================================================

-- Query E1: If installer_earnings table exists, show record count
SELECT
  COUNT(*) AS total_installer_earnings_records
FROM public.installer_earnings
WHERE to_regclass('public.installer_earnings') IS NOT NULL;


-- Query E2: If installer_earnings table exists, show by earning_type distribution
SELECT
  earning_type,
  COUNT(*) AS record_count
FROM public.installer_earnings
GROUP BY earning_type
ORDER BY record_count DESC;


-- Query E3: If installer_transactions table exists, show transaction_type distribution
SELECT
  transaction_type,
  COUNT(*) AS record_count
FROM public.installer_transactions
GROUP BY transaction_type
ORDER BY record_count DESC;


-- ============================================================================
-- PHASE 6: INSTALLATION_JOBS STATUS VERIFICATION
-- ============================================================================

-- Query F1: Current distinct status values in installation_jobs
SELECT
  status,
  COUNT(*) AS job_count
FROM public.installation_jobs
GROUP BY status
ORDER BY job_count DESC;


-- Query F2: Jobs marked completed/installation_completed vs earnings
-- Safe version: COUNT aggregate, no column assumptions
SELECT
  COALESCE(ij.status, 'NO_JOBS') AS job_status,
  COUNT(DISTINCT ij.id) AS total_jobs,
  COUNT(DISTINCT ie.id) AS jobs_with_earnings,
  COUNT(DISTINCT ij.id) - COUNT(DISTINCT ie.id) AS jobs_without_earnings
FROM public.installation_jobs ij
LEFT JOIN public.installer_earnings ie ON ij.id = ie.installation_job_id
WHERE ij.status IN ('completed', 'installation_completed')
GROUP BY ij.status;


-- ============================================================================
-- PHASE 7: MIGRATION HISTORY CHECK (Safe - Table existence check)
-- ============================================================================

-- Query G1: Check if schema_migrations table exists
SELECT
  to_regclass('public.schema_migrations') AS migration_table_exists;


-- Query G2: If schema_migrations exists, check for commission/trigger migrations
-- This query only runs if table exists (UNION will return empty if table missing)
SELECT
  *
FROM (
  SELECT
    'schema_migrations exists' AS status,
    COUNT(*) AS migration_record_count
  FROM public.schema_migrations
  WHERE to_regclass('public.schema_migrations') IS NOT NULL
    AND name ILIKE '%commission%'
    OR name ILIKE '%trigger%'
) subq
UNION ALL
SELECT
  'schema_migrations NOT FOUND' AS status,
  0 AS migration_record_count
WHERE to_regclass('public.schema_migrations') IS NULL;


-- ============================================================================
-- PHASE 8: EXPECTED FUNCTIONS EXISTENCE
-- ============================================================================

-- Query H1: Check for specific expected functions from commission_triggers.sql
SELECT
  p.proname,
  CASE
    WHEN p.proname = 'on_installation_job_completed' THEN 'Trigger function (expected if triggers work)'
    WHEN p.proname = 'calculate_commission_for_job' THEN 'Commission calculator'
    WHEN p.proname = 'get_installer_cari_summary' THEN 'Earnings summary'
    WHEN p.proname = 'get_installer_ledger' THEN 'Transaction ledger'
    ELSE 'Other function'
  END AS function_purpose
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'on_installation_job_completed',
    'on_installation_job_deleted',
    'calculate_commission_for_job',
    'get_installer_cari_summary',
    'get_installer_ledger'
  )
ORDER BY p.proname;


-- ============================================================================
-- END OF MINIMAL SAFE QUERY SET
-- ============================================================================
-- Results will show:
-- 1. Whether tables exist
-- 2. What columns actually exist (no assumptions)
-- 3. Whether triggers exist on installation_jobs
-- 4. What related functions exist
-- 5. How many records in earnings/transactions
-- 6. Whether migration history is available
-- 7. Whether expected commission functions exist
-- ============================================================================
