-- ============================================================================
-- SUPER ADMIN OBSERVABILITY V1
-- Activity tracking, error logging, dashboard data for Super Admin
-- ============================================================================
-- Fully additive. Safe to run multiple times. Does not break existing data.
-- ============================================================================

-- 1. USER ACTIVITY TABLE (Real-time activity tracking)
CREATE TABLE IF NOT EXISTS public.user_activity (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id UUID REFERENCES public.companies(id) ON DELETE SET NULL,
    activity_type TEXT NOT NULL,
    page TEXT,
    action TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT activity_type_check CHECK (activity_type IN (
        'login', 'logout', 'heartbeat', 'page_view', 'action', 'error'
    ))
);

CREATE INDEX IF NOT EXISTS idx_user_activity_user ON public.user_activity(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_company ON public.user_activity(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_type ON public.user_activity(activity_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_activity_created ON public.user_activity(created_at DESC);

ALTER TABLE public.user_activity ENABLE ROW LEVEL SECURITY;

-- RLS: Normal users can only insert their own activity
DROP POLICY IF EXISTS "user_activity_insert_own" ON public.user_activity;
CREATE POLICY "user_activity_insert_own" ON public.user_activity
    FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid());

-- RLS: Super admin can select all
DROP POLICY IF EXISTS "user_activity_select_super_admin" ON public.user_activity;
CREATE POLICY "user_activity_select_super_admin" ON public.user_activity
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.profiles
        WHERE user_id = auth.uid() AND role = 'super_admin'
    ));

-- 2. FIX ERROR_LOGS TABLE (Additive: add missing columns)
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS error_stack TEXT;
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS page_url TEXT;
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS browser_info JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS device_info JSONB DEFAULT '{}'::jsonb;
ALTER TABLE public.error_logs ADD COLUMN IF NOT EXISTS app_version TEXT DEFAULT '1.0.0';

CREATE INDEX IF NOT EXISTS idx_error_logs_created ON public.error_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_company_created ON public.error_logs(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_message ON public.error_logs(message);

-- 3. ADD ACTIVITY COLUMNS TO PROFILES
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ;

-- 4. LINK ERROR TO SUPPORT TICKET (Optional diagnosis)
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS linked_error_id UUID REFERENCES public.error_logs(id) ON DELETE SET NULL;

-- 5. TRIAL ALERT TRACKING
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS trial_alert_sent_at TIMESTAMPTZ;

-- 6. SUPER ADMIN OBSERVABILITY RPC
CREATE OR REPLACE FUNCTION public.get_super_admin_observability()
RETURNS TABLE (
    total_companies BIGINT,
    total_users BIGINT,
    active_users_now BIGINT,
    active_users_today BIGINT,
    active_users_7d BIGINT,
    active_users_30d BIGINT,
    trials_ending_7d BIGINT,
    open_support_tickets BIGINT,
    error_count_24h BIGINT,
    top_errors JSONB
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_now TIMESTAMPTZ := now();
    v_today TIMESTAMPTZ := (v_now AT TIME ZONE 'UTC')::date AT TIME ZONE 'UTC';
    v_7d_ago TIMESTAMPTZ := v_now - INTERVAL '7 days';
    v_30d_ago TIMESTAMPTZ := v_now - INTERVAL '30 days';
    v_5min_ago TIMESTAMPTZ := v_now - INTERVAL '5 minutes';
BEGIN
    -- Verify caller is super_admin
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE user_id = auth.uid() AND role = 'super_admin'
    ) THEN
        RAISE EXCEPTION 'Only super_admin can access observability data';
    END IF;

    -- Return aggregated data
    RETURN QUERY
    SELECT
        -- Total companies
        (SELECT COUNT(*) FROM public.companies WHERE deleted_at IS NULL),

        -- Total users (active company_members)
        (SELECT COUNT(DISTINCT cm.user_id)
         FROM public.company_members cm
         WHERE cm.is_active = true),

        -- Active users now (last 5 min activity or session_end IS NULL)
        (SELECT COUNT(DISTINCT ua.user_id)
         FROM public.user_activity ua
         WHERE ua.created_at > v_5min_ago
            OR EXISTS (
                SELECT 1 FROM public.admin_sessions
                WHERE admin_sessions.super_admin_id = ua.user_id
                  AND admin_sessions.session_end IS NULL
            )),

        -- Active users today
        (SELECT COUNT(DISTINCT ua.user_id)
         FROM public.user_activity ua
         WHERE ua.created_at >= v_today),

        -- Active users last 7 days
        (SELECT COUNT(DISTINCT ua.user_id)
         FROM public.user_activity ua
         WHERE ua.created_at >= v_7d_ago),

        -- Active users last 30 days
        (SELECT COUNT(DISTINCT ua.user_id)
         FROM public.user_activity ua
         WHERE ua.created_at >= v_30d_ago),

        -- Trials ending in next 7 days
        (SELECT COUNT(*) FROM public.companies
         WHERE deleted_at IS NULL
           AND trial_ends_at IS NOT NULL
           AND trial_ends_at <= (v_now + INTERVAL '7 days')
           AND trial_ends_at > v_now),

        -- Open support tickets
        (SELECT COUNT(*) FROM public.support_tickets
         WHERE status IN ('open', 'in_progress', 'waiting_user')),

        -- Errors in last 24 hours
        (SELECT COUNT(*) FROM public.error_logs
         WHERE created_at >= (v_now - INTERVAL '24 hours')),

        -- Top 5 errors (same message, count, last_seen)
        COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'message', el.message,
                    'count', el.count,
                    'last_seen', el.last_seen,
                    'company_id', el.company_id
                )
                ORDER BY el.count DESC
            ),
            '[]'::jsonb
        )
    FROM (
        SELECT
            COALESCE(el.message, 'Unknown'),
            COUNT(*) as count,
            MAX(el.created_at) as last_seen,
            el.company_id
        FROM public.error_logs el
        WHERE el.created_at >= (v_now - INTERVAL '24 hours')
        GROUP BY COALESCE(el.message, 'Unknown'), el.company_id
        ORDER BY count DESC
        LIMIT 5
    ) el;
