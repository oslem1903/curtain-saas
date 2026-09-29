-- ============================================================
-- Migration 021: enforce_max_users -- yalnızca AKTİF ve BENZERSİZ kullanıcıları say
-- PRODUCTION'da elle çalıştırın. Mevcut veriyi değiştirmez. Migration 015'in fonksiyonunu
-- değiştirir (CREATE OR REPLACE) ve yeniden aktifleştirmeyi (is_active false->true) de kapsar.
--
-- Kullanıcı tanımı (LicenseCard.tsx ile AYNI): company_members'ta is_active = true olan
-- farklı user_id sayısı. Cihaz (company_devices) kullanıcı sayılmaz: Hülya PC + telefon = 1
-- kullanıcı; Faruk telefon = 1 kullanıcı. Pasif kullanıcı kotayı doldurmaz.
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_max_users()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_max_users INT;
    v_active_others INT;
    v_exists_active BOOLEAN;
BEGIN
    -- Yeni/güncel satır pasifse kotayı etkilemez.
    IF NOT COALESCE(NEW.is_active, TRUE) THEN
        RETURN NEW;
    END IF;

    -- Bu kişi zaten başka aktif bir üyelik satırıyla sayılıyorsa yeni kullanıcı değildir.
    SELECT EXISTS (
        SELECT 1 FROM company_members
        WHERE company_id = NEW.company_id AND user_id = NEW.user_id
          AND COALESCE(is_active, TRUE) = TRUE
          AND (TG_OP = 'INSERT' OR id <> NEW.id)
    ) INTO v_exists_active;
    IF v_exists_active THEN
        RETURN NEW;
    END IF;

    -- UPDATE'te yalnızca pasif -> aktif geçişte kontrol et.
    IF TG_OP = 'UPDATE' AND COALESCE(OLD.is_active, TRUE) = TRUE THEN
        RETURN NEW;
    END IF;

    SELECT max_users INTO v_max_users FROM companies WHERE id = NEW.company_id;
    IF v_max_users IS NULL THEN
        RETURN NEW;
    END IF;

    SELECT count(DISTINCT user_id) INTO v_active_others
    FROM company_members
    WHERE company_id = NEW.company_id
      AND user_id <> NEW.user_id
      AND COALESCE(is_active, TRUE) = TRUE;

    IF v_active_others >= v_max_users THEN
        RAISE EXCEPTION 'Kullanıcı limitine ulaşıldı (% kullanıcı). Yeni kişi eklemek için lisansınızı yükseltin veya kullanılmayan bir kullanıcıyı pasif yapın.', v_max_users;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_max_users ON public.company_members;
CREATE TRIGGER trg_enforce_max_users
    BEFORE INSERT ON public.company_members
    FOR EACH ROW EXECUTE FUNCTION public.enforce_max_users();

DROP TRIGGER IF EXISTS trg_enforce_max_users_reactivate ON public.company_members;
CREATE TRIGGER trg_enforce_max_users_reactivate
    BEFORE UPDATE OF is_active ON public.company_members
    FOR EACH ROW
    WHEN (COALESCE(OLD.is_active, TRUE) = FALSE AND COALESCE(NEW.is_active, TRUE) = TRUE)
    EXECUTE FUNCTION public.enforce_max_users();

-- DOĞRULAMA (salt okunur): firma başına aktif benzersiz kullanıcı ve limit
-- SELECT c.name, c.max_users, count(DISTINCT m.user_id) FILTER (WHERE m.is_active) AS aktif_kullanici
-- FROM companies c LEFT JOIN company_members m ON m.company_id = c.id GROUP BY c.id ORDER BY 1;
-- Not: Zaten limiti aşmış firmalar SİLİNMEZ/pasife alınmaz; yalnızca yeni ekleme/reaktivasyon engellenir.
