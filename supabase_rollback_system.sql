-- ============================================================================
-- ROLLBACK SYSTEM FOR APPLICATION VERSIONS ONLY
-- Data remains immutable - only app version, features, UI can be rolled back
-- ============================================================================

-- ============================================================================
-- STEP 1: EXTEND COMPANIES TABLE
-- Track current app version per company and identify test companies
-- ============================================================================

ALTER TABLE public.companies
ADD COLUMN IF NOT EXISTS is_test_company boolean DEFAULT false;

ALTER TABLE public.companies
ADD COLUMN IF NOT EXISTS current_app_version text DEFAULT '0.0.0';

ALTER TABLE public.companies
ADD COLUMN IF NOT EXISTS last_version_update_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_companies_is_test ON public.companies(is_test_company);
CREATE INDEX IF NOT EXISTS idx_companies_app_version ON public.companies(current_app_version);

-- ============================================================================
-- STEP 2: VERSION_RELEASE_DEPLOYMENTS TABLE
-- Tracks which companies are running which version
-- This is ONLY for app version tracking, NOT data
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.version_release_deployments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version_release_id uuid NOT NULL REFERENCES public.version_releases(id) ON DELETE CASCADE,
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    stage text NOT NULL CHECK (stage IN ('test', 'staging', 'production')),

    -- Deployment tracking (app version only)
    deployed_at timestamptz NOT NULL DEFAULT now(),
    deployed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    deployment_status text NOT NULL DEFAULT 'active' CHECK (deployment_status IN ('pending', 'active', 'rolled_back')),

    -- Rollback tracking (app version only - NOT data rollback)
    rolled_back_at timestamptz,
    rolled_back_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    rollback_reason text,

    -- Metadata for tracking
    deployment_metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deployments_version ON public.version_release_deployments(version_release_id);
CREATE INDEX IF NOT EXISTS idx_deployments_company ON public.version_release_deployments(company_id);
CREATE INDEX IF NOT EXISTS idx_deployments_stage ON public.version_release_deployments(stage);
CREATE INDEX IF NOT EXISTS idx_deployments_status ON public.version_release_deployments(deployment_status);
CREATE INDEX IF NOT EXISTS idx_deployments_created ON public.version_release_deployments(created_at DESC);

COMMENT ON TABLE public.version_release_deployments IS 'Tracks app version deployments per company. DOES NOT affect customer data - data remains immutable.';

-- ============================================================================
-- STEP 3: DEPLOYMENT_STAGES TABLE
-- Manages release workflow: test -> staging -> production
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.deployment_stages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version_release_id uuid NOT NULL REFERENCES public.version_releases(id) ON DELETE CASCADE,
    stage text NOT NULL CHECK (stage IN ('test', 'staging', 'production')),

    -- Stage workflow
    scheduled_for timestamptz,
    started_at timestamptz,
    completed_at timestamptz,
    stage_status text NOT NULL DEFAULT 'pending' CHECK (stage_status IN ('pending', 'active', 'completed', 'failed', 'rolled_back')),

    -- Progress tracking for gradual rollout (optional)
    rollout_enabled boolean DEFAULT false,
    current_rollout_percentage integer DEFAULT 0 CHECK (current_rollout_percentage >= 0 AND current_rollout_percentage <= 100),
    target_rollout_percentage integer DEFAULT 100,

    -- Tracking
    created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    stage_metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stages_version ON public.deployment_stages(version_release_id);
CREATE INDEX IF NOT EXISTS idx_stages_stage ON public.deployment_stages(stage);
CREATE INDEX IF NOT EXISTS idx_stages_status ON public.deployment_stages(stage_status);
CREATE INDEX IF NOT EXISTS idx_stages_created ON public.deployment_stages(created_at DESC);

COMMENT ON TABLE public.deployment_stages IS 'Manages release stages (test, staging, production). Controls gradual rollouts.';

-- ============================================================================
-- STEP 4: PRE_VERSION_SNAPSHOTS TABLE
-- Saves metadata about previous versions (for rollback reference)
-- NOTE: This stores only version info, NOT customer data
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.pre_version_snapshots (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version_release_id uuid NOT NULL REFERENCES public.version_releases(id) ON DELETE CASCADE,
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

    -- Previous version info (for rollback reference)
    previous_app_version text NOT NULL,
    previous_release_id uuid REFERENCES public.version_releases(id) ON DELETE SET NULL,

    -- Metadata (feature flags state, ui settings, etc. - NOT data)
    snapshot_metadata jsonb DEFAULT '{}'::jsonb,

    -- Audit
    snapshotted_at timestamptz NOT NULL DEFAULT now(),
    created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_version ON public.pre_version_snapshots(version_release_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_company ON public.pre_version_snapshots(company_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_created ON public.pre_version_snapshots(created_at DESC);

COMMENT ON TABLE public.pre_version_snapshots IS 'Snapshots app version metadata before deployment. DOES NOT store customer data.';

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

ALTER TABLE public.version_release_deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deployment_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pre_version_snapshots ENABLE ROW LEVEL SECURITY;

-- Only super_admin can access deployment tables
CREATE POLICY deployments_super_admin ON public.version_release_deployments
FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin')
);

CREATE POLICY deployment_stages_super_admin ON public.deployment_stages
FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin')
);

CREATE POLICY snapshots_super_admin ON public.pre_version_snapshots
FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin')
);

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.version_release_deployments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deployment_stages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pre_version_snapshots TO authenticated;

