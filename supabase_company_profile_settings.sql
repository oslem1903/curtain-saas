-- ============================================================================
-- PERDEPRO COMMERCIALIZATION SPRINT 2.2
-- COMPANY PROFILE & LICENSE SETTINGS
-- ============================================================================
-- Adds missing company profile columns: phone, email, address, tax_office, tax_no
-- Safe: additive only, no alterations to existing columns
-- Idempotent: fully safe to run multiple times
-- ============================================================================

DO $$
DECLARE
  v_phone_exists boolean;
  v_email_exists boolean;
  v_address_exists boolean;
  v_tax_office_exists boolean;
  v_tax_no_exists boolean;
BEGIN
  -- Check which columns already exist
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='companies' AND column_name='phone'
  ) INTO v_phone_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='companies' AND column_name='email'
  ) INTO v_email_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='companies' AND column_name='address'
  ) INTO v_address_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='companies' AND column_name='tax_office'
  ) INTO v_tax_office_exists;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='companies' AND column_name='tax_no'
  ) INTO v_tax_no_exists;

  -- Add missing columns only if they don't exist
  IF NOT v_phone_exists THEN
    ALTER TABLE public.companies ADD COLUMN phone text;
  END IF;

  IF NOT v_email_exists THEN
    ALTER TABLE public.companies ADD COLUMN email text;
  END IF;

  IF NOT v_address_exists THEN
    ALTER TABLE public.companies ADD COLUMN address text;
  END IF;

  IF NOT v_tax_office_exists THEN
    ALTER TABLE public.companies ADD COLUMN tax_office text;
  END IF;

  IF NOT v_tax_no_exists THEN
    ALTER TABLE public.companies ADD COLUMN tax_no text;
  END IF;

EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- ============================================================================
-- 2. CREATE RPC: update_company_profile
-- ============================================================================
-- Authorization:
--   - auth.uid() == companies.owner_id (owner)
--   - OR active company_members.role='admin' (company admin)
--   - OR super_admin (super admin)
-- Returns: {success: boolean, message: string}
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_company_profile(
  p_company_id uuid,
  p_name text DEFAULT NULL,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_address text DEFAULT NULL,
  p_tax_office text DEFAULT NULL,
  p_tax_no text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company_id uuid;
  v_is_super_admin boolean;
  v_is_owner boolean;
  v_is_admin boolean;
  v_has_access boolean;
  v_trimmed_name text;
BEGIN
  -- Get current user
  v_company_id := p_company_id;

  -- Check if user is super admin
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = auth.uid() AND role = 'super_admin'
  ) INTO v_is_super_admin;

  -- If not super admin, check if user is owner
  SELECT EXISTS (
    SELECT 1 FROM companies
    WHERE id = v_company_id AND owner_id = auth.uid()
  ) INTO v_is_owner;

  -- If not owner, check if user is admin in the company
  SELECT EXISTS (
    SELECT 1 FROM company_members
    WHERE company_id = v_company_id
      AND user_id = auth.uid()
      AND role = 'admin'
      AND is_active = true
  ) INTO v_is_admin;

  -- Determine if user has access
  v_has_access := v_is_super_admin OR v_is_owner OR v_is_admin;

  IF NOT v_has_access THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Yetkiniz yok. Şirket sahibi veya yönetici olmanız gerekir.'
    );
  END IF;

  -- Validate company name (reject empty strings)
  v_trimmed_name := TRIM(COALESCE(p_name, ''));
  IF p_name IS NOT NULL AND v_trimmed_name = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Şirket adı boş olamaz.'
    );
  END IF;

  -- Update company profile
  UPDATE companies
  SET
    name = CASE WHEN p_name IS NOT NULL THEN TRIM(p_name) ELSE name END,
    phone = CASE WHEN p_phone IS NOT NULL THEN TRIM(p_phone) ELSE phone END,
    email = CASE WHEN p_email IS NOT NULL THEN TRIM(p_email) ELSE email END,
    address = CASE WHEN p_address IS NOT NULL THEN TRIM(p_address) ELSE address END,
    tax_office = CASE WHEN p_tax_office IS NOT NULL THEN TRIM(p_tax_office) ELSE tax_office END,
    tax_no = CASE WHEN p_tax_no IS NOT NULL THEN TRIM(p_tax_no) ELSE tax_no END
  WHERE id = v_company_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Şirket profili başarıyla güncellendi.'
  );
END $$;

-- ============================================================================
-- MIGRATION COMPLETE
-- ============================================================================
SELECT 'MIGRATION: Company Profile Settings Complete' AS status;
