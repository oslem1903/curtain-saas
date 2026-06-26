-- =========================================================================================
-- CURTAIN SAAS: INVOICING MODULE (FATURA MODÜLÜ)
-- =========================================================================================

-- 1. FATURALAR TABLOSU (INVOICES)
CREATE TABLE IF NOT EXISTS public.invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    order_id UUID REFERENCES public.orders(id) ON DELETE SET NULL, -- Siparişe bağlıysa
    customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL, -- Satış/Satış İade için
    supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL, -- Alış/Alış İade için
    
    invoice_type TEXT NOT NULL, -- 'sales', 'purchase', 'sales_return', 'purchase_return'
    invoice_no TEXT, -- Örn: FAT202600001
    date TIMESTAMP WITH TIME ZONE DEFAULT now(),
    
    total_tax_exclusive NUMERIC(15,2) DEFAULT 0, -- KDV Hariç Toplam
    total_tax_amount NUMERIC(15,2) DEFAULT 0,    -- Toplam KDV
    total_tax_inclusive NUMERIC(15,2) DEFAULT 0, -- KDV Dahil Genel Toplam
    
    status TEXT DEFAULT 'draft', -- 'draft', 'sent', 'paid', 'cancelled'
    notes TEXT,
    
    -- GİB Entegrasyonu için teknik alanlar
    external_uuid UUID, -- Entegratördeki UUID
    is_official BOOLEAN DEFAULT false, -- e-Fatura olarak gönderildi mi?
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 2. FATURA KALEMLERİ TABLOSU (INVOICE ITEMS)
CREATE TABLE IF NOT EXISTS public.invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    
    description TEXT NOT NULL, -- Ürün/Hizmet Adı
    quantity NUMERIC(12,2) DEFAULT 1,
    unit_price NUMERIC(15,2) DEFAULT 0,
    tax_rate NUMERIC(5,2) DEFAULT 20.0, -- KDV Oranı (Örn: 20 veya 10)
    line_total NUMERIC(15,2) DEFAULT 0, -- Satır Toplamı (KDV Dahil)
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- 3. GÜVENLİK (RLS) AYARLARI
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_items ENABLE ROW LEVEL SECURITY;

-- Politikalar
CREATE POLICY "Users can see own company invoices" ON public.invoices
    FOR SELECT USING (company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own company invoices" ON public.invoices
    FOR INSERT WITH CHECK (company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own company invoices" ON public.invoices
    FOR UPDATE USING (company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own company invoices" ON public.invoices
    FOR DELETE USING (company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid()));

-- Kalemler için de benzer politikalar
CREATE POLICY "Users can see own company invoice items" ON public.invoice_items
    FOR SELECT USING (company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own company invoice items" ON public.invoice_items
    FOR INSERT WITH CHECK (company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own company invoice items" ON public.invoice_items
    FOR UPDATE USING (company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own company invoice items" ON public.invoice_items
    FOR DELETE USING (company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid()));

-- 4. OTOMATIK GÜNCELLEME TRIGGERI
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE PROCEDURE update_updated_at_column();