-- ============================================================================
-- RPC FUNCTION 1: deploy_version_to_companies
-- Deploy a version to specific companies in a stage
-- Updates ONLY companies.current_app_version
-- ============================================================================

CREATE OR REPLACE FUNCTION public.deploy_version_to_companies(
    p_version_release_id uuid,
    p_company_ids uuid[],
    p_stage text DEFAULT 'production',
    p_deployed_by uuid DEFAULT NULL
)
RETURNS TABLE (
    deployment_id uuid,
    company_count integer,
    stage text,
    status text,
    deployed_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_version_record public.version_releases%ROWTYPE;
    v_company_id uuid;
    v_deployed_count integer := 0;
BEGIN
    -- Check if caller is super_admin
    v_user_id := COALESCE(p_deployed_by, auth.uid());
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_user_id AND role = 'super_admin') THEN
        RAISE EXCEPTION 'Only super admins can deploy versions.';
    END IF;

    -- Validate version exists and get version number
    SELECT * INTO v_version_record FROM public.version_releases WHERE id = p_version_release_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Version release not found.';
    END IF;

    -- Validate stage
    IF p_stage NOT IN ('test', 'staging', 'production') THEN
        RAISE EXCEPTION 'Invalid stage: %. Must be test, staging, or production.', p_stage;
    END IF;

    -- Validate companies exist
    IF array_length(p_company_ids, 1) IS NULL OR array_length(p_company_ids, 1) = 0 THEN
        RAISE EXCEPTION 'No companies provided for deployment.';
    END IF;

    -- Deploy to each company: Update ONLY app version
    FOREACH v_company_id IN ARRAY p_company_ids
    LOOP
        -- Create deployment record
        INSERT INTO public.version_release_deployments (
            version_release_id,
            company_id,
            stage,
            deployed_by,
            deployment_status,
            deployment_metadata
        ) VALUES (
            p_version_release_id,
            v_company_id,
            p_stage,
            v_user_id,
            'active',
            jsonb_build_object(
                'deployed_to_stage', p_stage,
                'deployment_timestamp', now()::text
            )
        );

        -- ONLY update app version - customer data remains untouched
        UPDATE public.companies
        SET
            current_app_version = v_version_record.version,
            last_version_update_at = now()
        WHERE id = v_company_id;

        v_deployed_count := v_deployed_count + 1;
    END LOOP;

    RETURN QUERY
    SELECT
        p_version_release_id::uuid,
        v_deployed_count::integer,
        p_stage::text,
        'success'::text,
        now()::timestamptz;

    -- Log to remote_maintenance_logs for audit trail
    INSERT INTO public.remote_maintenance_logs (
        executed_by,
        company_id,
        operation_type,
        operation_status,
        parameters,
        result,
        completed_at
    )
    SELECT
        v_user_id,
        COALESCE(p_company_ids[1], '00000000-0000-0000-0000-000000000000'::uuid),
        'deploy_version',
        'completed',
        jsonb_build_object(
            'version_id', p_version_release_id::text,
            'company_count', v_deployed_count,
            'stage', p_stage
        ),
        jsonb_build_object(
            'deployed_version', v_version_record.version,
            'deployed_count', v_deployed_count
        ),
        now();

END;
$$;

GRANT EXECUTE ON FUNCTION public.deploy_version_to_companies(uuid, uuid[], text, uuid) TO authenticated;

