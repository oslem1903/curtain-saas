-- ============================================================================
-- MIGRATION 002: Make order_id nullable for manual earnings
-- ============================================================================
-- Purpose: Allow manual earnings without requiring an order_id
-- Safe: Existing data keeps current order_id, only new manual earnings have NULL
-- Rollback: ALTER COLUMN order_id SET NOT NULL

BEGIN TRANSACTION;

-- Allow NULL values for manual earnings
ALTER TABLE public.installer_earnings
ALTER COLUMN order_id DROP NOT NULL;

-- Notify schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;
