-- ============================================================
-- PERDEPRO - Destek Sistemi Faz 2 (additive / idempotent)
-- Yeni destek durumları + closed_at + admin_response alanları.
-- Mevcut kayıtları ve RLS policy'lerini DEĞİŞTİRMEZ.
-- ============================================================

-- 1. Yeni kolonlar (additive)
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS admin_response TEXT;
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;

-- 2. Status CHECK constraint'ini yeni durumları kapsayacak şekilde genişlet
--    (eski 4 durum aynen geçerli kalır; yalnızca yeni değerler EKLENİR)
DO $$
DECLARE
    cname TEXT;
BEGIN
    SELECT conname INTO cname
    FROM pg_constraint
    WHERE conrelid = 'public.support_tickets'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%';

    IF cname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE support_tickets DROP CONSTRAINT %I', cname);
    END IF;

    ALTER TABLE support_tickets
        ADD CONSTRAINT support_tickets_status_check
        CHECK (status IN ('open', 'in_progress', 'waiting_user', 'update_ready', 'resolved', 'closed'));
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Status constraint guncellenemedi: %', SQLERRM;
END $$;

NOTIFY pgrst, 'reload schema';

-- SONUC
SELECT 'SONUC: kolonlar' AS check_name,
       count(*) FILTER (WHERE column_name IN ('closed_at','admin_response','updated_at','resolved_at')) = 4 AS ok
FROM information_schema.columns WHERE table_name = 'support_tickets';

SELECT 'SONUC: status constraint' AS check_name, pg_get_constraintdef(oid) AS tanim
FROM pg_constraint
WHERE conrelid = 'public.support_tickets'::regclass AND conname = 'support_tickets_status_check';
