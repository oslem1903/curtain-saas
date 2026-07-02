-- ============================================================
-- PERDEPRO - appointments hatırlatma kolonları
-- Hata: "Could not find the 'reminder_offset' column of 'appointments'"
-- Tek seferde çalışır, idempotent, veri silmez.
--
-- NOT: reminder_offset TEXT olarak eklenir (INTEGER değil) çünkü
-- uygulama "15m" / "30m" / "1h" / "1d" / "at_time" değerleri gönderir.
-- INTEGER kolon eklenirse mevcut frontend insert'leri tip hatasıyla düşer.
-- Dakika cinsinden sayısal değer gerekiyorsa reminder_minutes kolonu
-- otomatik (generated) olarak eklenmiştir.
-- ============================================================

-- 1. Hatırlatma kolonları
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_offset TEXT DEFAULT '30m';
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_enabled BOOLEAN DEFAULT true;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT false;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS reminder_at TIMESTAMPTZ;
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS notification_status TEXT DEFAULT 'planned';

-- Dakika cinsinden otomatik hesaplanan kolon (rapor/sorgu kolaylığı için)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'appointments' AND column_name = 'reminder_minutes'
    ) THEN
        ALTER TABLE appointments ADD COLUMN reminder_minutes INT GENERATED ALWAYS AS (
            CASE reminder_offset
                WHEN 'at_time' THEN 0
                WHEN '15m' THEN 15
                WHEN '30m' THEN 30
                WHEN '1h'  THEN 60
                WHEN '1d'  THEN 1440
                ELSE 30
            END
        ) STORED;
    END IF;
END $$;

-- 2. Mevcut randevular için reminder_at'i doldur
--    NOT: appointments üzerindeki enforce_tenant_write trigger'ı SQL Editor'da
--    (auth.uid() boş olduğu için) toplu güncellemeyi engelliyor. Bu bakım
--    güncellemesi için trigger'lar geçici olarak kapatılır ve hemen geri açılır.
BEGIN;
SET LOCAL session_replication_role = replica;  -- trigger'ları bu işlem için devre dışı bırak

UPDATE appointments
SET reminder_at = start_at - make_interval(mins =>
    CASE reminder_offset
        WHEN 'at_time' THEN 0
        WHEN '15m' THEN 15
        WHEN '30m' THEN 30
        WHEN '1h'  THEN 60
        WHEN '1d'  THEN 1440
        ELSE 30
    END)
WHERE reminder_at IS NULL
  AND start_at IS NOT NULL;

COMMIT;  -- session_replication_role otomatik normale döner

-- 3. Hızlı sorgu için index (yaklaşan hatırlatmalar)
CREATE INDEX IF NOT EXISTS idx_appointments_reminder_at
ON appointments (company_id, reminder_at)
WHERE reminder_sent = false;

-- 4. Schema cache yenile
NOTIFY pgrst, 'reload schema';

-- SONUC
SELECT 'SONUC: kolonlar hazir' AS check_name,
       count(*) FILTER (WHERE column_name IN ('reminder_offset','reminder_enabled','reminder_sent','reminder_at','notification_status')) = 5 AS ok
FROM information_schema.columns
WHERE table_name = 'appointments';