-- ============================================================================
-- RPC FUNCTION 2: rollback_version_for_companies
-- Rollback ONLY app version for specific companies
-- Does NOT rollback customer data - data remains immutable
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rollback_version_for_companies(
    p_version_release_id uuid,
    p_company_ids uuid[],
    p_reason text,
    p_rolled_back_by uuid DEFAULT NULL
)
RETURNS TABLE (
    rollback_id uuid,
    company_count integer,
    rolled_back_version text,
    restored_to_version text,
    status text,
    rolled_back_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_current_version record;
    v_previous_version record;
    v_company_id uuid;
    v_rollback_count integer := 0;
BEGIN
    -- Check if caller is super_admin
    v_user_id := COALESCE(p_rolled_back_by, auth.uid());
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_user_id AND role = 'super_admin') THEN
        RAISE EXCEPTION 'Only super admins can rollback versions.';
    END IF;

    -- Get current version
    SELECT * INTO v_current_version FROM public.version_releases WHERE id = p_version_release_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Version release not found.';
    END IF;

    -- Find previous version
    SELECT * INTO v_previous_version
    FROM public.version_releases
    WHERE created_at < v_current_version.created_at
      AND status = 'live'
    ORDER BY created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No previous version found to rollback to.';
    END IF;

    -- Rollback each company: Update ONLY app version
    FOREACH v_company_id IN ARRAY p_company_ids
    LOOP
        -- Create snapshot of current version before rollback
        INSERT INTO public.pre_version_snapshots (
            version_release_id,
            company_id,
            previous_app_version,
            previous_release_id,
            snapshot_metadata,
            created_by
        ) VALUES (
            p_version_release_id,
            v_company_id,
            v_current_version.version,
            v_previous_version.id,
            jsonb_build_object(
                'rollback_reason', p_reason,
                'rollback_timestamp', now()::text
            ),
            v_user_id
        );

        -- Mark deployment as rolled back
        UPDATE public.version_release_deployments
        SET
            deployment_status = 'rolled_back',
            rolled_back_at = now(),
            rolled_back_by = v_user_id,
            rollback_reason = p_reason
        WHERE version_release_id = p_version_release_id
          AND company_id = v_company_id;

        -- ONLY update app version back - customer data remains untouched
        UPDATE public.companies
        SET
            current_app_version = v_previous_version.version,
            last_version_update_at = now()
        WHERE id = v_company_id;

        v_rollback_count := v_rollback_count + 1;
    END LOOP;

    -- Update version release status
    UPDATE public.version_releases
    SET status = 'rolled_back'
    WHERE id = p_version_release_id;

    RETURN QUERY
    SELECT
        p_version_release_id::uuid,
        v_rollback_count::integer,
        v_current_version.version::text,
        v_previous_version.version::text,
        'success'::text,
        now()::timestamptz;

    -- Log to remote_maintenance_logs
    INSERT INTO public.remote_maintenance_logs (
        executed_by,
        company_id,
        operation_type,
        operation_status,
        parameters,
        result,
        completed_at
    )
    SELECT
        v_user_id,
        COALESCE(p_company_ids[1], '00000000-0000-0000-0000-000000000000'::uuid),
        'rollback_version',
        'completed',
        jsonb_build_object(
            'version_id', p_version_release_id::text,
            'reason', p_reason,
            'company_count', v_rollback_count
        ),
        jsonb_build_object(
            'rolled_back_from', v_current_version.version,
            'rolled_back_to', v_previous_version.version,
            'rollback_count', v_rollback_count
        ),
        now();

END;
$$;

GRANT EXECUTE ON FUNCTION public.rollback_version_for_companies(uuid, uuid[], text, uuid) TO authenticated;

-- ============================================================================
-- RPC FUNCTION 3: advance_deployment_stage
-- Move a version from one stage to next (test -> staging -> production)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.advance_deployment_stage(
    p_version_release_id uuid,
    p_from_stage text,
    p_to_stage text,
    p_advanced_by uuid DEFAULT NULL
)
RETURNS TABLE (
    stage_id uuid,
    version_id uuid,
    new_stage text,
    status text,
    advanced_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_stage_record public.deployment_stages%ROWTYPE;
    v_new_stage_id uuid;
BEGIN
    -- Check if caller is super_admin
    v_user_id := COALESCE(p_advanced_by, auth.uid());
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_user_id AND role = 'super_admin') THEN
        RAISE EXCEPTION 'Only super admins can advance deployment stages.';
    END IF;

    -- Validate stages
    IF p_from_stage NOT IN ('test', 'staging', 'production')
       OR p_to_stage NOT IN ('test', 'staging', 'production') THEN
        RAISE EXCEPTION 'Invalid stage. Must be test, staging, or production.';
    END IF;

    -- Get current stage
    SELECT * INTO v_stage_record
    FROM public.deployment_stages
    WHERE version_release_id = p_version_release_id
      AND stage = p_from_stage;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Deployment stage not found.';
    END IF;

    -- Complete current stage
    UPDATE public.deployment_stages
    SET
        completed_at = now(),
        stage_status = 'completed'
    WHERE id = v_stage_record.id;

    -- Create new stage
    INSERT INTO public.deployment_stages (
        version_release_id,
        stage,
        stage_status,
        created_by
    ) VALUES (
        p_version_release_id,
        p_to_stage,
        'active',
        v_user_id
    ) RETURNING id INTO v_new_stage_id;

    RETURN QUERY
    SELECT
        v_new_stage_id::uuid,
        p_version_release_id::uuid,
        p_to_stage::text,
        'success'::text,
        now()::timestamptz;

END;
$$;

GRANT EXECUTE ON FUNCTION public.advance_deployment_stage(uuid, text, text, uuid) TO authenticated;

