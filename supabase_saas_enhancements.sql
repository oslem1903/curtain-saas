-- ============================================================================
-- SUPER ADMIN SaaS ENHANCEMENTS - PHASE 1 SCHEMA
-- ============================================================================

-- ============================================================================
-- 1. ADMIN IMPERSONATION LOG
-- Track when super admin logs in as a company
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.admin_impersonation_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    super_admin_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    session_start_at timestamptz DEFAULT now(),
    session_end_at timestamptz,
    ip_address inet,
    user_agent text,
    actions_taken jsonb DEFAULT '[]', -- array of {action, timestamp, details}
    read_only boolean DEFAULT true,
    notes text,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_impersonation_logs_super_admin ON public.admin_impersonation_logs(super_admin_id);
CREATE INDEX IF NOT EXISTS idx_impersonation_logs_company ON public.admin_impersonation_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_impersonation_logs_created ON public.admin_impersonation_logs(created_at DESC);

-- ============================================================================
-- 2. SYSTEM LOGS - Otomatik hata ve sistem olayları
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.system_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    log_type text NOT NULL CHECK (log_type IN ('error', 'warning', 'info', 'action')),
    page_url text,
    action_name text,
    error_message text,
    error_stack text,
    request_data jsonb,
    response_data jsonb,
    browser text,
    os text,
    screen_resolution text,
    app_version text,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_system_logs_company ON public.system_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_system_logs_user ON public.system_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_system_logs_type ON public.system_logs(log_type);
CREATE INDEX IF NOT EXISTS idx_system_logs_created ON public.system_logs(created_at DESC);

-- ============================================================================
-- 3. ACTIVITY LOGS - Canlı sistem hareketleri
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.activity_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    activity_type text NOT NULL CHECK (activity_type IN (
        'measurement_created',
        'order_created',
        'order_updated',
        'payment_received',
        'supplier_added',
        'product_added',
        'support_ticket_opened',
        'support_ticket_updated',
        'invoice_created',
        'appointment_created',
        'installation_completed',
        'other'
    )),
    entity_type text, -- customers, orders, measurements, etc.
    entity_id uuid,
    description text,
    metadata jsonb,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_company ON public.activity_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON public.activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_type ON public.activity_logs(activity_type);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON public.activity_logs(created_at DESC);

-- ============================================================================
-- 4. SUPPORT TICKET STATUS HISTORY
-- Track status changes and responses
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.support_ticket_status_history (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id uuid NOT NULL REFERENCES public.support_tickets(id) ON DELETE CASCADE,
    old_status text,
    new_status text NOT NULL,
    changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    response_message text,
    resolution_notes text,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_status_history_ticket ON public.support_ticket_status_history(ticket_id);
CREATE INDEX IF NOT EXISTS idx_status_history_created ON public.support_ticket_status_history(created_at DESC);

-- ============================================================================
-- 5. ENHANCE SUPPORT TICKETS TABLE
-- ============================================================================
ALTER TABLE public.support_tickets
ADD COLUMN IF NOT EXISTS status text DEFAULT 'open' CHECK (status IN ('open', 'in_review', 'in_progress', 'testing', 'resolved', 'closed')),
ADD COLUMN IF NOT EXISTS priority text DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'critical')),
ADD COLUMN IF NOT EXISTS category text DEFAULT 'other' CHECK (category IN ('bug', 'data', 'feature', 'update', 'education', 'license', 'other')),
ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
ADD COLUMN IF NOT EXISTS admin_response text,
ADD COLUMN IF NOT EXISTS screenshot_url text,
ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]';

-- Ensure indexes exist on new columns
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON public.support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_priority ON public.support_tickets(priority);

-- ============================================================================
-- 6. RLS POLICIES
-- ============================================================================

ALTER TABLE public.admin_impersonation_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_ticket_status_history ENABLE ROW LEVEL SECURITY;

-- Super admin can see all impersonation logs
DROP POLICY IF EXISTS impersonation_logs_super_admin ON public.admin_impersonation_logs;
CREATE POLICY impersonation_logs_super_admin ON public.admin_impersonation_logs
FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin')
);

-- Super admin can see all system logs
DROP POLICY IF EXISTS system_logs_super_admin ON public.system_logs;
CREATE POLICY system_logs_super_admin ON public.system_logs
FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin')
);

-- Users can see activity logs for their company
DROP POLICY IF EXISTS activity_logs_company_access ON public.activity_logs;
CREATE POLICY activity_logs_company_access ON public.activity_logs
FOR SELECT USING (
    EXISTS (SELECT 1 FROM public.company_members WHERE user_id = auth.uid() AND company_id = activity_logs.company_id)
    OR EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin')
);

-- Super admin can see status history
DROP POLICY IF EXISTS status_history_super_admin ON public.support_ticket_status_history;
CREATE POLICY status_history_super_admin ON public.support_ticket_status_history
FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND role = 'super_admin')
);

-- ============================================================================
-- 7. HELPER FUNCTIONS
-- ============================================================================

