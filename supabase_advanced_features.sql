-- =========================================================================================
-- CURTAIN SAAS: ADVANCED SECURITY & INTEGRATION PATCH
-- =========================================================================================

-- 1. DENETIM GÜNLÜKLERİ (AUDIT TRAIL) TABLOSU
-- Kimin ne yaptığını saniyesiyle takip eder.
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL, -- 'CREATE_ORDER', 'UPDATE_INVOICE', 'DELETE_CUSTOMER' vb.
    entity_type TEXT, -- 'ORDER', 'INVOICE', 'CUSTOMER'
    entity_id UUID,
    details JSONB, -- Eski veri / Yeni veri farkı veya açıklama
    ip_address TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Şirket bazlı günlük görme yetkisi" ON public.audit_logs
    FOR SELECT USING (company_id IN (
        SELECT company_id FROM public.company_members WHERE user_id = auth.uid()
    ));

-- 2. FOTOĞRAF VE DOSYA DESTEĞİ İÇİN KOLONLAR
-- Müşterilere ve Randevulara (Ölçülere) fotoğraf alanı ekleme.
ALTER TABLE public.customers ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS photo_urls TEXT[]; -- Birden fazla ölçü fotoğrafı için dizi
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS measurement_notes TEXT;

-- 3. SMS LOG TABLOSU (Twilio Entegrasyonu Takibi)
CREATE TABLE IF NOT EXISTS public.sms_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    recipient_phone TEXT NOT NULL,
    message_body TEXT NOT NULL,
    status TEXT DEFAULT 'pending', -- 'sent', 'failed', 'delivered'
    error_message TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 4. OTOMATİK AUDIT TRIGGER ÖRNEĞİ (Siparişler için)
CREATE OR REPLACE FUNCTION public.log_order_changes()
RETURNS TRIGGER AS $$
BEGIN
    IF (TG_OP = 'INSERT') THEN
        INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, details)
        VALUES (NEW.company_id, auth.uid(), 'CREATE_ORDER', 'ORDER', NEW.id, jsonb_build_object('total', NEW.total_amount));
    ELSIF (TG_OP = 'UPDATE') THEN
        INSERT INTO public.audit_logs (company_id, user_id, action, entity_type, entity_id, details)
        VALUES (NEW.company_id, auth.uid(), 'UPDATE_ORDER', 'ORDER', NEW.id, jsonb_build_object('old_status', OLD.status, 'new_status', NEW.status));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Sipariş tetikleyicisini aktif edelim
-- DROP TRIGGER IF EXISTS trg_log_orders ON public.orders;
-- CREATE TRIGGER trg_log_orders AFTER INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION public.log_order_changes();
