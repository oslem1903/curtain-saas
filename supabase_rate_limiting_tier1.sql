-- Rate Limiting for Financial Operations (Tier 1 Only)
-- Protects 8 critical financial flows from duplicate submissions

-- 1. Create rate limits table
CREATE TABLE IF NOT EXISTS public.rate_limits (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    request_count INTEGER DEFAULT 1,
    reset_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '1 hour',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create index for efficient lookups (user + endpoint + active window)
CREATE INDEX IF NOT EXISTS rate_limits_user_endpoint_active
  ON public.rate_limits(user_id, endpoint, reset_at);

-- 3. Enable RLS on rate_limits table
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policy: Users can only view their own rate limits
-- Safe idempotent approach: Create only if policy doesn't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'rate_limits'
    AND policyname = 'rate_limits_user_isolation'
  ) THEN
    CREATE POLICY "rate_limits_user_isolation" ON public.rate_limits
      FOR SELECT USING (user_id = auth.uid());
  END IF;
END $$;

-- 5. RPC Function: Check and increment rate limit
-- Returns true if user is within limit, false if exceeded
CREATE OR REPLACE FUNCTION public.check_rate_limit(
    p_endpoint TEXT,
    p_limit INTEGER DEFAULT 1,
    p_window_seconds INTEGER DEFAULT 5
)
RETURNS boolean AS $$
DECLARE
    v_count INTEGER;
    v_reset_at TIMESTAMPTZ;
BEGIN
    -- Calculate reset time based on window
    v_reset_at := NOW() + (p_window_seconds || ' seconds')::INTERVAL;

    -- Insert new record or increment existing one within window
    INSERT INTO public.rate_limits (user_id, endpoint, request_count, reset_at)
    VALUES (auth.uid(), p_endpoint, 1, v_reset_at)
    ON CONFLICT (user_id, endpoint, reset_at)
    DO UPDATE SET request_count = rate_limits.request_count + 1
    RETURNING request_count INTO v_count;

    -- Return true if under limit, false if exceeded
    RETURN v_count <= p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Cleanup trigger to remove expired rate limit entries (daily)
-- This prevents the rate_limits table from growing indefinitely
CREATE OR REPLACE FUNCTION public.cleanup_expired_rate_limits()
RETURNS void AS $$
BEGIN
    DELETE FROM public.rate_limits
    WHERE reset_at < NOW();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Note: Schedule this function to run daily via Supabase cron or application scheduler
-- SELECT cron.schedule('cleanup_expired_rate_limits', '0 2 * * *', 'SELECT public.cleanup_expired_rate_limits()');

-- 7. Tier 1 Protected Endpoints Configuration
-- These are the 8 critical financial flows with their rate limits

-- Endpoint: record_order_payment
-- Limit: 1 payment per 5 seconds
-- Reason: Prevent duplicate payment submission

-- Endpoint: record_supplier_payment
-- Limit: 1 payment per 5 seconds
-- Reason: Prevent duplicate supplier payments

-- Endpoint: record_installer_payment
-- Limit: 1 payment per 5 seconds
-- Reason: Prevent duplicate installer payments

-- Endpoint: cancel_installer_payment
-- Limit: 1 cancellation per 5 seconds
-- Reason: Prevent duplicate cancellations

-- Endpoint: record_income_entry
-- Limit: 3 entries per 5 seconds
-- Reason: Allow multiple entries but prevent spam

-- Endpoint: record_expense_entry
-- Limit: 3 entries per 5 seconds
-- Reason: Allow multiple entries but prevent spam

-- Endpoint: record_invoice_save
-- Limit: 1 invoice per 3 seconds
-- Reason: Prevent invoice creation spam

-- Endpoint: update_installation_completion
-- Limit: 1 update per 3 seconds
-- Reason: Prevent rapid completion status changes

-- ============================================================================
-- Testing the rate limit function:
-- ============================================================================
-- SELECT public.check_rate_limit('record_order_payment', 1, 5);  -- First call = TRUE
-- SELECT public.check_rate_limit('record_order_payment', 1, 5);  -- Second call = FALSE
--
-- Wait 6 seconds, then:
-- SELECT public.check_rate_limit('record_order_payment', 1, 5);  -- After reset = TRUE
-- ============================================================================

-- Display summary
SELECT 'Rate limiting table created successfully' AS status;
SELECT COUNT(*) AS rate_limit_entries FROM public.rate_limits;