-- Start impersonation session
CREATE OR REPLACE FUNCTION public.start_impersonation_session(
    p_company_id uuid,
    p_read_only boolean DEFAULT true
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_log_id uuid;
    v_is_super_admin boolean;
BEGIN
    -- Check if current user is super admin
    SELECT EXISTS (
        SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'super_admin'
    ) INTO v_is_super_admin;

    IF NOT v_is_super_admin THEN
        RAISE EXCEPTION 'Unauthorized: Only super admins can impersonate companies';
    END IF;

    -- Create impersonation log
    INSERT INTO admin_impersonation_logs (
        super_admin_id,
        company_id,
        ip_address,
        user_agent,
        read_only,
        session_start_at
    ) VALUES (
        auth.uid(),
        p_company_id,
        inet_client_addr(),
        current_setting('request.headers')::json->>'user-agent',
        p_read_only,
        now()
    )
    RETURNING id INTO v_log_id;

    RETURN v_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.start_impersonation_session(uuid, boolean) TO authenticated;

-- End impersonation session
CREATE OR REPLACE FUNCTION public.end_impersonation_session(
    p_session_id uuid
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE admin_impersonation_logs
    SET session_end_at = now()
    WHERE id = p_session_id AND super_admin_id = auth.uid();

    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.end_impersonation_session(uuid) TO authenticated;

-- Log system error
CREATE OR REPLACE FUNCTION public.log_system_error(
    p_company_id uuid,
    p_page_url text,
    p_action_name text,
    p_error_message text,
    p_error_stack text,
    p_app_version text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_log_id uuid;
    v_user_agent text;
BEGIN
    INSERT INTO system_logs (
        company_id,
        user_id,
        log_type,
        page_url,
        action_name,
        error_message,
        error_stack,
        browser,
        os,
        app_version
    ) VALUES (
        p_company_id,
        auth.uid(),
        'error',
        p_page_url,
        p_action_name,
        p_error_message,
        p_error_stack,
        'detected', -- Would parse user agent in production
        'detected',
        p_app_version
    )
    RETURNING id INTO v_log_id;

    RETURN v_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_system_error(uuid, text, text, text, text, text) TO authenticated;

-- Create activity log
CREATE OR REPLACE FUNCTION public.create_activity_log(
    p_activity_type text,
    p_entity_type text,
    p_entity_id uuid,
    p_description text,
    p_metadata jsonb DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_company_id uuid;
    v_log_id uuid;
BEGIN
    -- Get company from context
    SELECT company_id INTO v_company_id FROM profiles WHERE user_id = auth.uid();

    INSERT INTO activity_logs (
        company_id,
        user_id,
        activity_type,
        entity_type,
        entity_id,
        description,
        metadata
    ) VALUES (
        v_company_id,
        auth.uid(),
        p_activity_type,
        p_entity_type,
        p_entity_id,
        p_description,
        p_metadata
    )
    RETURNING id INTO v_log_id;

    RETURN v_log_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_activity_log(text, text, uuid, text, jsonb) TO authenticated;

-- Update support ticket status
CREATE OR REPLACE FUNCTION public.update_support_ticket_status(
    p_ticket_id uuid,
    p_new_status text,
    p_response_message text DEFAULT NULL,
    p_resolution_notes text DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_status text;
    v_is_super_admin boolean;
BEGIN
    -- Check authorization
    SELECT EXISTS (
        SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'super_admin'
    ) INTO v_is_super_admin;

    IF NOT v_is_super_admin THEN
        RAISE EXCEPTION 'Unauthorized: Only super admins can update ticket status';
    END IF;

    -- Get old status
    SELECT status INTO v_old_status FROM support_tickets WHERE id = p_ticket_id;

    -- Update ticket
    UPDATE support_tickets
    SET
        status = p_new_status,
        admin_response = COALESCE(p_response_message, admin_response),
        resolved_at = CASE WHEN p_new_status = 'resolved' THEN now() ELSE resolved_at END
    WHERE id = p_ticket_id;

    -- Record status change
    INSERT INTO support_ticket_status_history (
        ticket_id,
        old_status,
        new_status,
        changed_by,
        response_message,
        resolution_notes
    ) VALUES (
        p_ticket_id,
        v_old_status,
        p_new_status,
        auth.uid(),
        p_response_message,
        p_resolution_notes
    );

    -- Send notification to user
    INSERT INTO notification_logs (
        user_id,
        title,
        message,
        status,
        notification_type
    )
    SELECT
        user_id,
        'Destek Talebi Güncellendi',
        'Talebinizin durumu değiştirildi: ' || p_new_status,
        'sent',
        'support'
    FROM support_tickets WHERE id = p_ticket_id;

    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_support_ticket_status(uuid, text, text, text) TO authenticated;

-- ============================================================================
-- 8. GRANTS
-- ============================================================================

GRANT SELECT, INSERT ON public.admin_impersonation_logs TO authenticated;
GRANT SELECT, INSERT ON public.system_logs TO authenticated;
GRANT SELECT, INSERT ON public.activity_logs TO authenticated;
GRANT SELECT ON public.support_ticket_status_history TO authenticated;
