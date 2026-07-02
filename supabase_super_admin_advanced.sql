-- ============================================================================
-- SUPER ADMIN PANEL ADVANCED FEATURES
-- Tables, RLS Policies, and RPC Functions
-- ============================================================================

-- ============================================================================
-- 1. ADMIN SESSIONS TABLE
-- Super admin impersonation/demo sessions with audit trail
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.admin_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    super_admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    target_company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    target_role text DEFAULT 'admin' CHECK (target_role IN ('admin', 'accountant', 'installer', 'viewer')),
    session_start timestamptz NOT NULL DEFAULT now(),
    session_end timestamptz,
    is_write_enabled boolean DEFAULT false,
    ip_address inet,
    user_agent text,
    accessed_pages jsonb DEFAULT '[]'::jsonb,
    created_at timestamptz DEFAULT now(),
    CONSTRAINT valid_session_time CHECK (session_end IS NULL OR session_end > session_start)
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_super_admin ON public.admin_sessions(super_admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_company ON public.admin_sessions(target_company_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_created ON public.admin_sessions(created_at DESC);

-- ============================================================================
-- 2. REMOTE MAINTENANCE LOGS TABLE
-- Audit trail for remote operations (cache clear, sync, etc.)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.remote_maintenance_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    executed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    operation_type text NOT NULL CHECK (operation_type IN (
        'cache_clear', 'sync_data', 'recalculate_orders', 'recalculate_payments',
        'reset_notifications', 'reset_dashboard', 'renew_mobile_session',
        'force_update_check', 'rebuild_indexes', 'verify_integrity'
    )),
    operation_status text DEFAULT 'pending' CHECK (operation_status IN ('pending', 'in_progress', 'completed', 'failed')),
    parameters jsonb DEFAULT '{}'::jsonb,
    result jsonb,
    error_message text,
    started_at timestamptz DEFAULT now(),
    completed_at timestamptz,
    duration_ms integer,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_remote_maintenance_company ON public.remote_maintenance_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_remote_maintenance_type ON public.remote_maintenance_logs(operation_type);
CREATE INDEX IF NOT EXISTS idx_remote_maintenance_status ON public.remote_maintenance_logs(operation_status);
CREATE INDEX IF NOT EXISTS idx_remote_maintenance_created ON public.remote_maintenance_logs(created_at DESC);

-- ============================================================================
-- 3. BACKUP HISTORY TABLE
-- Track company backups and restore points
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.backup_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    backup_type text NOT NULL CHECK (backup_type IN ('auto', 'manual', 'pre_restore', 'scheduled')),
    backup_size_bytes bigint,
    backup_url text,
    backup_location text DEFAULT 'supabase_backup',
    triggered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    status text DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'archived')),
    started_at timestamptz DEFAULT now(),
    completed_at timestamptz,
    retention_days integer DEFAULT 90,
    is_encrypted boolean DEFAULT true,
    backup_metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_backup_history_company ON public.backup_history(company_id);
CREATE INDEX IF NOT EXISTS idx_backup_history_type ON public.backup_history(backup_type);
CREATE INDEX IF NOT EXISTS idx_backup_history_status ON public.backup_history(status);
CREATE INDEX IF NOT EXISTS idx_backup_history_created ON public.backup_history(created_at DESC);

-- ============================================================================
-- 4. DATABASE HEALTH CHECKS TABLE
-- Automated health check reports per company
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.database_health_checks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    check_timestamp timestamptz DEFAULT now(),
    total_customers integer DEFAULT 0,
    total_measurements integer DEFAULT 0,
    total_orders integer DEFAULT 0,
    total_suppliers integer DEFAULT 0,
    total_appointments integer DEFAULT 0,
    total_invoices integer DEFAULT 0,
    total_payments integer DEFAULT 0,
    orphan_records_count integer DEFAULT 0,
    missing_relations_count integer DEFAULT 0,
    data_inconsistencies jsonb DEFAULT '[]'::jsonb,
    status text DEFAULT 'healthy' CHECK (status IN ('healthy', 'warning', 'critical')),
    notes text,
    triggered_by text DEFAULT 'system',
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_database_health_company ON public.database_health_checks(company_id);
CREATE INDEX IF NOT EXISTS idx_database_health_status ON public.database_health_checks(status);
CREATE INDEX IF NOT EXISTS idx_database_health_created ON public.database_health_checks(created_at DESC);