END $$;

-- 7. RPC: RECORD USER ACTIVITY (called by frontend on login, heartbeat, etc.)
CREATE OR REPLACE FUNCTION public.record_user_activity(
    p_activity_type TEXT,
    p_company_id UUID DEFAULT NULL,
    p_page TEXT DEFAULT NULL,
    p_action TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT NULL
)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_activity_id UUID;
BEGIN
    -- Validate activity_type
    IF p_activity_type NOT IN ('login', 'logout', 'heartbeat', 'page_view', 'action', 'error') THEN
        RAISE EXCEPTION 'Invalid activity_type: %', p_activity_type;
    END IF;

    -- Infer company_id if not provided
    IF p_company_id IS NULL THEN
        SELECT cm.company_id INTO p_company_id
        FROM public.company_members cm
        WHERE cm.user_id = auth.uid()
          AND cm.is_active = true
        LIMIT 1;
    END IF;

    -- Insert activity record
    INSERT INTO public.user_activity (
        user_id, company_id, activity_type, page, action, metadata, created_at
    ) VALUES (
        auth.uid(), p_company_id, p_activity_type, p_page, p_action, COALESCE(p_metadata, '{}'::jsonb), now()
    )
    RETURNING id INTO v_activity_id;

    -- Update last_active_at in profiles
    UPDATE public.profiles
    SET last_active_at = now()
    WHERE user_id = auth.uid();

    RETURN v_activity_id;
EXCEPTION WHEN OTHERS THEN
    -- Silently fail activity logging to not break user flow
    RETURN NULL;
END $$;

-- 8. RPC: UPDATE LAST LOGIN (called after successful auth)
CREATE OR REPLACE FUNCTION public.record_login()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    UPDATE public.profiles
    SET last_login_at = now(), last_active_at = now()
    WHERE user_id = auth.uid();

    -- Also log activity
    INSERT INTO public.user_activity (user_id, activity_type, created_at)
    VALUES (auth.uid(), 'login', now())
    ON CONFLICT DO NOTHING;
EXCEPTION WHEN OTHERS THEN
    -- Silently fail
    NULL;
END $$;

-- 9. GRANT PERMISSIONS
GRANT EXECUTE ON FUNCTION public.get_super_admin_observability() TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_user_activity(TEXT, UUID, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_login() TO authenticated;

-- 10. SCHEMA CACHE NOTIFICATION
NOTIFY pgrst, 'reload schema';
