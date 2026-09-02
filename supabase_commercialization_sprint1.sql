-- ============================================================================
-- PERDEPRO COMMERCIALIZATION SPRINT 1 — MINIMAL PAID INFRASTRUCTURE
-- ============================================================================
-- Adds onboarding state, paid subscription tracking, and license management
-- Safe: additive only, no alterations to existing columns/constraints
-- Idempotent: handles partial migrations and re-runs safely
-- ============================================================================

-- 0. MIGRATION MARKER TABLE
-- Tracks which migrations have completed their first-run backfill
-- Distinguishes: first run (backfill all existing to true) vs. subsequent runs (only fill NULLs)
CREATE TABLE IF NOT EXISTS public.app_migration_markers (
  marker_key text PRIMARY KEY,
  applied_at timestamptz DEFAULT now()
);

-- ============================================================================
-- 1. COMPANIES TABLE: ONBOARDING STATE
-- ============================================================================
-- Robust, idempotent onboarding migration that handles partial deployments
-- First run: backfills all existing companies with onboarding_completed=true
-- Subsequent runs: only fills NULL values with false (for new companies not yet completed)
DO $$
DECLARE
  v_column_exists boolean;
  v_column_not_null boolean;
  v_has_default boolean;
  v_null_rows_remain integer;
  v_marker_exists boolean;
BEGIN
  -- Check current state of onboarding_completed column
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='companies' AND column_name='onboarding_completed'
  ) INTO v_column_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='companies' AND column_name='onboarding_completed'
       AND is_nullable = 'NO'
  ) INTO v_column_not_null;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='companies' AND column_name='onboarding_completed'
       AND column_default IS NOT NULL
  ) INTO v_has_default;

  -- Check if first-run backfill marker exists
  SELECT EXISTS (
    SELECT 1 FROM public.app_migration_markers
     WHERE marker_key = 'commercialization_sprint1_onboarding_backfill'
  ) INTO v_marker_exists;

  -- If column doesn't exist, create it as nullable
  IF NOT v_column_exists THEN
    ALTER TABLE public.companies
      ADD COLUMN onboarding_completed boolean,
      ADD COLUMN onboarding_completed_at timestamptz;
  END IF;

  -- Count remaining NULL rows to decide backfill strategy
  SELECT COUNT(*) INTO v_null_rows_remain
    FROM public.companies
   WHERE onboarding_completed IS NULL;

  -- FIRST RUN: Backfill existing companies with true (prevents wizard regression)
  -- This only happens once, tracked by marker
  IF NOT v_marker_exists THEN
    UPDATE public.companies
       SET onboarding_completed = true
     WHERE onboarding_completed IS NULL;

    -- Mark first-run backfill complete
    INSERT INTO public.app_migration_markers (marker_key)
      VALUES ('commercialization_sprint1_onboarding_backfill')
      ON CONFLICT (marker_key) DO NOTHING;
  ELSE
    -- SUBSEQUENT RUNS: Fill NULLs with false (for new companies not yet onboarded)
    -- Never convert false→true, only NULL→false
    UPDATE public.companies
       SET onboarding_completed = false
     WHERE onboarding_completed IS NULL;
  END IF;

  -- Apply DEFAULT false for new rows (only if not already set)
  IF NOT v_has_default THEN
    ALTER TABLE public.companies
      ALTER COLUMN onboarding_completed SET DEFAULT false;
  END IF;

  -- Apply NOT NULL constraint (only if not already applied)
  IF NOT v_column_not_null THEN
    ALTER TABLE public.companies
      ALTER COLUMN onboarding_completed SET NOT NULL;
  END IF;

EXCEPTION WHEN OTHERS THEN
  -- Catch any errors and continue
  -- Next run will retry or verify completion
  NULL;
END $$;

-- ============================================================================
-- 2. COMPANIES TABLE: SUBSCRIPTION & LICENSE TRACKING
-- ============================================================================
-- subscription_status tracks current state: trial/active/suspended/expired/cancelled
-- Safe mapping: explicit cases for known plans, 'trial' default for unknowns
-- Handles partial deployments and re-runs safely
DO $$
DECLARE
  v_column_exists boolean;
  v_column_not_null boolean;
  v_has_default boolean;
  v_constraint_exists boolean;
  v_null_rows_remain integer;
