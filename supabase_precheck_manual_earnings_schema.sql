-- ============================================================================
-- PRECHECK: Verify production schema before manual earnings implementation
-- ============================================================================
-- Safe: Read-only, no modifications
-- Run this FIRST to confirm current state

-- Check 1: order_id constraint (should be NOT NULL)
SELECT
    'precheck_order_id_constraint' AS check_name,
    column_name,
    is_nullable,
    CASE
        WHEN is_nullable = 'NO' THEN '✓ OK: order_id is NOT NULL (as expected)'
        WHEN is_nullable = 'YES' THEN '✗ UNEXPECTED: order_id is already nullable'
    END AS status
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'installer_earnings'
  AND column_name = 'order_id';

-- Check 2: idempotency_key missing (should not exist yet)
SELECT
    'precheck_idempotency_key_missing' AS check_name,
    CASE
        WHEN EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public'
            AND table_name = 'installer_earnings'
            AND column_name = 'idempotency_key'
        ) THEN '✗ UNEXPECTED: idempotency_key column already exists'
        ELSE '✓ OK: idempotency_key missing (as expected)'
    END AS status;

-- Check 3: Current installer_earnings columns
SELECT
    'precheck_installer_earnings_columns' AS check_name,
    ordinal_position,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'installer_earnings'
ORDER BY ordinal_position;

-- Check 4: installer_transactions structure
SELECT
    'precheck_installer_transactions_columns' AS check_name,
    ordinal_position,
    column_name,
    data_type,
    is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'installer_transactions'
ORDER BY ordinal_position;

-- Check 5: Current transaction_type values in production
SELECT
    'precheck_transaction_types' AS check_name,
    transaction_type,
    COUNT(*) AS count
FROM public.installer_transactions
WHERE transaction_type IS NOT NULL
GROUP BY transaction_type
ORDER BY transaction_type;
