-- ============================================================================
-- PRODUCTION VERIFICATION: Current Earnings State (READ-ONLY)
-- FILE: production_verify_current_state_readonly.sql
-- DATE: 2026-07-13
-- PURPOSE: Establish ground truth about which tables store/calculate earnings
-- SAFE: SELECT queries only, no modifications
-- ============================================================================

-- ============================================================================
-- 1. INSTALLER_EARNINGS TOPLAM KAYIT SAYISI
-- ============================================================================
SELECT
    'CONTROL_1_earnings_count' AS check_id,
    COUNT(*) AS total_records,
    COUNT(DISTINCT company_id) AS distinct_companies,
    COUNT(DISTINCT installer_id) AS distinct_installers,
    COUNT(DISTINCT order_id) AS distinct_orders,
    COUNT(DISTINCT installation_job_id) AS jobs_with_earnings,
    MIN(created_at) AS oldest_record,
    MAX(created_at) AS newest_record
FROM public.installer_earnings;

-- ============================================================================
-- 2. INSTALLER_EARNINGS KOLONLARI LISTESI (INFORMATION_SCHEMA)
-- ============================================================================
SELECT
    'CONTROL_2_earnings_columns' AS check_id,
    ordinal_position,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'installer_earnings'
ORDER BY ordinal_position;

-- ============================================================================
-- 3. INSTALLER_EARNINGS SON 10 KAYIT (BILINEN KOLONLAR)
-- ============================================================================
SELECT
    'CONTROL_3_earnings_latest_10' AS check_id,
    id,
    company_id,
    installer_id,
    installation_job_id,
    order_id,
    earning_type,
    quantity,
    area_m2,
    total_earning,
    job_completed_date,
    created_by,
    created_at
FROM public.installer_earnings
ORDER BY created_at DESC
LIMIT 10;

-- ============================================================================
-- 4. INSTALLER_TRANSACTIONS TRANSACTION_TYPE BAZINDA SAYIM
-- ============================================================================
SELECT
    'CONTROL_4_transactions_by_type' AS check_id,
    transaction_type,
    COUNT(*) AS count,
    SUM(amount) AS total_amount,
    MIN(transaction_date) AS first_transaction,
    MAX(transaction_date) AS latest_transaction
FROM public.installer_transactions
GROUP BY transaction_type
ORDER BY transaction_type;

-- ============================================================================
-- 5. INSTALLER_TRANSACTIONS KOLONLARI LISTESI (INFORMATION_SCHEMA)
-- ============================================================================
SELECT
    'CONTROL_5_transactions_columns' AS check_id,
    ordinal_position,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'installer_transactions'
ORDER BY ordinal_position;

-- ============================================================================
-- 6. INSTALLER_TRANSACTIONS SON 10 EARNING KAYDI (BILINEN KOLONLAR)
-- ============================================================================
SELECT
    'CONTROL_6_transactions_latest_earning_10' AS check_id,
    id,
    company_id,
    installer_id,
    transaction_type,
    amount,
    description,
    transaction_date,
    created_at,
    expense_id,
    earning_type
FROM public.installer_transactions
WHERE transaction_type = 'earning'
ORDER BY transaction_date DESC
LIMIT 10;

-- ============================================================================
-- 7. INSTALLATION_JOBS SON COMPLETED KAYITLARI (SON 10)
-- ============================================================================
SELECT
    'CONTROL_7_jobs_latest_completed_10' AS check_id,
    id,
    company_id,
    assigned_staff_id AS installer_id,
    order_id,
    status,
    installer_fee,
    completed_at,
    created_at,
    updated_at
FROM public.installation_jobs
WHERE status = 'completed'
ORDER BY updated_at DESC
LIMIT 10;