-- ============================================================================
-- RPC FUNCTION 4: get_deployment_history
-- Get deployment and rollback history for audit trail
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_deployment_history(
    p_limit integer DEFAULT 100,
    p_version_id uuid DEFAULT NULL,
    p_company_id uuid DEFAULT NULL
)
RETURNS TABLE (
    deployment_id uuid,
    version text,
    company_name text,
    stage text,
    status text,
    deployed_at timestamptz,
    deployed_by_name text,
    rolled_back_at timestamptz,
    rolled_back_reason text
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Check if caller is super_admin
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin') THEN
        RAISE EXCEPTION 'Only super admins can view deployment history.';
    END IF;

    RETURN QUERY
    SELECT
        d.id::uuid,
        vr.version::text,
        c.name::text,
        d.stage::text,
        d.deployment_status::text,
        d.deployed_at::timestamptz,
        COALESCE(p1.full_name, 'Unknown')::text,
        d.rolled_back_at::timestamptz,
        d.rollback_reason::text
    FROM public.version_release_deployments d
    JOIN public.version_releases vr ON d.version_release_id = vr.id
    JOIN public.companies c ON d.company_id = c.id
    LEFT JOIN public.profiles p1 ON d.deployed_by = p1.user_id
    WHERE
        (p_version_id IS NULL OR d.version_release_id = p_version_id)
        AND (p_company_id IS NULL OR d.company_id = p_company_id)
    ORDER BY d.created_at DESC
    LIMIT p_limit;

END;
$$;

GRANT EXECUTE ON FUNCTION public.get_deployment_history(integer, uuid, uuid) TO authenticated;

-- ============================================================================
-- RPC FUNCTION 5: get_company_version_status
-- Get current app version and test status for a company
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_company_version_status(
    p_company_id uuid
)
RETURNS TABLE (
    company_name text,
    current_version text,
    is_test_company boolean,
    last_version_update_at timestamptz,
    previous_version text,
    rollback_available boolean
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Check if caller is super_admin
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin') THEN
        RAISE EXCEPTION 'Only super admins can view version status.';
    END IF;

    RETURN QUERY
    SELECT
        c.name::text,
        c.current_app_version::text,
        c.is_test_company::boolean,
        c.last_version_update_at::timestamptz,
        (
            SELECT previous_app_version
            FROM public.pre_version_snapshots
            WHERE company_id = c.id
            ORDER BY created_at DESC
            LIMIT 1
        )::text,
        CASE WHEN EXISTS (
            SELECT 1 FROM public.pre_version_snapshots WHERE company_id = c.id
        ) THEN true ELSE false END::boolean
    FROM public.companies c
    WHERE c.id = p_company_id;

END;
$$;

GRANT EXECUTE ON FUNCTION public.get_company_version_status(uuid) TO authenticated;

-- ============================================================================
-- STEP 5: DEPLOYMENT AUDIT LOG TABLE (Enhanced Security)
-- Comprehensive audit trail with IP, reason, approval workflow
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.deployment_audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type text NOT NULL CHECK (event_type IN (
        'deployment',
        'rollback_requested',
        'rollback_approved',
        'rollback_denied',
        'rollback_executed'
    )),

    version_release_id uuid NOT NULL REFERENCES public.version_releases(id) ON DELETE CASCADE,
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    is_test_company boolean NOT NULL,

    -- Version information
    from_version text,
    to_version text,

    -- Initiator information (who requested rollback)
    initiated_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    initiated_by_ip inet,
    initiated_at timestamptz NOT NULL DEFAULT now(),

    -- Rollback reason (MANDATORY for rollback events)
    rollback_reason text,

    -- Approver information (for production rollbacks)
    approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    approved_by_ip inet,
    approved_at timestamptz,

    -- Status tracking
    status text DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'denied', 'cancelled')),

    -- Metadata for additional context
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_event_type ON public.deployment_audit_log(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_version ON public.deployment_audit_log(version_release_id);
CREATE INDEX IF NOT EXISTS idx_audit_company ON public.deployment_audit_log(company_id);
CREATE INDEX IF NOT EXISTS idx_audit_initiated_by ON public.deployment_audit_log(initiated_by);
CREATE INDEX IF NOT EXISTS idx_audit_approved_by ON public.deployment_audit_log(approved_by);
CREATE INDEX IF NOT EXISTS idx_audit_created ON public.deployment_audit_log(created_at DESC);

COMMENT ON TABLE public.deployment_audit_log IS
'Comprehensive audit log for all deployment and rollback events. Tracks who, what, when, where (IP), and why.';

-- ============================================================================
-- STEP 6: DEPLOYMENT ROLLBACK APPROVALS TABLE (2-Person Approval)
-- Production rollbacks require approval from second super_admin
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.deployment_rollback_approvals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version_release_id uuid NOT NULL REFERENCES public.version_releases(id) ON DELETE CASCADE,
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

    -- Request information
    requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    requested_by_ip inet,
    rollback_reason text NOT NULL,
    request_from_version text NOT NULL,
    request_to_version text NOT NULL,
    requested_at timestamptz NOT NULL DEFAULT now(),

    -- Approval workflow
    approval_status text NOT NULL DEFAULT 'pending' CHECK (approval_status IN ('pending', 'approved', 'denied', 'expired')),
    approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    approved_by_ip inet,
    approved_at timestamptz,
    denial_reason text,

    -- Expiration (approval valid for 1 hour)
    expires_at timestamptz NOT NULL,

    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_approvals_status ON public.deployment_rollback_approvals(approval_status);
CREATE INDEX IF NOT EXISTS idx_approvals_version ON public.deployment_rollback_approvals(version_release_id);
CREATE INDEX IF NOT EXISTS idx_approvals_company ON public.deployment_rollback_approvals(company_id);
CREATE INDEX IF NOT EXISTS idx_approvals_requested_by ON public.deployment_rollback_approvals(requested_by);
CREATE INDEX IF NOT EXISTS idx_approvals_approved_by ON public.deployment_rollback_approvals(approved_by);
CREATE INDEX IF NOT EXISTS idx_approvals_created ON public.deployment_rollback_approvals(created_at DESC);

COMMENT ON TABLE public.deployment_rollback_approvals IS
'Stores rollback approval requests. Production rollbacks require approval from a different super_admin.';

-- ============================================================================
-- RLS FOR AUDIT LOG AND APPROVALS
-- ============================================================================

ALTER TABLE public.deployment_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deployment_rollback_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_log_super_admin ON public.deployment_audit_log
FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin')
);

