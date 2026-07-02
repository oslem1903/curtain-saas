-- ============================================================================
-- NOTIFICATION SYSTEM TABLES
-- Push notification logging and device token management
-- ============================================================================

-- ============================================================================
-- 1. NOTIFICATION LOGS TABLE
-- Track all notification sends and delivery status
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.notification_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    company_id uuid REFERENCES public.companies(id) ON DELETE SET NULL,
    title text NOT NULL,
    message text,
    status text DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'received')),
    notification_type text DEFAULT 'general' CHECK (notification_type IN ('general', 'support', 'update', 'warning', 'error')),
    error_message text,
    sent_at timestamptz DEFAULT now(),
    received_at timestamptz,
    created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_user ON public.notification_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_company ON public.notification_logs(company_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_status ON public.notification_logs(status);
CREATE INDEX IF NOT EXISTS idx_notification_logs_created ON public.notification_logs(created_at DESC);

-- ============================================================================
-- 2. DEVICE NOTIFICATION TOKENS TABLE
-- Store user device tokens for push notifications
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.device_notification_tokens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    token text NOT NULL,
    device_id text,
    platform text DEFAULT 'web' CHECK (platform IN ('web', 'android', 'ios', 'windows')),
    is_active boolean DEFAULT true,
    last_used_at timestamptz,
    last_updated_at timestamptz DEFAULT now(),
    created_at timestamptz DEFAULT now(),
    CONSTRAINT unique_user_company_token UNIQUE (user_id, company_id, token)
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_user ON public.device_notification_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_company ON public.device_notification_tokens(company_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_active ON public.device_notification_tokens(is_active);
CREATE INDEX IF NOT EXISTS idx_device_tokens_created ON public.device_notification_tokens(created_at DESC);

-- ============================================================================
-- RLS POLICIES
-- ============================================================================

ALTER TABLE public.notification_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_notification_tokens ENABLE ROW LEVEL SECURITY;

-- Users can only see their own notification logs
DROP POLICY IF EXISTS notification_logs_user_access ON public.notification_logs;
CREATE POLICY notification_logs_user_access ON public.notification_logs
FOR SELECT USING (
    auth.uid() = user_id OR
    EXISTS (
        SELECT 1 FROM public.company_members cm
        WHERE cm.user_id = auth.uid() AND cm.company_id = notification_logs.company_id
    ) OR
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = auth.uid() AND p.role = 'super_admin'
    )
);

-- Users can insert their own notification logs (for client-side logging)
DROP POLICY IF EXISTS notification_logs_user_insert ON public.notification_logs;
CREATE POLICY notification_logs_user_insert ON public.notification_logs
FOR INSERT WITH CHECK (
    auth.uid() = user_id OR
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = auth.uid() AND p.role = 'super_admin'
    )
);

-- Users can only see their own device tokens
DROP POLICY IF EXISTS device_tokens_user_access ON public.device_notification_tokens;
CREATE POLICY device_tokens_user_access ON public.device_notification_tokens
FOR ALL USING (
    auth.uid() = user_id OR
    EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.user_id = auth.uid() AND p.role = 'super_admin'
    )
);

-- ============================================================================
-- HELPER FUNCTIONS
-- ============================================================================

-- Get undelivered notifications for a user
CREATE OR REPLACE FUNCTION public.get_undelivered_notifications(
    p_user_id uuid,
    p_limit integer DEFAULT 50
)
RETURNS TABLE (
    id uuid,
    title text,
    message text,
    status text,
    sent_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    SELECT
        nl.id,
        nl.title,
        nl.message,
        nl.status,
        nl.sent_at
    FROM public.notification_logs nl
    WHERE nl.user_id = p_user_id
        AND nl.status != 'received'
        AND nl.created_at > now() - interval '7 days'
    ORDER BY nl.created_at DESC
    LIMIT p_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_undelivered_notifications(uuid, integer) TO authenticated;

-- Mark notification as received
CREATE OR REPLACE FUNCTION public.mark_notification_received(
    p_notification_id uuid
)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id uuid;
BEGIN
    -- Get user_id from notification
    SELECT user_id INTO v_user_id FROM public.notification_logs WHERE id = p_notification_id;

    -- Verify user owns this notification
    IF v_user_id IS NULL OR v_user_id != auth.uid() THEN
        RAISE EXCEPTION 'Unauthorized access';
    END IF;

    -- Update status
    UPDATE public.notification_logs
    SET
        status = 'received',
        received_at = now()
    WHERE id = p_notification_id;

    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_notification_received(uuid) TO authenticated;

-- ============================================================================
-- GRANTS
-- ============================================================================

GRANT SELECT, INSERT ON public.notification_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.device_notification_tokens TO authenticated;

-- ============================================================================
-- SUPPORT TICKET RESPONSE NOTIFICATION
-- When support ticket is marked as resolved, send notification to user
-- ============================================================================

CREATE OR REPLACE FUNCTION public.notify_support_ticket_resolved()
RETURNS TRIGGER AS $$
BEGIN
    -- Insert notification when ticket status changes to resolved
    IF NEW.status = 'resolved' AND OLD.status != 'resolved' THEN
        INSERT INTO public.notification_logs (
            user_id,
            company_id,
            title,
            message,
            status,
            notification_type
        )
        SELECT
            NEW.user_id,
            NEW.company_id,
            'Destek Talebiniz Çözüldü',
            COALESCE(NEW.admin_response, 'Destek talebiniz çözüldü.'),
            'sent',
            'support'
        WHERE NEW.user_id IS NOT NULL;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
DROP TRIGGER IF EXISTS trg_notify_support_ticket_resolved ON public.support_tickets;
CREATE TRIGGER trg_notify_support_ticket_resolved
AFTER UPDATE ON public.support_tickets
FOR EACH ROW
EXECUTE FUNCTION public.notify_support_ticket_resolved();