-- ============================================================================
-- 8. SON COMPLETED JOB ILE EARNINGS ESLESMESI (CORRELATED)
-- ============================================================================
WITH last_completed_job AS (
    SELECT
        id,
        company_id,
        assigned_staff_id AS installer_id,
        order_id,
        installer_fee,
        completed_at,
        updated_at
    FROM public.installation_jobs
    WHERE status = 'completed'
    ORDER BY updated_at DESC
    LIMIT 1
)
SELECT
    'CONTROL_8_last_job_earnings_correlation' AS check_id,
    'installation_jobs' AS source,
    job.id AS record_id,
    job.installer_id,
    job.order_id,
    job.installer_fee AS amount,
    job.completed_at AS transaction_date,
    NULL::text AS earning_type
FROM last_completed_job job
UNION ALL
SELECT
    'CONTROL_8_last_job_earnings_correlation',
    'installer_earnings',
    ie.id,
    ie.installer_id,
    ie.order_id,
    ie.total_earning,
    ie.job_completed_date,
    ie.earning_type
FROM public.installer_earnings ie
WHERE ie.installation_job_id = (
    SELECT id FROM public.installation_jobs
    WHERE status = 'completed'
    ORDER BY updated_at DESC
    LIMIT 1
)
UNION ALL
SELECT
    'CONTROL_8_last_job_earnings_correlation',
    'installer_transactions',
    it.id,
    it.installer_id,
    NULL::uuid,
    it.amount,
    it.transaction_date,
    it.transaction_type
FROM public.installer_transactions it
WHERE it.transaction_type = 'earning'
  AND it.installer_id = (
    SELECT assigned_staff_id FROM public.installation_jobs
    WHERE status = 'completed'
    ORDER BY updated_at DESC
    LIMIT 1
  )
ORDER BY source, transaction_date DESC;

-- ============================================================================
-- 9. PRODUCTION UPDATE_INSTALLATION_COMPLETION FUNCTION DEFINITION
-- ============================================================================
SELECT
    'CONTROL_9_function_definition' AS check_id,
    pg_get_functiondef(
        'public.update_installation_completion(uuid, uuid, text, uuid, text)'::regprocedure
    ) AS function_definition;

-- ============================================================================
-- 10. INSTALLER_EARNINGS UNIQUE CONSTRAINTS VE INDEXLERI
-- ============================================================================
SELECT
    'CONTROL_10_earnings_constraints' AS check_id,
    'CONSTRAINT' AS object_type,
    constraint_name AS name,
    constraint_type,
    CASE
        WHEN constraint_type = 'UNIQUE' THEN 'YES'
        ELSE 'NO'
    END AS is_unique
FROM information_schema.table_constraints
WHERE table_schema = 'public' AND table_name = 'installer_earnings'
UNION ALL
SELECT
    'CONTROL_10_earnings_constraints',
    'INDEX',
    indexname,
    'INDEX',
    CASE
        WHEN indexdef ILIKE '%UNIQUE%' THEN 'YES'
        ELSE 'NO'
    END
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'installer_earnings'
ORDER BY object_type, name;

-- ============================================================================
-- 11. INSTALLER_TRANSACTIONS MEVCUT TRANSACTION_TYPE DEGERLERI
-- ============================================================================
SELECT
    'CONTROL_11_transaction_types' AS check_id,
    transaction_type,
    COUNT(*) AS count
FROM public.installer_transactions
WHERE transaction_type IS NOT NULL
GROUP BY transaction_type
ORDER BY transaction_type;

-- ============================================================================
-- 12. INSTALLER_EARNINGS IDEMPOTENCY_KEY KOLONU VAR MI?
-- ============================================================================
SELECT
    'CONTROL_12_earnings_idempotency_key_exists' AS check_id,
    CASE
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'installer_earnings'
            AND column_name = 'idempotency_key'
        ) THEN 'YES - Column exists'
        ELSE 'NO - Column does not exist'
    END AS status;

