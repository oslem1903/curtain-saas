-- ============================================================================
-- PRODUCTION VERIFICATION: Earnings Mechanism - Final Minimal Query Set
-- PURPOSE: Determine how installer_earnings is created (trigger, API, manual)
-- DATE: 2026-07-11
-- SAFETY: 6 straightforward SELECT queries. Read-only only.
-- ============================================================================


-- ============================================================================
-- QUERY 1: installer_earnings table existence and total record count
-- ============================================================================
SELECT
  'installer_earnings' AS table_name,
  COUNT(*) AS total_records
FROM public.installer_earnings;


-- ============================================================================
-- QUERY 2: installer_transactions breakdown by transaction_type
-- ============================================================================
SELECT
  transaction_type,
  COUNT(*) AS record_count
FROM public.installer_transactions
GROUP BY transaction_type
ORDER BY record_count DESC;


-- ============================================================================
-- QUERY 3: All custom triggers on installation_jobs table
-- ============================================================================
SELECT
  tg.tgname AS trigger_name,
  tg.tgenabled AS is_enabled,
  p.proname AS function_name
FROM pg_trigger tg
LEFT JOIN pg_proc p ON p.oid = tg.tgfoid
JOIN pg_class c ON c.oid = tg.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'installation_jobs'
  AND NOT tg.tgisinternal
ORDER BY tg.tgname;


-- ============================================================================
-- QUERY 4: All public functions related to installation/earning/commission
-- ============================================================================
SELECT
  p.proname AS function_name,
  p.prokind AS function_type
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (
    p.proname ILIKE '%installation%'
    OR p.proname ILIKE '%earning%'
    OR p.proname ILIKE '%commission%'
  )
ORDER BY p.proname;


-- ============================================================================
-- QUERY 5: installation_jobs status vs corresponding installer_earnings
-- ============================================================================
SELECT
  ij.status,
  COUNT(DISTINCT ij.id) AS total_jobs,
  COUNT(DISTINCT ie.id) AS jobs_with_earnings
FROM public.installation_jobs ij
LEFT JOIN public.installer_earnings ie ON ij.id = ie.installation_job_id
GROUP BY ij.status
ORDER BY total_jobs DESC;


-- ============================================================================
-- QUERY 6: Specific expected functions from commission_triggers migration
-- ============================================================================
SELECT
  expected_function,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = functions.expected_function
  ) THEN 'EXISTS' ELSE 'NOT FOUND' END AS status
FROM (
  VALUES
    ('on_installation_job_completed'),
    ('on_installation_job_deleted'),
    ('calculate_commission_for_job'),
    ('get_installer_cari_summary'),
    ('get_installer_ledger')
) functions(expected_function)
ORDER BY expected_function;


-- ============================================================================
-- END OF FINAL QUERY SET
-- ============================================================================
-- Run all 6 queries in Supabase SQL Editor
-- Results will show:
-- 1. How many installer_earnings records exist
-- 2. Breakdown of installer_transactions by type
-- 3. Triggers on installation_jobs (empty = no triggers in production)
-- 4. Available commission/installation/earning functions
-- 5. Correlation between job status and earnings records
-- 6. Which of the 5 expected functions actually exist in production
-- ============================================================================
