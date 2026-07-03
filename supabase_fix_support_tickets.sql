-- ============================================================
-- PERDEPRO - Destek Talepleri (support_tickets) FIX
-- Sorun: kullanıcı talebi gönderiyor ama Süper Admin > Destek
-- Merkezi'nde görünmüyor (tablo/RLS eksik veya policy hatalı).
-- Tek seferde çalışır, idempotent, veri silmez.
-- ============================================================

-- 1. Tablo (yoksa oluştur) + eksik kolonlar
CREATE TABLE IF NOT EXISTS support_tickets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID,
    title TEXT,
    description TEXT,
    category TEXT DEFAULT 'other',
    priority TEXT DEFAULT 'medium',
    page_url TEXT,
    status TEXT DEFAULT 'open',
    admin_response TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ
);

ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS category TEXT DEFAULT 'other';
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium';
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS page_url TEXT;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'open';
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS admin_response TEXT;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_support_tickets_created
ON support_tickets (created_at DESC);

-- 2. RLS — recursion'sız helper'larla (is_super_admin / my_company_ids)
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;

-- Kullanıcı kendi firması adına talep oluşturabilir
DROP POLICY IF EXISTS "support_tickets_insert_own_company" ON support_tickets;
CREATE POLICY "support_tickets_insert_own_company" ON support_tickets
    FOR INSERT TO authenticated
    WITH CHECK (
        public.is_super_admin()
        OR company_id IN (SELECT public.my_company_ids())
    );

-- Süper admin tümünü, kullanıcı kendi firmasının taleplerini görür
DROP POLICY IF EXISTS "support_tickets_select" ON support_tickets;
CREATE POLICY "support_tickets_select" ON support_tickets
    FOR SELECT TO authenticated
    USING (
        public.is_super_admin()
        OR company_id IN (SELECT public.my_company_ids())
    );

-- Süper admin durum/yanıt güncelleyebilir
DROP POLICY IF EXISTS "support_tickets_update_super" ON support_tickets;
CREATE POLICY "support_tickets_update_super" ON support_tickets
    FOR UPDATE TO authenticated
    USING (public.is_super_admin())
    WITH CHECK (public.is_super_admin());

-- 3. profiles FK ilişkisi — Süper Admin ekranındaki
--    `profile:profiles(full_name)` gömülü join'i bu ilişkiye ihtiyaç duyar.
--    FK yoksa PostgREST TÜM select'i reddeder ve liste boş görünür.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'support_tickets_user_id_profiles_fkey'
          AND conrelid = 'public.support_tickets'::regclass
    ) THEN
        BEGIN
            ALTER TABLE support_tickets
                ADD CONSTRAINT support_tickets_user_id_profiles_fkey
                FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE SET NULL;
        EXCEPTION WHEN OTHERS THEN
            -- profiles'ta karşılığı olmayan eski user_id'ler varsa FK kurulamaz;
            -- frontend join'siz yedek okuma ile zaten çalışır.
            RAISE NOTICE 'FK kurulamadi (eski kayitlarda eslesmeyen user_id olabilir): %', SQLERRM;
        END;
    END IF;
END $$;

-- 4. Schema cache + SONUC
NOTIFY pgrst, 'reload schema';

SELECT 'SONUC: tablo hazir' AS check_name, to_regclass('public.support_tickets') IS NOT NULL AS ok;
SELECT 'SONUC: policyler' AS section, policyname, cmd
FROM pg_policies WHERE tablename = 'support_tickets';