-- ============================================================================
-- 13. INSTALLER_TRANSACTIONS IDEMPOTENCY_KEY KOLONU VAR MI?
-- ============================================================================
SELECT
    'CONTROL_13_transactions_idempotency_key_exists' AS check_id,
    CASE
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'installer_transactions'
            AND column_name = 'idempotency_key'
        ) THEN 'YES - Column exists'
        ELSE 'NO - Column does not exist'
    END AS status;

-- ============================================================================
-- 14. INSTALLATION_JOBS.INSTALLER_FEE vs INSTALLER_EARNINGS.TOTAL_EARNING
-- ============================================================================
WITH jobs_summary AS (
    SELECT
        SUM(CASE WHEN status = 'completed' THEN COALESCE(installer_fee, 0) ELSE 0 END) AS total_fee,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) AS completed_count
    FROM public.installation_jobs
),
earnings_summary AS (
    SELECT
        SUM(total_earning) AS total_earning,
        COUNT(*) AS earnings_count
    FROM public.installer_earnings
)
SELECT
    'CONTROL_14_fee_earnings_comparison' AS check_id,
    COALESCE(jobs.total_fee, 0) AS jobs_installer_fee_total,
    jobs.completed_count AS jobs_completed_count,
    COALESCE(earnings.total_earning, 0) AS earnings_total_earning,
    earnings.earnings_count AS earnings_count,
    CASE
        WHEN COALESCE(jobs.total_fee, 0) = COALESCE(earnings.total_earning, 0)
        THEN 'SAME - Duplicate or aligned'
        WHEN COALESCE(jobs.total_fee, 0) > 0 AND COALESCE(earnings.total_earning, 0) = 0
        THEN 'DIFFERENT - Jobs has data, earnings empty'
        WHEN COALESCE(jobs.total_fee, 0) = 0 AND COALESCE(earnings.total_earning, 0) > 0
        THEN 'DIFFERENT - Earnings has data, jobs empty'
        ELSE 'DIFFERENT - Values mismatch'
    END AS comparison_result
FROM jobs_summary jobs, earnings_summary earnings;

-- ============================================================================
-- 15. SON SMOKE TESTTE OLUSTURULAN EARNING KAYITLARI (MULTI-TABLE)
-- ============================================================================
WITH latest_earnings_id AS (
    SELECT id, installation_job_id, order_id, created_at
    FROM public.installer_earnings
    ORDER BY created_at DESC
    LIMIT 1
)
SELECT
    'CONTROL_15_smoke_test_earnings_multiview' AS check_id,
    'installation_jobs' AS table_name,
    ij.id AS record_id,
    ij.assigned_staff_id AS installer_id,
    ij.order_id,
    ij.installer_fee AS amount,
    ij.status,
    ij.completed_at AS timestamp,
    NULL::text AS earning_type
FROM public.installation_jobs ij
WHERE ij.id = (SELECT installation_job_id FROM latest_earnings_id)
UNION ALL
SELECT
    'CONTROL_15_smoke_test_earnings_multiview',
    'installer_earnings',
    ie.id,
    ie.installer_id,
    ie.order_id,
    ie.total_earning,
    ie.earning_type,
    ie.created_at,
    ie.earning_type
FROM public.installer_earnings ie
WHERE ie.id = (SELECT id FROM latest_earnings_id)
UNION ALL
SELECT
    'CONTROL_15_smoke_test_earnings_multiview',
    'installer_transactions',
    it.id,
    it.installer_id,
    NULL::uuid,
    it.amount,
    it.transaction_type,
    it.transaction_date,
    it.earning_type
FROM public.installer_transactions it
WHERE it.installer_id = (
    SELECT ie.installer_id FROM public.installer_earnings ie
    WHERE ie.id = (SELECT id FROM latest_earnings_id)
)
  AND it.transaction_type = 'earning'
  AND it.transaction_date >= (SELECT created_at - INTERVAL '1 minute' FROM latest_earnings_id)
ORDER BY table_name, timestamp DESC;

-- ============================================================================
-- END OF READ-ONLY VERIFICATION QUERIES
-- ============================================================================
