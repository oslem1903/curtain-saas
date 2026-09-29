-- ============================================================
-- Migration 015: Kullanıcı/Cihaz limiti ayrımı + Şirket profili
-- kaydetme tanısı. Tamamen eklemeli (additive), mevcut veriyi
-- silmez/değiştirmez, RLS izolasyonunu korur.
-- Supabase SQL Editor'da PRODUCTION projede çalıştırın.
-- ============================================================

-- 1) update_company_profile RPC'nin herkese (authenticated) çalıştırma
--    izni olduğunu garantiye al. Postgres yeni fonksiyonlara varsayılan
--    olarak PUBLIC'e EXECUTE verir, ama proje genelinde bazı
--    fonksiyonlarda daha sonra REVOKE yapılmış olabilir. Bu, "Şirket
--    profili kaydedilemedi" hatasının olası bir nedenidir.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_company_profile'
  ) THEN
    GRANT EXECUTE ON FUNCTION public.update_company_profile(uuid, text, text, text, text, text, text) TO authenticated;
  END IF;
END $$;

-- 2) Teşhis: update_company_profile ve protect_license_fields fonksiyonlarının
--    GERÇEK canlı tanımını göster (repodaki .sql dosyaları eski/farklı olabilir).
--    Bu SELECT'lerin çıktısını Claude'a geri gönderin.
SELECT p.proname, pg_get_functiondef(p.oid) AS live_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname IN ('update_company_profile', 'protect_license_fields');

-- 3) Kullanıcı limiti (max_users) artık GERÇEKTEN uygulansın.
--    "Kullanıcı" = company_members'taki BENZERSİZ kişi sayısı (cihaz değil).
--    Bu trigger hangi RPC/akıştan geldiğine bakmaksızın, company_members'a
--    yeni bir (company_id, user_id) satırı eklenmeye çalışıldığında devreye
--    girer. Var olan bir üyeliğin ON CONFLICT DO UPDATE ile güncellenmesini
--    (ör. reaktivasyon) ETKİLEMEZ — yalnızca GERÇEKTEN yeni bir kişi için
--    limit kontrolü yapar.
CREATE OR REPLACE FUNCTION public.enforce_max_users()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_max_users INT;
    v_current_count INT;
BEGIN
    -- Zaten var olan bir (company_id, user_id) satırı ise (ON CONFLICT DO UPDATE
    -- yolunda BEFORE INSERT yine de tetiklenir) bu bir reaktivasyondur, yeni
    -- kullanıcı değildir -- limit kontrolüne girme.
    IF EXISTS (
        SELECT 1 FROM company_members
        WHERE company_id = NEW.company_id AND user_id = NEW.user_id
    ) THEN
        RETURN NEW;
    END IF;

    SELECT max_users INTO v_max_users FROM companies WHERE id = NEW.company_id;
    IF v_max_users IS NULL THEN
        RETURN NEW; -- limit tanımlı değilse serbest bırak
    END IF;

    SELECT count(DISTINCT user_id) INTO v_current_count
    FROM company_members
    WHERE company_id = NEW.company_id;

    IF v_current_count >= v_max_users THEN
        RAISE EXCEPTION 'Kullanıcı limitine ulaşıldı (% kullanıcı). Yeni kişi eklemek için lisansınızı yükseltin.', v_max_users;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_max_users ON public.company_members;
CREATE TRIGGER trg_enforce_max_users
    BEFORE INSERT ON public.company_members
    FOR EACH ROW EXECUTE FUNCTION public.enforce_max_users();

-- 4) Doğrulama: trigger gerçekten eklendi mi?
SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'trg_enforce_max_users';

-- 5) Doğrulama: mevcut firmalarda şu an kaç FARKLI kullanıcı var,
--    limitin üzerinde olan var mı (bilgi amaçlı, hiçbir şeyi değiştirmez).
SELECT c.id, c.name, c.max_users,
       (SELECT count(DISTINCT cm.user_id) FROM company_members cm WHERE cm.company_id = c.id) AS current_users
FROM companies c
ORDER BY c.name;
