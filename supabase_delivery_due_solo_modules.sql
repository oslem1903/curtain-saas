-- ============================================================
-- PERDEPRO - Termin tarihi + Solo Perdeci modül düzeltmesi
-- Tek seferde çalışır, idempotent, veri silmez.
-- ============================================================

-- 1. Termin / teslim tarihi kolonları
ALTER TABLE appointments ADD COLUMN IF NOT EXISTS delivery_due_date DATE;
ALTER TABLE orders       ADD COLUMN IF NOT EXISTS delivery_due_date DATE;

-- 2. Solo Perdeci paketinden kartela (catalogs) ve personel (staff) modüllerini çıkar
--    (mevcut solo firmaların enabled_modules listesi eski seti içeriyor olabilir)
UPDATE companies
SET enabled_modules = array_remove(array_remove(enabled_modules, 'catalogs'), 'staff')
WHERE package_code IN ('solo', 'solo_perdeci')
  AND enabled_modules IS NOT NULL
  AND ('catalogs' = ANY(enabled_modules) OR 'staff' = ANY(enabled_modules));

-- enabled_modules boş kalan solo firmalara güncel Solo setini yaz
UPDATE companies
SET enabled_modules = array['admin','measurements','orders','customers','appointments','suppliers','installation']
WHERE package_code IN ('solo', 'solo_perdeci')
  AND (enabled_modules IS NULL OR array_length(enabled_modules, 1) IS NULL);

-- SONUC
SELECT 'SONUC: solo firmalarin modulleri' AS section, id, name, enabled_modules
FROM companies
WHERE package_code IN ('solo', 'solo_perdeci');

NOTIFY pgrst, 'reload schema';
