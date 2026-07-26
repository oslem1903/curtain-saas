-- ============================================================================
-- PRODUCTION VERIFICATION: How Are Earnings Actually Created?
-- PURPOSE: Determine real mechanism filling installer_earnings table
-- DATE: 2026-07-11
-- ============================================================================
-- CRITICAL: Triggers NOT FOUND in Query 1-2. Find actual mechanism.
-- ============================================================================


-- ============================================================================
-- QUERY A: Check if installer_earnings table exists and has data
-- ============================================================================
-- Verify table exists and current record count
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = 'installer_earnings';


-- ============================================================================
-- QUERY B: Sample installer_earnings records with metadata
-- ============================================================================
-- What data actually exists? Who created records? When?
SELECT
  id,
  company_id,
  installer_id,
  installation_job_id,
  order_id,
  total_earning,
  earning_type,
  created_by,
  created_at,
  metadata
FROM public.installer_earnings
ORDER BY created_at DESC
LIMIT 30;


-- ============================================================================
-- QUERY C: Check installer_earnings insertion source via metadata
-- ============================================================================
-- Metadata may contain clues about who/what inserted records
SELECT
  COUNT(*) AS total_earnings,
  MAX(created_at) AS most_recent,
  MIN(created_at) AS oldest,
  COUNT(DISTINCT installation_job_id) AS unique_jobs,
  COUNT(DISTINCT installer_id) AS unique_installers
FROM public.installer_earnings;


-- ============================================================================
-- QUERY D: Check installer_transactions table for earning type records
-- ============================================================================
-- How many transaction_type='earning' records exist?
SELECT
  transaction_type,
  COUNT(*) AS record_count,
  SUM(amount) AS total_amount,
  MAX(transaction_date) AS most_recent
FROM public.installer_transactions
GROUP BY transaction_type
ORDER BY record_count DESC;


-- ============================================================================
-- QUERY E: Sample installer_transactions earning records
-- ============================================================================
-- What earning transaction records look like
SELECT
  id,
  company_id,
  installer_id,
  transaction_date,
  transaction_type,
  amount,
  description,
  related_job_id,
  earning_type,
  created_at
FROM public.installer_transactions
WHERE transaction_type = 'earning'
ORDER BY created_at DESC
LIMIT 20;


-- ============================================================================
-- QUERY F: Check for ANY triggers on installation_jobs (all types)
-- ============================================================================
-- Maybe internal triggers exist? Check everything
SELECT
  tg.tgname AS trigger_name,
  tg.tgenabled AS is_enabled,
  tg.tgisinternal AS is_internal,
  tg.tgtype AS trigger_type,
  p.proname AS function_name
FROM pg_trigger tg
LEFT JOIN pg_proc p ON p.oid = tg.tgfoid
JOIN pg_class c ON c.oid = tg.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'installation_jobs'
ORDER BY tg.tgname;


-- ============================================================================
-- QUERY G: Check for ANY functions related to installation completion
-- ============================================================================
-- Search for any function with installation or complete in name
SELECT
  p.proname AS function_name,
  n.nspname AS schema_name,
  p.prokind AS kind,
  p.provolatility AS volatility
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (
    p.proname ILIKE '%installation%'
    OR p.proname ILIKE '%complete%'
    OR p.proname ILIKE '%earning%'
    OR p.proname ILIKE '%commission%'
  )
ORDER BY p.proname;


-- ============================================================================
-- QUERY H: Check installation_jobs with corresponding earnings
-- ============================================================================
-- Do installation_jobs with status=completed have matching installer_earnings?
SELECT
  ij.status,
  COUNT(DISTINCT ij.id) AS job_count,
  COUNT(DISTINCT ie.id) AS earnings_count,
  COUNT(DISTINCT ie.installation_job_id) AS jobs_with_earnings
FROM public.installation_jobs ij
LEFT JOIN public.installer_earnings ie ON ij.id = ie.installation_job_id
GROUP BY ij.status
ORDER BY job_count DESC;


-- ============================================================================
-- QUERY I: Find WHEN installer_earnings records were created vs job completion
-- ============================================================================
-- Do earnings timestamps match job update timestamps?
SELECT
  ij.id AS job_id,
  ij.status,
  ij.updated_at AS job_updated,
  ie.created_at AS earning_created,
  (ie.created_at - ij.updated_at) AS time_delta
FROM public.installation_jobs ij
LEFT JOIN public.installer_earnings ie ON ij.id = ie.installation_job_id
WHERE ij.status IN ('completed', 'installation_completed')
  AND ie.id IS NOT NULL
ORDER BY ij.updated_at DESC
LIMIT 20;


-- ============================================================================
-- QUERY J: Check if installer_earnings created BEFORE job status changed
-- ============================================================================
-- If earnings created before job completion, manual/API insertion not trigger
SELECT
  ij.id AS job_id,
  ij.updated_at AS job_completed_at,
  ie.created_at AS earning_created_at,
  CASE
    WHEN ie.created_at < ij.updated_at THEN 'BEFORE job completion'
    WHEN ie.created_at > ij.updated_at THEN 'AFTER job completion'
    ELSE 'SAME timestamp'
  END AS timing_relationship
FROM public.installation_jobs ij
LEFT JOIN public.installer_earnings ie ON ij.id = ie.installation_job_id
WHERE ij.status IN ('completed', 'installation_completed')
  AND ie.id IS NOT NULL
ORDER BY ij.updated_at DESC
LIMIT 20;


-- ============================================================================
-- QUERY K: List all functions in supabase_installer_commission_triggers.sql
-- ============================================================================
-- What functions exist from the commission triggers migration?
SELECT
  p.proname AS function_name,
  n.nspname AS schema_name,
  pg_get_functiondef(p.oid) LIKE '%installation_job_completed%' AS mentions_job_completed
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'on_installation_job_completed',
    'on_installation_job_deleted',
    'on_installer_payment_created',
    'calculate_commission_for_job',
    'get_installer_cari_summary',
    'get_installer_ledger'
  )
ORDER BY p.proname;


-- ============================================================================
-- QUERY L: Check migration history - were commission triggers deployed?
-- ============================================================================
-- Check if migrations table shows commission trigger migration applied
SELECT
  *
FROM public.schema_migrations
WHERE name ILIKE '%commission%trigger%'
  OR name ILIKE '%installation%trigger%'
ORDER BY executed_at DESC;


-- ============================================================================
-- END OF FILE
-- Purpose: Determine actual mechanism for installer_earnings creation
-- Finding: Triggers NOT FOUND in production
-- ============================================================================