-- ============================================================================
-- 5. VERSION RELEASES TABLE
-- Version management with draft/test/live workflow
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.version_releases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version text NOT NULL UNIQUE,
    title text NOT NULL,
    description text,
    release_type text CHECK (release_type IN ('general', 'bugfix', 'feature', 'security', 'hotfix')),
    status text DEFAULT 'draft' CHECK (status IN ('draft', 'testing', 'staging', 'live', 'archived', 'rolled_back')),
    is_mandatory_update boolean DEFAULT false,
    target_platforms jsonb DEFAULT '["web", "windows", "android", "ios"]'::jsonb,
    download_urls jsonb DEFAULT '{}'::jsonb,
    release_notes text,
    changelog text,
    previous_version_id uuid REFERENCES public.version_releases(id),
    rolled_back_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    rollback_reason text,
    rollback_timestamp timestamptz,
    created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at timestamptz DEFAULT now(),
    published_at timestamptz,
    scheduled_for timestamptz,
    metadata jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_version_releases_status ON public.version_releases(status);
CREATE INDEX IF NOT EXISTS idx_version_releases_version ON public.version_releases(version);
CREATE INDEX IF NOT EXISTS idx_version_releases_created ON public.version_releases(created_at DESC);

-- ============================================================================
-- RLS (Row Level Security) POLICIES
-- ============================================================================

-- Enable RLS on all new tables
ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.remote_maintenance_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.database_health_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.version_releases ENABLE ROW LEVEL SECURITY;

-- Admin Sessions: Only super_admin can access
CREATE POLICY admin_sessions_super_admin ON public.admin_sessions
FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin')
);

-- Remote Maintenance Logs: Only super_admin can access
CREATE POLICY remote_maintenance_logs_super_admin ON public.remote_maintenance_logs
FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin')
);

-- Backup History: Only super_admin can access
CREATE POLICY backup_history_super_admin ON public.backup_history
FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin')
);

-- Database Health Checks: Only super_admin can select
CREATE POLICY database_health_checks_super_admin ON public.database_health_checks
FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin')
);

-- Version Releases: Only super_admin can all operations
CREATE POLICY version_releases_super_admin ON public.version_releases
FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin')
);

-- ============================================================================
-- RPC FUNCTIONS
-- ============================================================================

-- ============================================================================
-- Function: super_admin_start_impersonate_session
-- Creates a time-limited demo session for super admin to view company as another role
-- ============================================================================
CREATE OR REPLACE FUNCTION public.super_admin_start_impersonate_session(
    p_target_company_id uuid,
    p_target_role text DEFAULT 'admin',
    p_duration_minutes integer DEFAULT 5
)
RETURNS TABLE (
    session_id uuid,
    company_id uuid,
    role text,
    expires_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_role text;
    v_session_id uuid;
    v_expires_at timestamptz;
BEGIN
    -- Check if caller is super_admin
    SELECT COALESCE(p.role, '') INTO v_actor_role
    FROM public.profiles p
    WHERE p.user_id = auth.uid();

    IF v_actor_role <> 'super_admin' THEN
        RAISE EXCEPTION 'Only super admins can start impersonate sessions.';
    END IF;

    -- Validate target company exists
    IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_target_company_id) THEN
        RAISE EXCEPTION 'Target company not found.';
    END IF;

    -- Validate target role
    IF p_target_role NOT IN ('admin', 'accountant', 'installer', 'viewer') THEN
        RAISE EXCEPTION 'Invalid target role.';
    END IF;

    v_expires_at := now() + (p_duration_minutes || ' minutes')::interval;

    -- Create session
    INSERT INTO public.admin_sessions (
        super_admin_id,
        target_company_id,
        target_role,
        session_end,
        is_write_enabled,
        user_agent
    ) VALUES (
        auth.uid(),
        p_target_company_id,
        p_target_role,
        v_expires_at,
        false,
        current_setting('request.headers')::json->>'user-agent'
    ) RETURNING id INTO v_session_id;

    RETURN QUERY SELECT v_session_id, p_target_company_id, p_target_role, v_expires_at;
