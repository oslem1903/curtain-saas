-- ============================================================================
-- CANARY RELEASE SYSTEM
-- Graduated rollout with health monitoring and automatic rollback
-- ============================================================================

-- ============================================================================
-- STEP 1: DEPLOYMENT_CANARY_CONFIG TABLE
-- Configuration for canary release strategy
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.deployment_canary_config (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version_release_id uuid NOT NULL UNIQUE REFERENCES public.version_releases(id) ON DELETE CASCADE,

    -- Canary strategy
    canary_enabled boolean DEFAULT true,
    strategy_type text DEFAULT 'graduated' CHECK (strategy_type IN ('graduated', 'manual', 'abtest')),

    -- Error threshold (%)
    error_threshold_percentage integer DEFAULT 5 CHECK (error_threshold_percentage > 0 AND error_threshold_percentage <= 100),

    -- Health check interval (seconds)
    health_check_interval_seconds integer DEFAULT 300,

    -- Auto-rollback on health failure
    auto_rollback_enabled boolean DEFAULT true,
    auto_rollback_error_threshold integer DEFAULT 10 CHECK (auto_rollback_error_threshold > 0),

    -- Current stage
    current_stage text DEFAULT 'test' CHECK (current_stage IN ('test', 'early_adopters', 'ten_percent', 'twenty_five_percent', 'fifty_percent', 'full_rollout', 'completed')),
    current_stage_status text DEFAULT 'pending' CHECK (current_stage_status IN ('pending', 'in_progress', 'monitoring', 'paused', 'completed', 'rolled_back')),

    -- Timeline
    started_at timestamptz,
    current_stage_started_at timestamptz,
    completed_at timestamptz,
    paused_at timestamptz,
    pause_reason text,

    -- Tracking
    created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canary_version ON public.deployment_canary_config(version_release_id);
CREATE INDEX IF NOT EXISTS idx_canary_enabled ON public.deployment_canary_config(canary_enabled);
CREATE INDEX IF NOT EXISTS idx_canary_stage ON public.deployment_canary_config(current_stage);
CREATE INDEX IF NOT EXISTS idx_canary_created ON public.deployment_canary_config(created_at DESC);

COMMENT ON TABLE public.deployment_canary_config IS
'Canary release configuration. Controls graduated rollout strategy, error thresholds, and health monitoring.';

-- ============================================================================
-- STEP 2: DEPLOYMENT_CANARY_STAGES TABLE
-- Tracks each stage of canary release
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.deployment_canary_stages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    canary_config_id uuid NOT NULL REFERENCES public.deployment_canary_config(id) ON DELETE CASCADE,
    version_release_id uuid NOT NULL REFERENCES public.version_releases(id) ON DELETE CASCADE,

    -- Stage info
    stage_name text NOT NULL CHECK (stage_name IN ('test', 'early_adopters', 'ten_percent', 'twenty_five_percent', 'fifty_percent', 'full_rollout')),
    stage_order integer NOT NULL,
    target_company_count integer,
    target_rollout_percentage integer,

    -- Progress
    stage_status text NOT NULL DEFAULT 'pending' CHECK (stage_status IN ('pending', 'in_progress', 'monitoring', 'completed', 'failed', 'rolled_back')),
    companies_targeted integer DEFAULT 0,
    companies_updated integer DEFAULT 0,
    companies_waiting integer DEFAULT 0,
    companies_failed integer DEFAULT 0,
    companies_rolled_back integer DEFAULT 0,

    -- Health metrics
    error_count integer DEFAULT 0,
    error_rate_percentage decimal(5, 2) DEFAULT 0,
    is_healthy boolean DEFAULT true,

    -- Timeline
    scheduled_at timestamptz,
    started_at timestamptz,
    completed_at timestamptz,
    monitoring_until timestamptz,

    -- Metadata
    company_ids jsonb DEFAULT '[]'::jsonb,
    stage_metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_canary_stages_config ON public.deployment_canary_stages(canary_config_id);
CREATE INDEX IF NOT EXISTS idx_canary_stages_version ON public.deployment_canary_stages(version_release_id);
CREATE INDEX IF NOT EXISTS idx_canary_stages_name ON public.deployment_canary_stages(stage_name);
CREATE INDEX IF NOT EXISTS idx_canary_stages_status ON public.deployment_canary_stages(stage_status);
CREATE INDEX IF NOT EXISTS idx_canary_stages_created ON public.deployment_canary_stages(created_at DESC);

COMMENT ON TABLE public.deployment_canary_stages IS
'Tracks each canary release stage with progress and health metrics.';

-- ============================================================================
-- STEP 3: DEPLOYMENT_HEALTH_METRICS TABLE
-- Health monitoring per company per version
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.deployment_health_metrics (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version_release_id uuid NOT NULL REFERENCES public.version_releases(id) ON DELETE CASCADE,
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,

    -- Version info
    deployed_version text NOT NULL,

    -- Health indicators
    error_count integer DEFAULT 0,
    warning_count integer DEFAULT 0,
    successful_requests integer DEFAULT 0,

    -- Calculated metrics
    error_rate_percentage decimal(5, 2) DEFAULT 0,
    is_healthy boolean DEFAULT true,
    health_status text DEFAULT 'good' CHECK (health_status IN ('good', 'warning', 'critical')),

    -- Performance
    avg_response_time_ms integer,
    p95_response_time_ms integer,
    p99_response_time_ms integer,

    -- Last check
    last_checked_at timestamptz,

    -- Timeline
    monitoring_since timestamptz DEFAULT now(),
    monitoring_until timestamptz,

    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_metrics_version ON public.deployment_health_metrics(version_release_id);
CREATE INDEX IF NOT EXISTS idx_metrics_company ON public.deployment_health_metrics(company_id);
CREATE INDEX IF NOT EXISTS idx_metrics_health ON public.deployment_health_metrics(health_status);
CREATE INDEX IF NOT EXISTS idx_metrics_checked ON public.deployment_health_metrics(last_checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_metrics_created ON public.deployment_health_metrics(created_at DESC);

COMMENT ON TABLE public.deployment_health_metrics IS
'Health metrics per company per version. Tracks errors, warnings, performance. Used for canary monitoring and auto-rollback decisions.';

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

ALTER TABLE public.deployment_canary_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deployment_canary_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deployment_health_metrics ENABLE ROW LEVEL SECURITY;

CREATE POLICY canary_config_super_admin ON public.deployment_canary_config
FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin')
);

CREATE POLICY canary_stages_super_admin ON public.deployment_canary_stages
FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin')
);

CREATE POLICY health_metrics_super_admin ON public.deployment_health_metrics
FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin')
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.deployment_canary_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deployment_canary_stages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deployment_health_metrics TO authenticated;

-- ============================================================================
-- RPC FUNCTION 1: start_canary_release
-- Initialize canary release with configuration
-- ============================================================================

CREATE OR REPLACE FUNCTION public.start_canary_release(
    p_version_release_id uuid,
    p_error_threshold_percentage integer DEFAULT 5,
    p_auto_rollback_enabled boolean DEFAULT true,
    p_initiated_by uuid DEFAULT NULL
)
RETURNS TABLE (
    canary_config_id uuid,
    version text,
    status text,
    message text
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_version_record public.version_releases%ROWTYPE;
    v_canary_id uuid;
    v_test_company_ids uuid[];
BEGIN
    -- Check if caller is super_admin
    v_user_id := COALESCE(p_initiated_by, auth.uid());
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_user_id AND role = 'super_admin') THEN
        RAISE EXCEPTION 'Only super admins can start canary releases.';
    END IF;

    -- Validate version
    SELECT * INTO v_version_record FROM public.version_releases WHERE id = p_version_release_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Version release not found.';
    END IF;

    -- Check if canary already exists for this version
    IF EXISTS (SELECT 1 FROM public.deployment_canary_config WHERE version_release_id = p_version_release_id) THEN
        RAISE EXCEPTION 'Canary release already exists for this version.';
    END IF;

    -- Create canary config
    INSERT INTO public.deployment_canary_config (
        version_release_id,
        error_threshold_percentage,
        auto_rollback_enabled,
        created_by,
        started_at
    ) VALUES (
        p_version_release_id,
        p_error_threshold_percentage,
        p_auto_rollback_enabled,
        v_user_id,
        now()
    ) RETURNING id INTO v_canary_id;

    -- Create stages
    -- Stage 1: Test companies
    INSERT INTO public.deployment_canary_stages (
        canary_config_id,
        version_release_id,
        stage_name,
        stage_order,
        target_company_count,
        target_rollout_percentage,
        company_ids
    ) VALUES (
        v_canary_id,
        p_version_release_id,
        'test',
        1,
        (SELECT COUNT(*) FROM public.companies WHERE is_test_company = true AND is_active = true),
        0,
        (SELECT jsonb_agg(id) FROM public.companies WHERE is_test_company = true AND is_active = true)
    );

    -- Stage 2: Early adopters (5 selected companies)
    INSERT INTO public.deployment_canary_stages (
        canary_config_id,
        version_release_id,
        stage_name,
        stage_order,
        target_company_count,
        target_rollout_percentage,
        company_ids
    ) VALUES (
        v_canary_id,
        p_version_release_id,
        'early_adopters',
        2,
        5,
        0,
        '[]'::jsonb
    );

    -- Stage 3: 10%
    INSERT INTO public.deployment_canary_stages (
        canary_config_id,
        version_release_id,
        stage_name,
        stage_order,
        target_company_count,
        target_rollout_percentage
    ) VALUES (
        v_canary_id,
        p_version_release_id,
        'ten_percent',
        3,
        NULL,
        10
    );

    -- Stage 4: 25%
    INSERT INTO public.deployment_canary_stages (
        canary_config_id,
        version_release_id,
        stage_name,
        stage_order,
        target_company_count,
        target_rollout_percentage
    ) VALUES (
        v_canary_id,
        p_version_release_id,
        'ten_percent',
        4,
        NULL,
        25
    );

    -- Stage 5: 50%
    INSERT INTO public.deployment_canary_stages (
        canary_config_id,
        version_release_id,
        stage_name,
        stage_order,
        target_company_count,
        target_rollout_percentage
    ) VALUES (
        v_canary_id,
        p_version_release_id,
        'fifty_percent',
        5,
        NULL,
        50
    );

    -- Stage 6: Full rollout
    INSERT INTO public.deployment_canary_stages (
        canary_config_id,
        version_release_id,
        stage_name,
        stage_order,
        target_company_count,
        target_rollout_percentage
    ) VALUES (
        v_canary_id,
        p_version_release_id,
        'full_rollout',
        6,
        NULL,
        100
    );

    RETURN QUERY
    SELECT
        v_canary_id::uuid,
        v_version_record.version::text,
        'initialized'::text,
        'Canary release initialized. Ready to deploy to test companies.'::text;

END;
$$;

GRANT EXECUTE ON FUNCTION public.start_canary_release(uuid, integer, boolean, uuid) TO authenticated;

-- ============================================================================
-- RPC FUNCTION 2: deploy_canary_stage
-- Deploy current stage of canary release
-- ============================================================================

CREATE OR REPLACE FUNCTION public.deploy_canary_stage(
    p_canary_config_id uuid,
    p_deployed_by uuid DEFAULT NULL
)
RETURNS TABLE (
    stage_id uuid,
    stage_name text,
    companies_deployed integer,
    status text,
    message text
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_canary_record public.deployment_canary_config%ROWTYPE;
    v_stage_record public.deployment_canary_stages%ROWTYPE;
    v_target_companies uuid[];
    v_deployed_count integer := 0;
    v_company_id uuid;
BEGIN
    -- Check if caller is super_admin
    v_user_id := COALESCE(p_deployed_by, auth.uid());
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_user_id AND role = 'super_admin') THEN
        RAISE EXCEPTION 'Only super admins can deploy canary stages.';
    END IF;

    -- Get canary config
    SELECT * INTO v_canary_record FROM public.deployment_canary_config WHERE id = p_canary_config_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Canary config not found.';
    END IF;

    -- Get current stage
    SELECT * INTO v_stage_record
    FROM public.deployment_canary_stages
    WHERE canary_config_id = p_canary_config_id
      AND stage_status = 'pending'
    ORDER BY stage_order
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No pending stage to deploy.';
    END IF;

    -- Get target companies for this stage
    IF v_stage_record.stage_name = 'test' THEN
        -- Deploy to all test companies
        SELECT array_agg(id) INTO v_target_companies
        FROM public.companies
        WHERE is_test_company = true AND is_active = true;

    ELSIF v_stage_record.stage_name = 'early_adopters' THEN
        -- Use selected early adopter companies (from company_ids or pre-selected)
        v_target_companies := CASE
            WHEN v_stage_record.company_ids != '[]'::jsonb
            THEN (SELECT array_agg(elem::uuid) FROM jsonb_array_elements_text(v_stage_record.company_ids) AS elem)
            ELSE ARRAY[]::uuid[]
        END;

        IF array_length(v_target_companies, 1) IS NULL OR array_length(v_target_companies, 1) = 0 THEN
            RAISE EXCEPTION 'Early adopter companies not selected. Use update_canary_stage_companies() first.';
        END IF;

    ELSE
        -- For percentage-based stages, calculate target companies
        SELECT CEIL(COUNT(*) * v_stage_record.target_rollout_percentage / 100.0)::integer INTO v_deployed_count
        FROM public.companies
        WHERE is_active = true AND NOT is_test_company;

        SELECT array_agg(id) INTO v_target_companies
        FROM (
            SELECT id FROM public.companies
            WHERE is_active = true AND NOT is_test_company
            ORDER BY random()
            LIMIT v_deployed_count
        ) subq;
    END IF;

    -- Deploy to target companies
    IF array_length(v_target_companies, 1) > 0 THEN
        FOREACH v_company_id IN ARRAY v_target_companies
        LOOP
            PERFORM public.deploy_version_to_companies(
                v_canary_record.version_release_id,
                ARRAY[v_company_id],
                'production',
                v_user_id
            );
            v_deployed_count := v_deployed_count + 1;
        END LOOP;
    END IF;

    -- Update stage status
    UPDATE public.deployment_canary_stages
    SET
        stage_status = 'in_progress',
        companies_updated = v_deployed_count,
        companies_targeted = COALESCE(array_length(v_target_companies, 1), 0),
        started_at = now(),
        monitoring_until = now() + interval '1 hour'
    WHERE id = v_stage_record.id;

    -- Update canary config
    UPDATE public.deployment_canary_config
    SET
        current_stage_started_at = now()
    WHERE id = p_canary_config_id;

    RETURN QUERY
    SELECT
        v_stage_record.id::uuid,
        v_stage_record.stage_name::text,
        v_deployed_count::integer,
        'deployed'::text,
        format('Stage %s deployed to %s companies. Monitoring for 1 hour.', v_stage_record.stage_name, v_deployed_count)::text;

END;
$$;

GRANT EXECUTE ON FUNCTION public.deploy_canary_stage(uuid, uuid) TO authenticated;

-- ============================================================================
-- RPC FUNCTION 3: get_canary_progress
-- Get detailed progress of current canary release
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_canary_progress(
    p_version_release_id uuid
)
RETURNS TABLE (
    canary_id uuid,
    version text,
    current_stage text,
    stage_status text,
    companies_targeted integer,
    companies_updated integer,
    companies_failed integer,
    companies_rolled_back integer,
    error_rate_percentage decimal,
    is_healthy boolean,
    monitoring_until timestamptz,
    all_stages jsonb
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_canary_record public.deployment_canary_config%ROWTYPE;
    v_all_stages jsonb;
BEGIN
    -- Check if caller is super_admin
    v_user_id := auth.uid();
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_user_id AND role = 'super_admin') THEN
        RAISE EXCEPTION 'Only super admins can view canary progress.';
    END IF;

    -- Get canary config
    SELECT * INTO v_canary_record
    FROM public.deployment_canary_config
    WHERE version_release_id = p_version_release_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Canary release not found for this version.';
    END IF;

    -- Build all stages info
    SELECT jsonb_agg(
        jsonb_build_object(
            'stage_name', stage_name,
            'stage_order', stage_order,
            'status', stage_status,
            'companies_updated', companies_updated,
            'companies_failed', companies_failed,
            'error_rate', error_rate_percentage,
            'is_healthy', is_healthy
        ) ORDER BY stage_order
    ) INTO v_all_stages
    FROM public.deployment_canary_stages
    WHERE version_release_id = p_version_release_id;

    RETURN QUERY
    SELECT
        v_canary_record.id::uuid,
        (SELECT version FROM public.version_releases WHERE id = v_canary_record.version_release_id)::text,
        v_canary_record.current_stage::text,
        v_canary_record.current_stage_status::text,
        (SELECT companies_targeted FROM public.deployment_canary_stages
         WHERE canary_config_id = v_canary_record.id AND stage_name = v_canary_record.current_stage)::integer,
        (SELECT companies_updated FROM public.deployment_canary_stages
         WHERE canary_config_id = v_canary_record.id AND stage_name = v_canary_record.current_stage)::integer,
        (SELECT companies_failed FROM public.deployment_canary_stages
         WHERE canary_config_id = v_canary_record.id AND stage_name = v_canary_record.current_stage)::integer,
        (SELECT companies_rolled_back FROM public.deployment_canary_stages
         WHERE canary_config_id = v_canary_record.id AND stage_name = v_canary_record.current_stage)::integer,
        (SELECT error_rate_percentage FROM public.deployment_canary_stages
         WHERE canary_config_id = v_canary_record.id AND stage_name = v_canary_record.current_stage)::decimal,
        (SELECT is_healthy FROM public.deployment_canary_stages
         WHERE canary_config_id = v_canary_record.id AND stage_name = v_canary_record.current_stage)::boolean,
        (SELECT monitoring_until FROM public.deployment_canary_stages
         WHERE canary_config_id = v_canary_record.id AND stage_name = v_canary_record.current_stage)::timestamptz,
        v_all_stages::jsonb;

END;
$$;

GRANT EXECUTE ON FUNCTION public.get_canary_progress(uuid) TO authenticated;

-- ============================================================================
-- RPC FUNCTION 4: advance_canary_stage
-- Move to next stage after monitoring period
-- ============================================================================

CREATE OR REPLACE FUNCTION public.advance_canary_stage(
    p_canary_config_id uuid,
    p_advanced_by uuid DEFAULT NULL
)
RETURNS TABLE (
    config_id uuid,
    next_stage text,
    status text,
    message text
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
    v_canary_record public.deployment_canary_config%ROWTYPE;
    v_current_stage_record public.deployment_canary_stages%ROWTYPE;
    v_next_stage_record public.deployment_canary_stages%ROWTYPE;
BEGIN
    -- Check if caller is super_admin
    v_user_id := COALESCE(p_advanced_by, auth.uid());
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_user_id AND role = 'super_admin') THEN
        RAISE EXCEPTION 'Only super admins can advance canary stages.';
    END IF;

    -- Get canary config
    SELECT * INTO v_canary_record FROM public.deployment_canary_config WHERE id = p_canary_config_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Canary config not found.';
    END IF;

    -- Get current stage
    SELECT * INTO v_current_stage_record
    FROM public.deployment_canary_stages
    WHERE canary_config_id = p_canary_config_id
      AND stage_status = 'in_progress'
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No in-progress stage to advance from.';
    END IF;

    -- Get next stage
    SELECT * INTO v_next_stage_record
    FROM public.deployment_canary_stages
    WHERE canary_config_id = p_canary_config_id
      AND stage_order = v_current_stage_record.stage_order + 1
    LIMIT 1;

    IF NOT FOUND THEN
        -- Canary complete
        UPDATE public.deployment_canary_config
        SET
            current_stage = 'completed',
            current_stage_status = 'completed',
            completed_at = now()
        WHERE id = p_canary_config_id;

        RETURN QUERY
        SELECT
            p_canary_config_id::uuid,
            'completed'::text,
            'success'::text,
            'Canary release completed successfully.'::text;
    ELSE
        -- Move to next stage
        UPDATE public.deployment_canary_stages
        SET stage_status = 'completed', completed_at = now()
        WHERE id = v_current_stage_record.id;

        UPDATE public.deployment_canary_config
        SET
            current_stage = v_next_stage_record.stage_name,
            current_stage_status = 'pending'
        WHERE id = p_canary_config_id;

        RETURN QUERY
        SELECT
            p_canary_config_id::uuid,
            v_next_stage_record.stage_name::text,
            'pending'::text,
            format('Moved to next stage: %s. Ready to deploy.', v_next_stage_record.stage_name)::text;
    END IF;

END;
$$;

GRANT EXECUTE ON FUNCTION public.advance_canary_stage(uuid, uuid) TO authenticated;

-- ============================================================================
-- RPC FUNCTION 5: pause_canary_release
-- Pause canary release for investigation
-- ============================================================================

CREATE OR REPLACE FUNCTION public.pause_canary_release(
    p_canary_config_id uuid,
    p_pause_reason text,
    p_paused_by uuid DEFAULT NULL
)
RETURNS TABLE (
    config_id uuid,
    status text,
    message text
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
BEGIN
    -- Check if caller is super_admin
    v_user_id := COALESCE(p_paused_by, auth.uid());
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_user_id AND role = 'super_admin') THEN
        RAISE EXCEPTION 'Only super admins can pause canary releases.';
    END IF;

    UPDATE public.deployment_canary_config
    SET
        current_stage_status = 'paused',
        paused_at = now(),
        pause_reason = p_pause_reason
    WHERE id = p_canary_config_id;

    RETURN QUERY
    SELECT
        p_canary_config_id::uuid,
        'paused'::text,
        format('Canary release paused. Reason: %s', p_pause_reason)::text;

END;
$$;

GRANT EXECUTE ON FUNCTION public.pause_canary_release(uuid, text, uuid) TO authenticated;

-- ============================================================================
-- RPC FUNCTION 6: get_canary_history
-- Get deployment history with canary metrics
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_canary_history(
    p_limit integer DEFAULT 50
)
RETURNS TABLE (
    version text,
    deployment_date timestamptz,
    total_companies integer,
    companies_updated integer,
    companies_failed integer,
    companies_rolled_back integer,
    error_rate_percentage decimal,
    status text
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Check if caller is super_admin
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin') THEN
        RAISE EXCEPTION 'Only super admins can view canary history.';
    END IF;

    RETURN QUERY
    SELECT
        vr.version::text,
        dcc.created_at::timestamptz,
        (SELECT SUM(companies_targeted) FROM public.deployment_canary_stages WHERE canary_config_id = dcc.id)::integer,
        (SELECT SUM(companies_updated) FROM public.deployment_canary_stages WHERE canary_config_id = dcc.id)::integer,
        (SELECT SUM(companies_failed) FROM public.deployment_canary_stages WHERE canary_config_id = dcc.id)::integer,
        (SELECT SUM(companies_rolled_back) FROM public.deployment_canary_stages WHERE canary_config_id = dcc.id)::integer,
        (SELECT AVG(error_rate_percentage) FROM public.deployment_canary_stages WHERE canary_config_id = dcc.id)::decimal,
        dcc.current_stage_status::text
    FROM public.deployment_canary_config dcc
    JOIN public.version_releases vr ON dcc.version_release_id = vr.id
    ORDER BY dcc.created_at DESC
    LIMIT p_limit;

END;
$$;

GRANT EXECUTE ON FUNCTION public.get_canary_history(integer) TO authenticated;

-- ============================================================================
-- RPC FUNCTION 7: update_canary_stage_companies
-- Manually select companies for early_adopters stage
-- ============================================================================

CREATE OR REPLACE FUNCTION public.update_canary_stage_companies(
    p_stage_id uuid,
    p_company_ids uuid[],
    p_updated_by uuid DEFAULT NULL
)
RETURNS TABLE (
    stage_id uuid,
    company_count integer,
    status text
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
BEGIN
    -- Check if caller is super_admin
    v_user_id := COALESCE(p_updated_by, auth.uid());
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = v_user_id AND role = 'super_admin') THEN
        RAISE EXCEPTION 'Only super admins can update stage companies.';
    END IF;

    UPDATE public.deployment_canary_stages
    SET
        company_ids = jsonb_agg(elem),
        target_company_count = array_length(p_company_ids, 1)
    WHERE id = p_stage_id;

    RETURN QUERY
    SELECT
        p_stage_id::uuid,
        array_length(p_company_ids, 1)::integer,
        'updated'::text;

END;
$$;

GRANT EXECUTE ON FUNCTION public.update_canary_stage_companies(uuid, uuid[], uuid) TO authenticated;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON FUNCTION public.start_canary_release IS
'Initialize canary release with graduated rollout stages: test → early_adopters → 10% → 25% → 50% → 100%.';

COMMENT ON FUNCTION public.deploy_canary_stage IS
'Deploy current stage of canary release to target companies.';

COMMENT ON FUNCTION public.get_canary_progress IS
'Get real-time progress of canary release including error rates and health status.';

COMMENT ON FUNCTION public.advance_canary_stage IS
'Advance canary release to next stage after monitoring period.';

COMMENT ON FUNCTION public.pause_canary_release IS
'Pause canary release for investigation or troubleshooting.';

COMMENT ON FUNCTION public.get_canary_history IS
'Get historical data of all canary releases with success/failure metrics.';

COMMENT ON FUNCTION public.update_canary_stage_companies IS
'Manually select companies for early_adopters stage of canary release.';