CREATE POLICY rollback_approvals_super_admin ON public.deployment_rollback_approvals
FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.deployment_audit_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deployment_rollback_approvals TO authenticated;

-- ============================================================================
-- HELPER FUNCTION: log_deployment_event
-- Internal function to create audit log entries
-- ============================================================================

CREATE OR REPLACE FUNCTION public.log_deployment_event(
    p_event_type text,
    p_version_release_id uuid,
    p_company_id uuid,
    p_is_test_company boolean,
    p_from_version text,
    p_to_version text,
    p_initiated_by uuid,
    p_initiated_by_ip inet,
    p_rollback_reason text DEFAULT NULL,
    p_approved_by uuid DEFAULT NULL,
    p_approved_by_ip inet DEFAULT NULL,
    p_status text DEFAULT 'completed'
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_log_id uuid;
BEGIN
    INSERT INTO public.deployment_audit_log (
        event_type,
        version_release_id,
        company_id,
        is_test_company,
        from_version,
        to_version,
        initiated_by,
        initiated_by_ip,
        rollback_reason,
        approved_by,
        approved_by_ip,
        status
    ) VALUES (
        p_event_type,
        p_version_release_id,
        p_company_id,
        p_is_test_company,
        p_from_version,
        p_to_version,
        p_initiated_by,
        p_initiated_by_ip,
        p_rollback_reason,
        p_approved_by,
        p_approved_by_ip,
        p_status
    ) RETURNING id INTO v_log_id;

    RETURN v_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_deployment_event(text, uuid, uuid, boolean, text, text, uuid, inet, text, uuid, inet, text) TO authenticated;

-- ============================================================================
-- RPC FUNCTION 6 (NEW): request_production_rollback
-- Request rollback (immediate for test, needs approval for production)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.request_production_rollback(
    p_version_release_id uuid,
    p_company_id uuid,
    p_rollback_reason text,
    p_initiator_ip inet DEFAULT NULL
)
RETURNS TABLE (
    approval_id uuid,
    company_id uuid,
    approval_status text,
    requires_approval boolean,
    message text
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_company_record public.companies%ROWTYPE;
    v_version_record public.version_releases%ROWTYPE;
    v_approval_id uuid;
    v_approval_status text;
BEGIN
    -- Check if caller is super_admin
    v_user_id := auth.uid();
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_user_id AND role = 'super_admin') THEN
        RAISE EXCEPTION 'Only super admins can request rollback.';
    END IF;

    -- Validate rollback reason (MANDATORY)
    IF p_rollback_reason IS NULL OR trim(p_rollback_reason) = '' THEN
        RAISE EXCEPTION 'Rollback reason is mandatory and cannot be empty.';
    END IF;

    -- Get company and version info
    SELECT * INTO v_company_record FROM public.companies WHERE id = p_company_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Company not found.';
    END IF;

    SELECT * INTO v_version_record FROM public.version_releases WHERE id = p_version_release_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Version release not found.';
    END IF;

    -- For TEST companies: Execute immediately without approval
    IF v_company_record.is_test_company THEN
        -- Execute rollback for test company
        PERFORM public.execute_rollback_with_audit(
            p_version_release_id,
            p_company_id,
            p_rollback_reason,
            v_user_id,
            p_initiator_ip
        );

        RETURN QUERY
        SELECT
            gen_random_uuid()::uuid,
            p_company_id::uuid,
            'executed'::text,
            false::boolean,
            'Rollback executed immediately for test company.'::text;

    -- For PRODUCTION companies: Require approval
    ELSE
        -- Create approval request
        INSERT INTO public.deployment_rollback_approvals (
            version_release_id,
            company_id,
            requested_by,
            requested_by_ip,
            rollback_reason,
            request_from_version,
            request_to_version,
            expires_at
        ) VALUES (
            p_version_release_id,
            p_company_id,
            v_user_id,
            p_initiator_ip,
            p_rollback_reason,
            v_company_record.current_app_version,
            (
                SELECT version FROM public.version_releases
                WHERE created_at < v_version_record.created_at
                  AND status = 'live'
                ORDER BY created_at DESC
                LIMIT 1
            ),
            now() + interval '1 hour'
        ) RETURNING id INTO v_approval_id;

        -- Log rollback request
        PERFORM public.log_deployment_event(
            'rollback_requested',
            p_version_release_id,
            p_company_id,
            v_company_record.is_test_company,
            v_company_record.current_app_version,
            (
                SELECT version FROM public.version_releases
                WHERE created_at < v_version_record.created_at
                  AND status = 'live'
                ORDER BY created_at DESC
                LIMIT 1
            ),
            v_user_id,
            p_initiator_ip,
            p_rollback_reason,
            NULL,
            NULL,
            'pending'
        );

        RETURN QUERY
        SELECT
            v_approval_id::uuid,
            p_company_id::uuid,
            'pending'::text,
            true::boolean,
            format('Rollback request created. Waiting for approval from another super admin. Request expires at %s.',
                   (now() + interval '1 hour')::timestamp)::text;
    END IF;

END;
$$;

GRANT EXECUTE ON FUNCTION public.request_production_rollback(uuid, uuid, text, inet) TO authenticated;

-- ============================================================================
-- RPC FUNCTION 7 (NEW): approve_production_rollback
-- Second super_admin approves production rollback
-- ============================================================================

CREATE OR REPLACE FUNCTION public.approve_production_rollback(
    p_approval_id uuid,
    p_approver_ip inet DEFAULT NULL
)
RETURNS TABLE (
    approval_id uuid,
    company_id uuid,
    status text,
    message text
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_approval_record public.deployment_rollback_approvals%ROWTYPE;
    v_version_record public.version_releases%ROWTYPE;
BEGIN
    -- Check if caller is super_admin
    v_user_id := auth.uid();
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_user_id AND role = 'super_admin') THEN
        RAISE EXCEPTION 'Only super admins can approve rollbacks.';
    END IF;

    -- Get approval request
    SELECT * INTO v_approval_record FROM public.deployment_rollback_approvals WHERE id = p_approval_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Approval request not found.';
    END IF;

    -- Check if approval is still valid
    IF v_approval_record.expires_at < now() THEN
        UPDATE public.deployment_rollback_approvals
        SET approval_status = 'expired'
        WHERE id = p_approval_id;
        RAISE EXCEPTION 'Approval request has expired.';
    END IF;

    -- Check if already processed
    IF v_approval_record.approval_status != 'pending' THEN
        RAISE EXCEPTION 'Approval request already processed (%).', v_approval_record.approval_status;
    END IF;

    -- Prevent self-approval (must be different super_admin)
    IF v_approval_record.requested_by = v_user_id THEN
        RAISE EXCEPTION 'Approver must be a different super admin than the requester.';
    END IF;

    -- Execute rollback
    PERFORM public.execute_rollback_with_audit(
        v_approval_record.version_release_id,
        v_approval_record.company_id,
        v_approval_record.rollback_reason,
        v_user_id,
        p_approver_ip,
        v_approval_record.requested_by
    );

    -- Update approval status
    UPDATE public.deployment_rollback_approvals
    SET
        approval_status = 'approved',
        approved_by = v_user_id,
        approved_by_ip = p_approver_ip,
        approved_at = now()
    WHERE id = p_approval_id;

    -- Log approval
    SELECT * INTO v_version_record FROM public.version_releases WHERE id = v_approval_record.version_release_id;
    PERFORM public.log_deployment_event(
        'rollback_approved',
        v_approval_record.version_release_id,
        v_approval_record.company_id,
        false,
        v_approval_record.request_from_version,
        v_approval_record.request_to_version,
        v_approval_record.requested_by,
        v_approval_record.requested_by_ip,
        v_approval_record.rollback_reason,
        v_user_id,
        p_approver_ip,
        'completed'
    );

    RETURN QUERY
    SELECT
        p_approval_id::uuid,
        v_approval_record.company_id::uuid,
        'approved'::text,
        'Rollback approved and executed.'::text;

END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_production_rollback(uuid, inet) TO authenticated;

-- ============================================================================
-- RPC FUNCTION 8 (NEW): deny_production_rollback
-- Second super_admin denies production rollback request
-- ============================================================================

CREATE OR REPLACE FUNCTION public.deny_production_rollback(
    p_approval_id uuid,
    p_denial_reason text,
    p_denier_ip inet DEFAULT NULL
)
RETURNS TABLE (
    approval_id uuid,
    company_id uuid,
    status text,
    message text
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_approval_record public.deployment_rollback_approvals%ROWTYPE;
BEGIN
    -- Check if caller is super_admin
    v_user_id := auth.uid();
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_user_id AND role = 'super_admin') THEN
        RAISE EXCEPTION 'Only super admins can deny rollbacks.';
    END IF;

    -- Get approval request
    SELECT * INTO v_approval_record FROM public.deployment_rollback_approvals WHERE id = p_approval_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Approval request not found.';
    END IF;

    -- Check if still pending
    IF v_approval_record.approval_status != 'pending' THEN
        RAISE EXCEPTION 'Approval request already processed (%).', v_approval_record.approval_status;
    END IF;

    -- Update approval status
    UPDATE public.deployment_rollback_approvals
    SET
        approval_status = 'denied',
        approved_by = v_user_id,
        approved_by_ip = p_denier_ip,
        approval_status = 'denied',
        denial_reason = p_denial_reason,
        approved_at = now()
    WHERE id = p_approval_id;

    -- Log denial
    PERFORM public.log_deployment_event(
        'rollback_denied',
        v_approval_record.version_release_id,
        v_approval_record.company_id,
        false,
        v_approval_record.request_from_version,
        v_approval_record.request_to_version,
        v_approval_record.requested_by,
        v_approval_record.requested_by_ip,
        p_denial_reason,
        v_user_id,
        p_denier_ip,
        'completed'
    );

    RETURN QUERY
    SELECT
        p_approval_id::uuid,
        v_approval_record.company_id::uuid,
        'denied'::text,
        'Rollback request denied.'::text;

END;
$$;

GRANT EXECUTE ON FUNCTION public.deny_production_rollback(uuid, text, inet) TO authenticated;

-- ============================================================================
-- HELPER FUNCTION: execute_rollback_with_audit (Internal)
-- Actually execute the rollback and log comprehensive audit trail
-- ============================================================================

CREATE OR REPLACE FUNCTION public.execute_rollback_with_audit(
    p_version_release_id uuid,
    p_company_id uuid,
    p_rollback_reason text,
    p_executed_by uuid,
    p_executed_by_ip inet,
    p_requested_by uuid DEFAULT NULL
)
RETURNS TABLE (
    rollback_id uuid,
    company_id uuid,
    status text
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_record public.companies%ROWTYPE;
    v_current_version record;
    v_previous_version record;
    v_log_id uuid;
BEGIN
    -- Get company info
    SELECT * INTO v_company_record FROM public.companies WHERE id = p_company_id;

    -- Get current version
    SELECT * INTO v_current_version FROM public.version_releases WHERE id = p_version_release_id;

    -- Find previous version
    SELECT * INTO v_previous_version
    FROM public.version_releases
    WHERE created_at < v_current_version.created_at
      AND status = 'live'
    ORDER BY created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No previous version found to rollback to.';
    END IF;

    -- Create snapshot before rollback
    INSERT INTO public.pre_version_snapshots (
        version_release_id,
        company_id,
        previous_app_version,
        previous_release_id,
        snapshot_metadata,
        created_by
    ) VALUES (
        p_version_release_id,
        p_company_id,
        v_company_record.current_app_version,
        v_previous_version.id,
        jsonb_build_object(
            'rollback_reason', p_rollback_reason,
            'requested_by', COALESCE(p_requested_by::text, 'N/A'),
            'executed_by', p_executed_by::text,
            'timestamp', now()::text
        ),
        p_executed_by
    );

    -- Update deployment status
    UPDATE public.version_release_deployments
    SET
        deployment_status = 'rolled_back',
        rolled_back_at = now(),
        rolled_back_by = p_executed_by,
        rollback_reason = p_rollback_reason
    WHERE version_release_id = p_version_release_id
      AND company_id = p_company_id;

    -- ONLY update app version - DATA STAYS UNTOUCHED
    UPDATE public.companies
    SET
        current_app_version = v_previous_version.version,
        last_version_update_at = now()
    WHERE id = p_company_id;

    -- Log COMPREHENSIVE audit trail
    v_log_id := public.log_deployment_event(
        'rollback_executed',
        p_version_release_id,
        p_company_id,
        v_company_record.is_test_company,
        v_current_version.version,
        v_previous_version.version,
        p_executed_by,
        p_executed_by_ip,
        p_rollback_reason,
        p_executed_by,
        p_executed_by_ip,
        'completed'
    );

    RETURN QUERY
    SELECT
        v_log_id::uuid,
        p_company_id::uuid,
        'executed'::text;

END;
$$;

GRANT EXECUTE ON FUNCTION public.execute_rollback_with_audit(uuid, uuid, text, uuid, inet, uuid) TO authenticated;

-- ============================================================================
-- RPC FUNCTION 9 (NEW): get_deployment_audit_log
-- Get comprehensive audit log with filtering
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_deployment_audit_log(
    p_limit integer DEFAULT 100,
    p_event_type text DEFAULT NULL,
    p_company_id uuid DEFAULT NULL,
    p_version_id uuid DEFAULT NULL,
    p_days_back integer DEFAULT 30
)
RETURNS TABLE (
    log_id uuid,
    event_type text,
    company_name text,
    from_version text,
    to_version text,
    is_test text,
    rollback_reason text,
    initiated_by_name text,
    initiated_by_ip text,
    initiated_at timestamptz,
    approved_by_name text,
    approved_by_ip text,
    approved_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Check if caller is super_admin
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin') THEN
        RAISE EXCEPTION 'Only super admins can view audit logs.';
    END IF;

    RETURN QUERY
    SELECT
        dal.id::uuid,
        dal.event_type::text,
        c.name::text,
        dal.from_version::text,
        dal.to_version::text,
        CASE WHEN dal.is_test_company THEN 'Test' ELSE 'Production' END::text,
        dal.rollback_reason::text,
        COALESCE(p1.full_name, 'Unknown')::text,
        COALESCE(dal.initiated_by_ip::text, 'N/A')::text,
        dal.initiated_at::timestamptz,
        COALESCE(p2.full_name, 'N/A')::text,
        COALESCE(dal.approved_by_ip::text, 'N/A')::text,
        dal.approved_at::timestamptz
    FROM public.deployment_audit_log dal
    JOIN public.companies c ON dal.company_id = c.id
    LEFT JOIN public.profiles p1 ON dal.initiated_by = p1.user_id
    LEFT JOIN public.profiles p2 ON dal.approved_by = p2.user_id
    WHERE
        (p_event_type IS NULL OR dal.event_type = p_event_type)
        AND (p_company_id IS NULL OR dal.company_id = p_company_id)
        AND (p_version_id IS NULL OR dal.version_release_id = p_version_id)
        AND dal.created_at > now() - (p_days_back || ' days')::interval
    ORDER BY dal.created_at DESC
    LIMIT p_limit;

END;
$$;

GRANT EXECUTE ON FUNCTION public.get_deployment_audit_log(integer, text, uuid, uuid, integer) TO authenticated;

-- ============================================================================
-- RPC FUNCTION 10 (NEW): get_pending_rollback_approvals
-- Get list of pending rollback approvals for super_admin review
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_pending_rollback_approvals()
RETURNS TABLE (
    approval_id uuid,
    company_name text,
    requested_by_name text,
    from_version text,
    to_version text,
    rollback_reason text,
    requested_at timestamptz,
    expires_at timestamptz,
    time_remaining text
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Check if caller is super_admin
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin') THEN
        RAISE EXCEPTION 'Only super admins can view approval requests.';
    END IF;

    RETURN QUERY
    SELECT
        dra.id::uuid,
        c.name::text,
        COALESCE(p.full_name, 'Unknown')::text,
        dra.request_from_version::text,
        dra.request_to_version::text,
        dra.rollback_reason::text,
        dra.requested_at::timestamptz,
        dra.expires_at::timestamptz,
        CASE
            WHEN dra.expires_at < now() THEN 'EXPIRED'
            ELSE concat(
                EXTRACT(HOUR FROM (dra.expires_at - now()))::integer, 'h ',
                EXTRACT(MINUTE FROM (dra.expires_at - now()))::integer, 'm'
            )
        END::text
    FROM public.deployment_rollback_approvals dra
    JOIN public.companies c ON dra.company_id = c.id
    LEFT JOIN public.profiles p ON dra.requested_by = p.user_id
    WHERE dra.approval_status = 'pending'
      AND dra.expires_at > now()
    ORDER BY dra.requested_at DESC;

END;
$$;

GRANT EXECUTE ON FUNCTION public.get_pending_rollback_approvals() TO authenticated;

-- ============================================================================
-- SAFETY COMMENTS
-- ============================================================================

COMMENT ON FUNCTION public.deploy_version_to_companies IS
'Deploys app version to companies. ONLY updates current_app_version column. Customer data is NOT affected. Logged to deployment_audit_log.';

COMMENT ON FUNCTION public.rollback_version_for_companies IS
'DEPRECATED: Use request_production_rollback() instead. Rollbacks app version for companies. ONLY reverts current_app_version. Customer data remains immutable and untouched.';

COMMENT ON FUNCTION public.advance_deployment_stage IS
'Advances deployment stage workflow: test -> staging -> production. Tracks stage progression, not data.';

COMMENT ON FUNCTION public.get_deployment_history IS
'Returns deployment and rollback audit trail for compliance and debugging.';

COMMENT ON FUNCTION public.get_company_version_status IS
'Returns current version status and availability of previous versions for rollback.';

COMMENT ON FUNCTION public.request_production_rollback IS
'Request rollback of app version. Test companies: immediate execution. Production companies: creates approval request requiring second super_admin approval. Reason is MANDATORY. Logs full audit trail with IP address.';

COMMENT ON FUNCTION public.approve_production_rollback IS
'Approve pending rollback request (production only). Must be different super_admin than requester. Executes rollback and logs approval details.';

COMMENT ON FUNCTION public.deny_production_rollback IS
'Deny pending rollback request with denial reason. Logs denial for audit trail.';

COMMENT ON FUNCTION public.execute_rollback_with_audit IS
'Internal function: Execute rollback and create comprehensive audit trail. ONLY updates app version, customer data untouched.';

COMMENT ON FUNCTION public.get_deployment_audit_log IS
'Get comprehensive audit log of all deployment/rollback events with user, IP, reason, and timestamps.';

COMMENT ON FUNCTION public.get_pending_rollback_approvals IS
'Get list of pending production rollback approval requests for super_admin review.';