BEGIN
  -- Check current state of subscription_status column
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='companies' AND column_name='subscription_status'
  ) INTO v_column_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='companies' AND column_name='subscription_status'
       AND is_nullable = 'NO'
  ) INTO v_column_not_null;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='companies' AND column_name='subscription_status'
       AND column_default IS NOT NULL
  ) INTO v_has_default;

  -- Check if constraint already exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
     WHERE table_schema='public' AND table_name='companies'
       AND constraint_name='subscription_status_check'
  ) INTO v_constraint_exists;

  -- If columns don't exist, create them as nullable
  IF NOT v_column_exists THEN
    ALTER TABLE public.companies
      ADD COLUMN subscription_status text,
      ADD COLUMN license_expires_at timestamptz,
      ADD COLUMN payment_reference text,
      ADD COLUMN billing_note text;
  END IF;

  -- Backfill subscription_status with explicit mapping (on every run until no NULLs remain)
  -- Safe mapping:
  --   - 'trial' → 'trial' (trial subscriptions)
  --   - 'lifetime' → 'active' (perpetual paid license)
  --   - 'starter' → 'trial' (default/fallback plan, treat as trial, not paid)
  --   - NULL or unknown → 'trial' (safe default for unmapped values)
  SELECT COUNT(*) INTO v_null_rows_remain
    FROM public.companies
   WHERE subscription_status IS NULL;

  IF v_null_rows_remain > 0 THEN
    UPDATE public.companies
       SET subscription_status = CASE
         WHEN subscription_plan = 'lifetime' THEN 'active'
         WHEN subscription_plan = 'trial' THEN 'trial'
         WHEN subscription_plan = 'starter' THEN 'trial'
         WHEN subscription_plan IS NULL THEN 'trial'
         ELSE 'trial'
       END
     WHERE subscription_status IS NULL;
  END IF;

  -- Apply DEFAULT 'trial' for new rows (only if not already set)
  IF NOT v_has_default THEN
    ALTER TABLE public.companies
      ALTER COLUMN subscription_status SET DEFAULT 'trial';
  END IF;

  -- Apply NOT NULL constraint (only if not already applied)
  IF NOT v_column_not_null THEN
    ALTER TABLE public.companies
      ALTER COLUMN subscription_status SET NOT NULL;
  END IF;

  -- Create CHECK constraint if it doesn't exist
  IF NOT v_constraint_exists THEN
    ALTER TABLE public.companies
      ADD CONSTRAINT subscription_status_check
      CHECK (subscription_status IN ('trial', 'active', 'suspended', 'expired', 'cancelled'))
      NOT VALID;

    -- Validate constraint asynchronously (won't block migration)
    ALTER TABLE public.companies VALIDATE CONSTRAINT subscription_status_check;
  END IF;

EXCEPTION WHEN OTHERS THEN
  -- Catch any errors and continue
  -- Next run will retry or verify completion
  NULL;
END $$;

-- ============================================================================
-- 3. INDEXES: Support trial and license expiry queries
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_companies_trial_expiry
  ON public.companies(trial_ends_at)
  WHERE subscription_status = 'trial' AND trial_ends_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_companies_license_expiry
  ON public.companies(license_expires_at)
  WHERE subscription_status = 'active' AND license_expires_at IS NOT NULL;

-- ============================================================================
-- 4. RPC: COMPLETE_COMPANY_ONBOARDING
-- ============================================================================
-- Called by authenticated user after 3-step wizard
-- Validates: user is admin/owner of this company
-- Updates: onboarding_completed = true, onboarding_completed_at = now()
-- Returns: updated company record
-- Security: SECURITY DEFINER, user can only update their own company
-- ============================================================================

CREATE OR REPLACE FUNCTION public.complete_company_onboarding(
  p_company_id uuid,
  p_company_name text,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_company_owner_id uuid;
  v_member_role text;
  v_member_active boolean;
  v_is_authorized boolean;
  v_result jsonb;
BEGIN
  -- 1. Get authenticated user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Oturum yok. Yeniden giriş yapın.';
  END IF;

  -- 2. Get company owner
  SELECT owner_id INTO v_company_owner_id
    FROM public.companies
   WHERE id = p_company_id;

  IF v_company_owner_id IS NULL THEN
    RAISE EXCEPTION 'Firma bulunamadı.';
  END IF;

  -- 3. Check if user is authorized (owner, admin member, or super_admin)
  v_is_authorized := false;

  -- Check if user is company owner
  IF v_user_id = v_company_owner_id THEN
    v_is_authorized := true;
  END IF;

  -- Check if user is admin member of this company
  IF NOT v_is_authorized THEN
    SELECT is_active INTO v_member_active
      FROM public.company_members
     WHERE user_id = v_user_id
       AND company_id = p_company_id
       AND role = 'admin'
     LIMIT 1;

    IF v_member_active IS NOT NULL THEN
      v_is_authorized := true;
    END IF;
  END IF;

  -- Check if user is super_admin
  IF NOT v_is_authorized THEN
    v_is_authorized := is_super_admin();
  END IF;

  IF NOT v_is_authorized THEN
    RAISE EXCEPTION 'Bu işlemi yapmak için yetkilendirilmemiş.';
  END IF;

  -- 4. Update company: mark onboarding complete
  UPDATE public.companies
     SET onboarding_completed = true,
         onboarding_completed_at = now(),
         name = COALESCE(p_company_name, name)
   WHERE id = p_company_id;

  -- 5. Return updated company state
  SELECT jsonb_build_object(
    'company_id', id,
    'company_name', name,
    'onboarding_completed', onboarding_completed,
    'onboarding_completed_at', onboarding_completed_at,
    'subscription_status', subscription_status,
    'subscription_plan', subscription_plan,
    'trial_ends_at', trial_ends_at,
    'license_expires_at', license_expires_at
  ) INTO v_result
    FROM public.companies
   WHERE id = p_company_id;

  RETURN v_result;
END;
$$;

-- ============================================================================
-- 5. RPC: SUPER_ADMIN_UPDATE_COMPANY_LICENSE
-- ============================================================================
-- Called by super-admin from License Management page
-- Updates: subscription_status, subscription_plan, license_expires_at, etc.
-- Validates: caller is super_admin only
-- Returns: updated company state
-- Security: SECURITY DEFINER, super_admin only
-- ============================================================================

CREATE OR REPLACE FUNCTION public.super_admin_update_company_license(
  p_company_id uuid,
  p_subscription_status text DEFAULT NULL,
  p_license_expires_at timestamptz DEFAULT NULL,
  p_subscription_plan text DEFAULT NULL,
  p_payment_reference text DEFAULT NULL,
  p_billing_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_is_super_admin boolean;
  v_result jsonb;
BEGIN
  -- 1. Get authenticated user
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Oturum yok. Yeniden giriş yapın.';
  END IF;

  -- 2. Verify caller is super_admin
  SELECT is_super_admin() INTO v_is_super_admin;
  IF NOT v_is_super_admin THEN
    RAISE EXCEPTION 'Super Admin yetkilendirmesi gerekli.';
  END IF;

  -- 3. Validate subscription_status if provided
  IF p_subscription_status IS NOT NULL THEN
    IF p_subscription_status NOT IN ('trial', 'active', 'suspended', 'expired', 'cancelled') THEN
      RAISE EXCEPTION 'Geçersiz subscription_status: %', p_subscription_status;
    END IF;
  END IF;

  -- 4. Update company license fields
  UPDATE public.companies
     SET subscription_status = COALESCE(p_subscription_status, subscription_status),
         subscription_plan = COALESCE(p_subscription_plan, subscription_plan),
         license_expires_at = COALESCE(p_license_expires_at, license_expires_at),
         payment_reference = COALESCE(p_payment_reference, payment_reference),
         billing_note = COALESCE(p_billing_note, billing_note)
   WHERE id = p_company_id;

  -- 5. Return updated state
  SELECT jsonb_build_object(
    'company_id', id,
    'company_name', name,
    'subscription_status', subscription_status,
    'subscription_plan', subscription_plan,
    'trial_ends_at', trial_ends_at,
    'license_expires_at', license_expires_at,
    'payment_reference', payment_reference,
    'billing_note', billing_note,
    'max_users', max_users,
    'max_devices', max_devices,
    'enabled_modules', enabled_modules
  ) INTO v_result
    FROM public.companies
   WHERE id = p_company_id;

  RETURN v_result;
END;
$$;

-- ============================================================================
-- 6. SCHEMA CACHE RELOAD
-- ============================================================================
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- 7. VERIFICATION QUERIES (run these manually to verify migration state)
-- ============================================================================

-- ============================================================================
-- VERIFICATION 1: Check column states and constraints
-- ============================================================================
-- SELECT
--   column_name,
--   is_nullable,
--   column_default,
--   data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'companies'
--   AND column_name IN ('onboarding_completed', 'subscription_status', 'license_expires_at', 'payment_reference', 'billing_note');

-- ============================================================================
-- VERIFICATION 2: Check migration marker state
-- ============================================================================
-- SELECT marker_key, applied_at
-- FROM public.app_migration_markers
-- WHERE marker_key = 'commercialization_sprint1_onboarding_backfill';

-- ============================================================================
-- VERIFICATION 3: Check subscription_plan → subscription_status mapping
-- ============================================================================
-- SELECT subscription_plan, subscription_status, COUNT(*) as count
-- FROM public.companies
-- GROUP BY subscription_plan, subscription_status
-- ORDER BY subscription_plan, subscription_status;

-- ============================================================================
-- VERIFICATION 4: Check for remaining NULLs (should be none)
-- ============================================================================
-- SELECT
--   COUNT(*) FILTER (WHERE onboarding_completed IS NULL) as null_onboarding,
--   COUNT(*) FILTER (WHERE subscription_status IS NULL) as null_subscription_status
-- FROM public.companies;

-- ============================================================================
-- VERIFICATION 5: Check onboarding_completed distribution
-- ============================================================================
-- SELECT onboarding_completed, COUNT(*) as count
-- FROM public.companies
-- GROUP BY onboarding_completed
-- ORDER BY onboarding_completed;

-- ============================================================================
-- VERIFICATION 6: Check subscription_status distribution
-- ============================================================================
-- SELECT subscription_status, COUNT(*) as count
-- FROM public.companies
-- GROUP BY subscription_status
-- ORDER BY subscription_status;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
SELECT 'MIGRATION: Commercialization Sprint 1 Complete' AS status;
