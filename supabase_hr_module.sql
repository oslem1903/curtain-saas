-- Personel (Çalışan) Kartları Tablosu
CREATE TABLE IF NOT EXISTS employees (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT now(),
    company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
    full_name text NOT NULL,
    email text,
    phone text,
    salary_amount numeric DEFAULT 0, -- Aylık Maaş
    hire_date date DEFAULT CURRENT_DATE,
    is_active boolean DEFAULT true,
    user_id uuid REFERENCES profiles(user_id) ON DELETE SET NULL -- Sisteme giriş yetkisi varsa profiles ile eşleşir
);

-- Personel Ödemeleri / Hareketleri (Maaş, Avans, Prim)
CREATE TABLE IF NOT EXISTS employee_transactions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at timestamptz DEFAULT now(),
    company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
    employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
    transaction_date date DEFAULT CURRENT_DATE,
    type text NOT NULL, -- 'salary' (Maaş), 'advance' (Avans), 'bonus' (Prim)
    amount numeric NOT NULL,
    description text,
    recorded_by uuid REFERENCES profiles(user_id)
);

-- RLS Güvenlik Politikaları
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Şirket personeli sadece kendi şirketini görür" ON employees
    FOR ALL USING (company_id IN (SELECT company_id FROM company_members WHERE user_id = auth.uid()));

CREATE POLICY "Şirket personel hareketleri sadece kendi şirketini görür" ON employee_transactions
    FOR ALL USING (company_id IN (SELECT company_id FROM company_members WHERE user_id = auth.uid()));
