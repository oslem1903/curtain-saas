-- ============================================================================
-- MIGRATION 001: Add idempotency_key to installer_earnings
-- ============================================================================
-- Purpose: Enable duplicate prevention for manual earnings via RPC replay
-- Safe: Nullable column, existing data unaffected
-- Rollback: DROP COLUMN idempotency_key

BEGIN TRANSACTION;

-- Add column (nullable to allow existing rows without keys)
ALTER TABLE public.installer_earnings
ADD COLUMN IF NOT EXISTS idempotency_key text;

-- Create UNIQUE index
-- Only enforces uniqueness when idempotency_key IS NOT NULL
-- Allows multiple NULL values (safe for automatic earnings without keys)
CREATE UNIQUE INDEX IF NOT EXISTS uq_installer_earnings_company_idempotency
ON public.installer_earnings(company_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;

-- Notify schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;