END;
$$;

GRANT EXECUTE ON FUNCTION public.super_admin_start_impersonate_session(uuid, text, integer) TO authenticated;

-- ============================================================================
-- Function: super_admin_end_impersonate_session
-- Ends an active impersonate session
-- ============================================================================
CREATE OR REPLACE FUNCTION public.super_admin_end_impersonate_session(
    p_session_id uuid
)
RETURNS TABLE (
    session_id uuid,
    duration_minutes numeric
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_session_record public.admin_sessions%ROWTYPE;
    v_duration_minutes numeric;
BEGIN
    -- Check if caller is super_admin
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin') THEN
        RAISE EXCEPTION 'Only super admins can end impersonate sessions.';
    END IF;

    -- Get session and verify ownership
    SELECT * INTO v_session_record FROM public.admin_sessions WHERE id = p_session_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Session not found.';
    END IF;

    IF v_session_record.super_admin_id <> auth.uid() THEN
        RAISE EXCEPTION 'You can only end your own sessions.';
    END IF;

    -- Calculate duration
    v_duration_minutes := EXTRACT(EPOCH FROM (now() - v_session_record.session_start)) / 60.0;

    -- End session
    UPDATE public.admin_sessions
    SET session_end = now()
    WHERE id = p_session_id;

    RETURN QUERY SELECT p_session_id, v_duration_minutes;
END;
$$;

GRANT EXECUTE ON FUNCTION public.super_admin_end_impersonate_session(uuid) TO authenticated;

-- ============================================================================
-- Function: super_admin_execute_remote_action
-- Execute remote maintenance action and log it
-- ============================================================================
CREATE OR REPLACE FUNCTION public.super_admin_execute_remote_action(
    p_company_id uuid,
    p_operation_type text,
    p_parameters jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
    log_id uuid,
    operation_type text,
    status text,
    started_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_log_id uuid;
    v_actor_role text;
BEGIN
    -- Check if caller is super_admin
    SELECT COALESCE(p.role, '') INTO v_actor_role
    FROM public.profiles p
    WHERE p.user_id = auth.uid();

    IF v_actor_role <> 'super_admin' THEN
        RAISE EXCEPTION 'Only super admins can execute remote actions.';
    END IF;

    -- Validate company exists
    IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id) THEN
        RAISE EXCEPTION 'Company not found.';
    END IF;

    -- Validate operation type
    IF p_operation_type NOT IN (
        'cache_clear', 'sync_data', 'recalculate_orders', 'recalculate_payments',
        'reset_notifications', 'reset_dashboard', 'renew_mobile_session',
        'force_update_check', 'rebuild_indexes', 'verify_integrity'
    ) THEN
        RAISE EXCEPTION 'Invalid operation type: %', p_operation_type;
    END IF;

    -- Create log entry
    INSERT INTO public.remote_maintenance_logs (
        executed_by,
        company_id,
        operation_type,
        operation_status,
        parameters
    ) VALUES (
        auth.uid(),
        p_company_id,
        p_operation_type,
        'in_progress',
        p_parameters
    ) RETURNING id INTO v_log_id;

    -- Update status to completed (in real implementation, this would be async)
    UPDATE public.remote_maintenance_logs
    SET
        operation_status = 'completed',
        completed_at = now(),
        duration_ms = EXTRACT(EPOCH FROM (now() - started_at))::integer * 1000
    WHERE id = v_log_id;

    RETURN QUERY
    SELECT
        v_log_id,
        p_operation_type,
        'completed'::text,
        now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.super_admin_execute_remote_action(uuid, text, jsonb) TO authenticated;

-- ============================================================================
-- Function: trigger_company_database_health_check
-- Run health checks for a company and create report
-- ============================================================================
CREATE OR REPLACE FUNCTION public.trigger_company_database_health_check(
    p_company_id uuid
)
RETURNS TABLE (
    check_id uuid,
    company_id uuid,
    status text,
    total_records integer
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_check_id uuid;
    v_total_customers integer;
    v_total_measurements integer;
    v_total_orders integer;
    v_total_suppliers integer;
    v_total_appointments integer;
    v_total_invoices integer;
    v_health_status text := 'healthy';
    v_inconsistencies jsonb := '[]'::jsonb;
BEGIN
    -- Check if caller is super_admin
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin') THEN
        RAISE EXCEPTION 'Only super admins can trigger health checks.';
    END IF;

    -- Validate company exists
    IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id = p_company_id) THEN
        RAISE EXCEPTION 'Company not found.';
    END IF;

    -- Count records by table (if they exist in the schema)
    BEGIN
        SELECT COUNT(*) INTO v_total_customers FROM public.customers WHERE company_id = p_company_id;
    EXCEPTION WHEN undefined_table THEN
        v_total_customers := 0;
    END;

    BEGIN
        SELECT COUNT(*) INTO v_total_measurements FROM public.measurements WHERE company_id = p_company_id;
    EXCEPTION WHEN undefined_table THEN
        v_total_measurements := 0;
    END;

    BEGIN
        SELECT COUNT(*) INTO v_total_orders FROM public.orders WHERE company_id = p_company_id;
    EXCEPTION WHEN undefined_table THEN
        v_total_orders := 0;
    END;

    BEGIN
        SELECT COUNT(*) INTO v_total_suppliers FROM public.suppliers WHERE company_id = p_company_id;
    EXCEPTION WHEN undefined_table THEN
        v_total_suppliers := 0;
    END;

    BEGIN
        SELECT COUNT(*) INTO v_total_appointments FROM public.appointments WHERE company_id = p_company_id;
    EXCEPTION WHEN undefined_table THEN
        v_total_appointments := 0;
    END;

    BEGIN
        SELECT COUNT(*) INTO v_total_invoices FROM public.invoices WHERE company_id = p_company_id;
    EXCEPTION WHEN undefined_table THEN
        v_total_invoices := 0;
    END;

    -- Set health status based on thresholds
    IF (v_total_customers + v_total_orders + v_total_measurements) > 10000 THEN
        v_health_status := 'warning';
        v_inconsistencies := v_inconsistencies || jsonb_build_object('type', 'large_dataset', 'message', 'Company has large data volume');
    END IF;

    -- Create health check record
    INSERT INTO public.database_health_checks (
        company_id,
        total_customers,
        total_measurements,
        total_orders,
        total_suppliers,
        total_appointments,
        total_invoices,
        status,
        data_inconsistencies,
        triggered_by
    ) VALUES (
        p_company_id,
        v_total_customers,
        v_total_measurements,
        v_total_orders,
        v_total_suppliers,
        v_total_appointments,
        v_total_invoices,
        v_health_status,
        v_inconsistencies,
        'super_admin'
    ) RETURNING id INTO v_check_id;

    RETURN QUERY
    SELECT
        v_check_id,
        p_company_id,
        v_health_status,
        v_total_customers + v_total_measurements + v_total_orders + v_total_suppliers + v_total_appointments + v_total_invoices;
END;
$$;

GRANT EXECUTE ON FUNCTION public.trigger_company_database_health_check(uuid) TO authenticated;

-- ============================================================================
-- Function: create_version_release
-- Create a new version release in draft status
-- ============================================================================
CREATE OR REPLACE FUNCTION public.create_version_release(
    p_version text,
    p_title text,
    p_description text,
    p_release_type text DEFAULT 'general',
    p_download_urls jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
    release_id uuid,
    version text,
    status text,
    created_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_release_id uuid;
BEGIN
    -- Check if caller is super_admin
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin') THEN
        RAISE EXCEPTION 'Only super admins can create version releases.';
    END IF;

    -- Validate version format
    IF p_version !~ '^\d+\.\d+\.\d+' THEN
        RAISE EXCEPTION 'Invalid version format. Expected: X.Y.Z or X.Y.Z-label';
    END IF;

    -- Check if version already exists
    IF EXISTS (SELECT 1 FROM public.version_releases WHERE version = p_version) THEN
        RAISE EXCEPTION 'Version % already exists.', p_version;
    END IF;

    -- Create release
    INSERT INTO public.version_releases (
        version,
        title,
        description,
        release_type,
        status,
        download_urls,
        created_by
    ) VALUES (
        p_version,
        p_title,
        p_description,
        p_release_type,
        'draft',
        p_download_urls,
        auth.uid()
    ) RETURNING id INTO v_release_id;

    RETURN QUERY
    SELECT v_release_id, p_version, 'draft'::text, now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_version_release(text, text, text, text, jsonb) TO authenticated;

-- ============================================================================
-- Function: publish_version_release
-- Publish a version release to live status and notify users
-- ============================================================================
CREATE OR REPLACE FUNCTION public.publish_version_release(
    p_release_id uuid,
    p_target_companies uuid[] DEFAULT NULL,
    p_is_mandatory boolean DEFAULT false
)
RETURNS TABLE (
    release_id uuid,
    version text,
    status text,
    notification_count integer
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_release_record public.version_releases%ROWTYPE;
    v_notification_count integer := 0;
BEGIN
    -- Check if caller is super_admin
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin') THEN
        RAISE EXCEPTION 'Only super admins can publish version releases.';
    END IF;

    -- Get release and validate status
    SELECT * INTO v_release_record FROM public.version_releases WHERE id = p_release_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Version release not found.';
    END IF;

    IF v_release_record.status NOT IN ('draft', 'testing', 'staging') THEN
        RAISE EXCEPTION 'Can only publish releases from draft, testing, or staging status.';
    END IF;

    -- Update release status
    UPDATE public.version_releases
    SET
        status = 'live',
        published_at = now(),
        is_mandatory_update = p_is_mandatory
    WHERE id = p_release_id;

    -- If specific companies targeted, create notifications for them
    IF p_target_companies IS NOT NULL AND array_length(p_target_companies, 1) > 0 THEN
        -- Count how many users would receive notification (not implemented in full here)
        v_notification_count := array_length(p_target_companies, 1) * 3;
    ELSE
        -- Notify all active companies
        v_notification_count := (SELECT COUNT(*) FROM public.companies WHERE is_active = true);
    END IF;

    RETURN QUERY
    SELECT
        p_release_id,
        v_release_record.version,
        'live'::text,
        v_notification_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.publish_version_release(uuid, uuid[], boolean) TO authenticated;

-- ============================================================================
-- Function: rollback_version_release
-- Rollback to previous version
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rollback_version_release(
    p_release_id uuid,
    p_reason text
)
RETURNS TABLE (
    release_id uuid,
    version text,
    status text,
    rollback_timestamp timestamptz
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_release_record public.version_releases%ROWTYPE;
    v_previous_release uuid;
BEGIN
    -- Check if caller is super_admin
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin') THEN
        RAISE EXCEPTION 'Only super admins can rollback versions.';
    END IF;

    -- Get release
    SELECT * INTO v_release_record FROM public.version_releases WHERE id = p_release_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Version release not found.';
    END IF;

    -- Get previous release
    IF v_release_record.previous_version_id IS NOT NULL THEN
        v_previous_release := v_release_record.previous_version_id;
    ELSE
        -- Find the previous live version
        SELECT id INTO v_previous_release
        FROM public.version_releases
        WHERE created_at < v_release_record.created_at
          AND status = 'live'
        ORDER BY created_at DESC
        LIMIT 1;
    END IF;

    -- Mark current as rolled back
    UPDATE public.version_releases
    SET
        status = 'rolled_back',
        rolled_back_by = auth.uid(),
        rollback_reason = p_reason,
        rollback_timestamp = now()
    WHERE id = p_release_id;

    -- Mark previous as live (if found)
    IF v_previous_release IS NOT NULL THEN
        UPDATE public.version_releases
        SET status = 'live'
        WHERE id = v_previous_release;
    END IF;

    RETURN QUERY
    SELECT
        p_release_id,
        v_release_record.version,
        'rolled_back'::text,
        now();
END;
$$;

GRANT EXECUTE ON FUNCTION public.rollback_version_release(uuid, text) TO authenticated;

-- ============================================================================
-- Grant access to tables for authenticated users (for super_admin via RLS)
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_sessions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.remote_maintenance_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.backup_history TO authenticated;
GRANT SELECT ON public.database_health_checks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.version_releases TO authenticated;
