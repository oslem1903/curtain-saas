-- ============================================================================
-- MIGRATION 003: Add earning tracking columns to installer_transactions
-- ============================================================================
-- Purpose: Link transactions to manual earnings records and track earning type
-- Safe: Nullable columns, existing data unaffected
-- Rollback: DROP COLUMN earning_id, related_job_id, earning_type

BEGIN TRANSACTION;

-- Add earning_id to link installer_transactions to installer_earnings
ALTER TABLE public.installer_transactions
ADD COLUMN IF NOT EXISTS earning_id UUID REFERENCES public.installer_earnings(id);

-- Add related_job_id to track which job triggered this transaction (if any)
ALTER TABLE public.installer_transactions
ADD COLUMN IF NOT EXISTS related_job_id UUID REFERENCES public.installation_jobs(id);

-- Add earning_type to categorize earnings ('manual', 'automatic', etc.)
ALTER TABLE public.installer_transactions
ADD COLUMN IF NOT EXISTS earning_type TEXT;

-- Notify schema cache
NOTIFY pgrst, 'reload schema';

COMMIT;
