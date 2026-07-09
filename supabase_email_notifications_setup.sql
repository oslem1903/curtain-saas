-- Email Notifications Setup for PerdePRO
-- This file documents the email notification system setup

-- 1. Email Log Table (for tracking sent emails and retries)
CREATE TABLE IF NOT EXISTS public.email_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    recipient_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    email_type TEXT NOT NULL, -- 'invoice', 'payment', 'appointment', 'order_status', etc.
    entity_type TEXT, -- 'invoice', 'payment', 'appointment', 'order', etc.
    entity_id UUID,
    status TEXT DEFAULT 'pending', -- 'sent', 'failed', 'bounced'
    send_attempts INTEGER DEFAULT 0,
    last_error TEXT,
    sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'email_logs'
    AND policyname = 'Companies can view own email logs'
  ) THEN
    CREATE POLICY "Companies can view own email logs" ON public.email_logs
        FOR SELECT USING (company_id IN (
            SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
        ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'email_logs'
    AND policyname = 'Companies can update own email logs'
  ) THEN
    CREATE POLICY "Companies can update own email logs" ON public.email_logs
        FOR UPDATE USING (company_id IN (
            SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
        ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS email_logs_company_id ON public.email_logs(company_id);
CREATE INDEX IF NOT EXISTS email_logs_status ON public.email_logs(status);
CREATE INDEX IF NOT EXISTS email_logs_created_at ON public.email_logs(created_at);
CREATE INDEX IF NOT EXISTS email_logs_entity ON public.email_logs(entity_type, entity_id);

-- 2. Notification Preferences Table
CREATE TABLE IF NOT EXISTS public.notification_preferences (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    invoice_notifications BOOLEAN DEFAULT true,
    payment_notifications BOOLEAN DEFAULT true,
    appointment_notifications BOOLEAN DEFAULT true,
    order_notifications BOOLEAN DEFAULT true,
    marketing_emails BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(user_id, company_id)
);

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'notification_preferences'
    AND policyname = 'Users can view own notification preferences'
  ) THEN
    CREATE POLICY "Users can view own notification preferences" ON public.notification_preferences
        FOR SELECT USING (user_id = auth.uid());
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'notification_preferences'
    AND policyname = 'Users can update own notification preferences'
  ) THEN
    CREATE POLICY "Users can update own notification preferences" ON public.notification_preferences
        FOR UPDATE USING (user_id = auth.uid());
  END IF;
END $$;

-- 3. Email Template Tracking (for audit purposes)
CREATE TABLE IF NOT EXISTS public.email_template_sends (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    template_name TEXT NOT NULL, -- 'invoice', 'payment_confirmation', etc.
    recipient_email TEXT NOT NULL,
    recipient_name TEXT,
    entity_id UUID,
    entity_type TEXT,
    variables JSONB, -- Template variables used
    send_result TEXT, -- 'success', 'failed', etc.
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.email_template_sends ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
    AND tablename = 'email_template_sends'
    AND policyname = 'Companies can view own template sends'
  ) THEN
    CREATE POLICY "Companies can view own template sends" ON public.email_template_sends
        FOR SELECT USING (company_id IN (
            SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
        ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS email_template_sends_company_id ON public.email_template_sends(company_id);
CREATE INDEX IF NOT EXISTS email_template_sends_template ON public.email_template_sends(template_name);
CREATE INDEX IF NOT EXISTS email_template_sends_created_at ON public.email_template_sends(created_at);

-- 4. RPC Function to Log Email Sent
CREATE OR REPLACE FUNCTION public.log_email_sent(
    p_company_id UUID,
    p_recipient_email TEXT,
    p_subject TEXT,
    p_email_type TEXT,
    p_entity_type TEXT DEFAULT NULL,
    p_entity_id UUID DEFAULT NULL,
    p_status TEXT DEFAULT 'sent'
)
RETURNS UUID AS $$
DECLARE
    v_log_id UUID;
BEGIN
    INSERT INTO public.email_logs (
        company_id,
        recipient_email,
        subject,
        email_type,
        entity_type,
        entity_id,
        status,
        send_attempts,
        sent_at
    )
    VALUES (
        p_company_id,
        p_recipient_email,
        p_subject,
        p_email_type,
        p_entity_type,
        p_entity_id,
        p_status,
        1,
        CASE WHEN p_status = 'sent' THEN NOW() ELSE NULL END
    )
    RETURNING id INTO v_log_id;

    RETURN v_log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. Function to Get User Email Preferences
CREATE OR REPLACE FUNCTION public.get_email_preferences(
    p_user_id UUID,
    p_company_id UUID
)
RETURNS TABLE (
    invoice_notifications BOOLEAN,
    payment_notifications BOOLEAN,
    appointment_notifications BOOLEAN,
    order_notifications BOOLEAN,
    marketing_emails BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        COALESCE(np.invoice_notifications, true),
        COALESCE(np.payment_notifications, true),
        COALESCE(np.appointment_notifications, true),
        COALESCE(np.order_notifications, true),
        COALESCE(np.marketing_emails, false)
    FROM public.notification_preferences np
    WHERE np.user_id = p_user_id AND np.company_id = p_company_id
    UNION ALL
    SELECT true, true, true, true, false
    WHERE NOT EXISTS (
        SELECT 1 FROM public.notification_preferences
        WHERE user_id = p_user_id AND company_id = p_company_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6. Indexes for Performance
CREATE INDEX IF NOT EXISTS email_logs_recipient_status ON public.email_logs(recipient_email, status);
CREATE INDEX IF NOT EXISTS notification_prefs_company ON public.notification_preferences(company_id);

-- NOTE: Supabase Edge Function "send-email" should be deployed separately
-- The function should:
-- 1. Accept EmailPayload { to, subject, html, plainText }
-- 2. Call external email service (SendGrid, Resend, etc.)
-- 3. Log result to email_logs table
-- 4. Return { messageId, error } response
