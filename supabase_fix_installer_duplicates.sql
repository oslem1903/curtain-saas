-- ============================================================
-- PERDEPRO - Montajcı duplicate birleştirme + tekrar engelleme (v2)
-- enforce_tenant_write trigger'ı SQL Editor'da (auth.uid() boş)
-- bakım güncellemelerini engellediği için, işlem süresince
-- trigger'lar geçici devre dışı bırakılır ve COMMIT ile otomatik
-- normale döner. Tek seferde çalışır, idempotent, kayıt silmez.
-- ============================================================

-- TANI: aynı firma içinde aynı isimli aktif montajcılar
SELECT 'TANI: duplicate montajcilar' AS section,
       company_id, lower(trim(full_name)) AS isim, count(*) AS adet
FROM employees
WHERE COALESCE(is_active, true)
GROUP BY company_id, lower(trim(full_name))
HAVING count(*) > 1;

-- ------------------------------------------------------------
-- 1) BİRLEŞTİRME — trigger'lar bu transaction için kapalı
-- ------------------------------------------------------------
BEGIN;
SET LOCAL session_replication_role = replica;  -- tüm tablo trigger'larını bu işlem için devre dışı bırak

DO $$
DECLARE
    grp RECORD;
    keeper UUID;
    dupe RECORD;
BEGIN
    FOR grp IN
        SELECT company_id, lower(trim(full_name)) AS norm_name
        FROM employees
        WHERE COALESCE(is_active, true)
        GROUP BY company_id, lower(trim(full_name))
        HAVING count(*) > 1
    LOOP
        -- Ana kaydı seç: önce user_id'si olan, sonra en eski
        SELECT id INTO keeper
        FROM employees
        WHERE company_id = grp.company_id
          AND lower(trim(full_name)) = grp.norm_name
          AND COALESCE(is_active, true)
        ORDER BY (user_id IS NULL), created_at NULLS LAST, id
        LIMIT 1;

        FOR dupe IN
            SELECT id, user_id FROM employees
            WHERE company_id = grp.company_id
              AND lower(trim(full_name)) = grp.norm_name
              AND COALESCE(is_active, true)
              AND id <> keeper
        LOOP
            -- Montaj işlerini ana kayda taşı (hem employee.id hem user_id ile)
            UPDATE installation_jobs SET assigned_staff_id = keeper
            WHERE assigned_staff_id = dupe.id;

            IF dupe.user_id IS NOT NULL THEN
                UPDATE installation_jobs SET assigned_staff_id = keeper
                WHERE assigned_staff_id = dupe.user_id;
            END IF;

            -- Cari ödemelerini ana kayda taşı
            IF to_regclass('public.installer_transactions') IS NOT NULL THEN
                UPDATE installer_transactions SET installer_id = keeper
                WHERE installer_id = dupe.id;
            END IF;

            -- Kopyayı pasife al (silme yok — geçmiş bozulmaz)
            UPDATE employees SET is_active = false WHERE id = dupe.id;
        END LOOP;
    END LOOP;
END $$;

COMMIT;  -- session_replication_role otomatik olarak normale döner, trigger'lar tekrar aktif

-- ------------------------------------------------------------
-- 2) Aynı isimle yeni aktif montajcı oluşturulmasını engelle
--    (index oluşturma trigger'lardan etkilenmez)
-- ------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS employees_company_name_active_uidx
ON employees (company_id, lower(trim(full_name)))
WHERE COALESCE(is_active, true);

-- ------------------------------------------------------------
-- 3) Schema cache yenile + SONUC kontrolleri
-- ------------------------------------------------------------
NOTIFY pgrst, 'reload schema';

-- Trigger'ların tekrar aktif olduğunu doğrula (replica modda kalmadı)
SHOW session_replication_role;

SELECT 'SONUC: kalan duplicate' AS check_name,
       count(*) = 0 AS ok
FROM (
    SELECT 1 FROM employees
    WHERE COALESCE(is_active, true)
    GROUP BY company_id, lower(trim(full_name))
    HAVING count(*) > 1
) d;
