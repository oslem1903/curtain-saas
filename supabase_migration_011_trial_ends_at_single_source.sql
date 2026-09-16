-- ============================================================================
-- MIGRATION 011: trial_ends_at TEK dogruluk kaynagi + is_pilot tutarli muafiyet
--
-- HENUZ PRODUCTION'DA CALISTIRILMADI. Once incelenip onaylanacak, sonra
-- Supabase SQL Editor'da elle calistirilacak.
--
-- REVIZYON 4 — revizyon 3'teki "trial_ends_at NULL ise fail-OPEN (now()+1
-- gun'e dusup HER ZAMAN true donen totoloji)" davranisi ONAYLANMADI. Bu
-- revizyon KARAR geregi fail-CLOSED'a cevirir:
--
--   Trial durumunda VE is_pilot=false olan bir firma icin trial_ends_at
--   NULL ise -> artik ERISIM/YAZMA REDDEDILIR (once fail-open'di).
--   Aktif ucretli firmalar (plan_status active/lifetime) bu kontrolden
--   HICBIR SEKILDE etkilenmez. is_pilot=true firmalar (tarih NULL/gecmis
--   olsa da) MUAF olmaya devam eder.
--
-- Bu, canli production'da SU AN trial+pilot-degil+trial_ends_at-NULL
-- durumunda olan (varsa) firmalari BU MIGRATION'IN CALISTIRILMASIYLA
-- ANINDA erisimsiz birakabilecegi anlamina gelir. Bu yuzden migration'a
-- YENI bir "ORPHAN-TRIAL GUARD" eklendi: backfill sonrasi hala bu duruma
-- uyan bir firma varsa, migration COMMIT ETMEDEN RAISE EXCEPTION ile
-- durur ve etkilenen firmalari listeler — boylece kimse habersiz
-- kilitlenmez, karar bilincli verilir.
--
-- ============================================================================
-- PRODUCTION'DA DOGRULANAN GERCEK DURUM (bir onceki salt-okunur inceleme
-- SQL'inin sonucu — degismedi, revizyon 3'te raporlandi):
-- ============================================================================
--   - is_company_writable(uuid): LANGUAGE plpgsql, SECURITY DEFINER,
--     SET search_path TO 'public', VOLATILE, owner postgres, ACL PUBLIC'e
--     acik. 14 RLS policy'sinde canli kullaniliyor (payments, suppliers,
--     employees, companies, order_payment_plans, order_installments).
--   - register_device_and_touch_login(text,text,text): production'da TEK
--     imza/overload, LANGUAGE plpgsql, SECURITY DEFINER, SET search_path
--     TO 'public', VOLATILE, owner postgres, ACL PUBLIC'e acik. Hicbir
--     baska DB nesnesine bagli degil (register_device_dependencies bos).
--   - Backfill on izlemesi (trial_ends_at IS NULL AND trial_end IS NOT
--     NULL): 0 firma. NOT: bu, "trial_end DE trial_ends_at DE NULL" olan
--     firmalari KAPSAMAZ — onlar icin asagidaki YENI orphan-trial guard
--     ayrica kontrol eder.
--
-- ============================================================================
-- YENI KONTROL IFADELERI — UC NOKTA KULLANMADAN TAM METIN (REVIZYON 4,
-- FAIL-CLOSED):
-- ============================================================================
--
-- is_company_writable icindeki YENI trial kontrolu, tam context'iyle:
--
--   AND (
--     COALESCE(c.is_pilot, false) = true
--     OR COALESCE(c.plan_status, 'trial') = 'active'
--     OR COALESCE(c.plan_status, 'trial') = 'lifetime'
--     OR (
--       COALESCE(c.plan_status, 'trial') = 'trial'
--       AND c.trial_ends_at IS NOT NULL
--       AND c.trial_ends_at >= now()
--     )
--   )
--
-- Okunuşu: super admin her zaman gecer (disaridaki is_super_admin() OR'u,
-- degismedi). Aksi halde: gerekli sirket rolu (admin/owner, degismedi) VE
-- asagidaki lisans kosullarindan biri saglanmali:
--   - is_pilot=true  -> HER ZAMAN gecer (tarih NULL/gecmis olsa da).
--   - plan_status='active' veya 'lifetime' -> trial kontrolune HIC
--     girilmez, mevcut ucretli lisans mantigi degismeden calisir.
--   - plan_status='trial' VE pilot degil -> YALNIZCA trial_ends_at DOLU
--     VE gelecekte ise yazabilir. trial_ends_at NULL ise bu kosul FALSE
--     olur (fail-CLOSED) — artik hicbir "now()+1 gun" veya baska tarihe
--     fallback YOKTUR.
--
-- register_device_and_touch_login icindeki YENI expiry kontrolu, tam
-- context'iyle:
--
--   IF v_company.is_active = false OR lower(COALESCE(v_company.plan_status, '')) = 'suspended' THEN
--       RETURN 'suspended';
--   END IF;
--
--   IF lower(COALESCE(v_company.plan_status, '')) = 'expired' THEN
--       RETURN 'expired';
--   END IF;
--
--   IF lower(COALESCE(v_company.plan_status, '')) NOT IN ('active', 'lifetime')
--      AND COALESCE(v_company.is_pilot, false) = false
--      AND (v_company.trial_ends_at IS NULL OR v_company.trial_ends_at < now()) THEN
--       RETURN 'expired';
--   END IF;
--
-- Okunuşu: is_active=false veya plan_status='suspended' -> 'suspended'
-- (degismedi). Acikca plan_status='expired' ise -> 'expired' (trial
-- tarihinden BAGIMSIZ, degismedi). Aksi halde: plan_status active/lifetime
-- DEGILSE (yani "trial durumunda" sayilir) VE is_pilot=false VE
-- (trial_ends_at NULL VEYA gecmis) ise -> 'expired'. is_pilot=true VEYA
-- plan_status active/lifetime ise bu son kontrole HIC girilmez — aktif
-- ucretli firmalar ve pilot firmalar bu NULL kontrolunden ETKILENMEZ.
--
-- KALDIRILANLAR (iki fonksiyonda da):
--   - COALESCE(trial_ends_at, now() + interval '1 day') deseni TAMAMEN
--     kaldirildi (bu totoloji her zaman true donuyordu — suresiz fail-
--     open'di).
--   - trial_end kolonuna HICBIR referans yok (COALESCE zincirinde de,
--     baska hicbir yerde de).
--   - created_at veya baska hicbir tarihe fallback YOK.
--   - Trial tarihi bos oldugunda erisimi GECERLI sayan hicbir kosul yok.
--
-- ============================================================================
-- BU MIGRATION'DA YAPILANLAR:
-- ============================================================================
--   1) GUVENLI BACKFILL: trial_ends_at IS NULL AND trial_end IS NOT NULL
--      olan firmalarda trial_ends_at = trial_end (yalnizca NULL olani
--      doldurur). Su an 0 satiri etkiler.
--   2) PREFLIGHT GUARD: CREATE OR REPLACE'lerden once, iki fonksiyonun da
--      beklenen imza/owner/security/language/search_path ile PRODUCTION'da
--      GERCEKTEN bulundugunu dogrular. Uyusmazlikta RAISE EXCEPTION.
--   3) ORPHAN-TRIAL GUARD (YENI): backfill SONRASI, trial durumunda,
--      is_pilot=false VE trial_ends_at IS NULL olan firma var mi kontrol
--      eder. Varsa bu firmalarin ID/isimlerini listeleyip RAISE EXCEPTION
--      ile migration'i DURDURUR — cunku fail-closed karari bu firmalari
--      ANINDA erisimsiz birakirdi; bu, korlemesine COMMIT edilecek bir
--      durum degil, MANUEL KARAR gerektirir (trial_ends_at set etmek veya
--      is_pilot=true yapmak gibi).
--   4) register_device_and_touch_login(TEXT,TEXT,TEXT) — AYNI imza/dil/
--      SECURITY DEFINER/search_path/volatility; expiry mantigi yukarida
--      aciklanan FAIL-CLOSED kurala gore yeniden yazildi.
--   5) is_company_writable(uuid) — AYNI imza/dil(plpgsql)/SECURITY
--      DEFINER/search_path/volatility, AYNI rol-kontrolu; ic trial kosulu
--      yukarida aciklanan FAIL-CLOSED kurala gore yeniden yazildi.
--   6) Her iki fonksiyon icin GRANT EXECUTE ... TO PUBLIC — YENI/
--      GENISLETILMIS bir yetki DEGIL, production'da zaten PUBLIC'e acik
--      oldugu dogrulanan MEVCUT durumun idempotent teyididir.
--   7) POST-CHECK GUARD (genisletildi): COMMIT'ten hemen once, iki
--      fonksiyonun da (a) trial_end'e nitelikli referans VERMEDIGINI ve
--      (b) eski "interval '1 day'" fail-open desenini ARTIK
--      ICERMEDIGINI dogrular. Herhangi biri basarisizsa RAISE EXCEPTION
--      ile COMMIT ENGELLENIR.
--
-- BU MIGRATION'DA YAPILMAYANLAR (bilinçli):
--   - Baska hicbir lisans/paket alani (plan_status, subscription_status,
--     subscription_plan, license_expires_at, package_code, is_active,
--     read_only) DEGISTIRILMEDI.
--   - is_company_writable()'in ROL KONTROLU veya genel yapisi (is_super_
--     admin() OR (...)) HICBIR SEKILDE degistirilmedi.
--   - Aktif ucretli lisans (plan_status active/lifetime, license_expires_at)
--     mantigina DOKUNULMADI.
--   - trial_end kolonu DROP EDILMEDI.
--   - Hicbir firmanin trial_end/trial_ends_at degeri elle DUZELTILMEDI —
--     ancak ORPHAN-TRIAL GUARD boyle bir firma bulursa migration KENDISI
--     dur ve karar iste (otomatik duzeltme YAPMAZ).
--
-- IDEMPOTENT: Bu dosya guvenle birden fazla kez calistirilabilir (orphan-
-- trial guard'i gecen bir durumda).
-- ============================================================================

BEGIN;

-- ============================================================================
-- PREFLIGHT GUARD — CREATE OR REPLACE'lerden ONCE calisir. Production'daki
-- fonksiyonlarin beklenen imza/owner/security/language/search_path ile
-- BIREBIR eslestigini dogrular. Sapma varsa RAISE EXCEPTION ile bu
-- transaction'daki HICBIR degisiklik uygulanmaz.
--
-- DUZELTME 1 (15.09.2026, calistirilmadan once incelemede bulundu):
-- pg_get_function_identity_arguments(oid) PARAMETRE ADI DONDURMEZ — yalnizca
-- tip listesini dondurur ("text, text, text" / "uuid"). Onceki taslak bunu
-- parametre adlariyla karsilastiriyordu ve HICBIR ZAMAN eslesmiyordu.
--
-- DUZELTME 2 (15.09.2026, DUZELTME 1 SONRASI TEKRAR HATA VERDI): sadece tip
-- listesiyle ("text, text, text") karsilastirmaya gecildikten SONRA bile
-- register_device_and_touch_login preflight'ta bulunamadi — salt-okunur
-- inceleme SELECT'i ise fonksiyonun production'da beklenen imza/owner/
-- security/language/search_path ile GERCEKTEN var oldugunu dogruladi. Yani
-- sorun fonksiyonda degil, STRING KARSILASTIRMA YONTEMININ KENDISINDEYDI
-- (bosluk/formatlama gibi kirilgan bir fark). Bu yuzden yontem TAMAMEN
-- degistirildi: string esitligi yerine, Postgres'in KENDI fonksiyon
-- cozumleme mekanizmasini kullanan to_regprocedure('sema.ad(tip,tip,...)')
-- ile OID araniyor. Bulunamazsa NULL doner (::regprocedure cast'inin
-- aksine hata FIRLATMAZ), boylece kendi RAISE EXCEPTION mesajimizi
-- verebiliyoruz. Bu, dosyanin storage-izolasyon betiginde zaten kullanilan
-- ayni guvenli desendir.
-- ============================================================================

DO $preflight$
DECLARE
  v_rdl_oid oid;
  v_rdl_owner text;
  v_rdl_secdef boolean;
  v_rdl_lang text;
  v_rdl_search_path text;
  v_icw_oid oid;
  v_icw_owner text;
  v_icw_secdef boolean;
  v_icw_lang text;
  v_icw_search_path text;
BEGIN
  v_rdl_oid := to_regprocedure('public.register_device_and_touch_login(text,text,text)');

  IF v_rdl_oid IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: public.register_device_and_touch_login(text,text,text) to_regprocedure ile bulunamadi (NULL dondu) — migration DURDURULDU, hicbir degisiklik uygulanmadi.';
  END IF;

  SELECT r.rolname, p.prosecdef, l.lanname,
         (SELECT split_part(cfg, '=', 2) FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%')
    INTO v_rdl_owner, v_rdl_secdef, v_rdl_lang, v_rdl_search_path
  FROM pg_proc p
  JOIN pg_roles r ON r.oid = p.proowner
  JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = v_rdl_oid;

  IF v_rdl_owner IS DISTINCT FROM 'postgres'
     OR v_rdl_secdef IS DISTINCT FROM true
     OR v_rdl_lang IS DISTINCT FROM 'plpgsql'
     OR v_rdl_search_path IS DISTINCT FROM 'public' THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: register_device_and_touch_login owner/security/language/search_path beklenenden farkli (owner=%, security_definer=%, language=%, search_path=%) — migration DURDURULDU.',
      v_rdl_owner, v_rdl_secdef, v_rdl_lang, v_rdl_search_path;
  END IF;

  v_icw_oid := to_regprocedure('public.is_company_writable(uuid)');

  IF v_icw_oid IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: public.is_company_writable(uuid) to_regprocedure ile bulunamadi (NULL dondu) — migration DURDURULDU, hicbir degisiklik uygulanmadi.';
  END IF;

  SELECT r.rolname, p.prosecdef, l.lanname,
         (SELECT split_part(cfg, '=', 2) FROM unnest(p.proconfig) cfg WHERE cfg LIKE 'search_path=%')
    INTO v_icw_owner, v_icw_secdef, v_icw_lang, v_icw_search_path
  FROM pg_proc p
  JOIN pg_roles r ON r.oid = p.proowner
  JOIN pg_language l ON l.oid = p.prolang
  WHERE p.oid = v_icw_oid;

  IF v_icw_owner IS DISTINCT FROM 'postgres'
     OR v_icw_secdef IS DISTINCT FROM true
     OR v_icw_lang IS DISTINCT FROM 'plpgsql'
     OR v_icw_search_path IS DISTINCT FROM 'public' THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: is_company_writable owner/security/language/search_path beklenenden farkli (owner=%, security_definer=%, language=%, search_path=%) — migration DURDURULDU.',
      v_icw_owner, v_icw_secdef, v_icw_lang, v_icw_search_path;
  END IF;

  RAISE NOTICE 'PREFLIGHT PASS: her iki fonksiyon da beklenen imza/owner/security/language/search_path ile bulundu (to_regprocedure ile OID cozumlendi).';
END;
$preflight$;

-- ============================================================================
-- 1) GUVENLI BACKFILL — yalnizca trial_ends_at BOS ve trial_end DOLU olan
--    firmalari kapsar. Mevcut bir trial_ends_at degeri ASLA ezilmez.
-- ============================================================================

UPDATE public.companies
SET trial_ends_at = trial_end
WHERE trial_ends_at IS NULL
  AND trial_end IS NOT NULL;

-- ============================================================================
-- ORPHAN-TRIAL GUARD (YENI) — backfill SONRASI calisir. Fail-closed karari
-- devreye girmeden ONCE, trial durumunda + is_pilot=false + trial_ends_at
-- HALA NULL olan (ne trial_end'den backfill edilebilmis ne hic set
-- edilmemis) firma var mi kontrol eder. Varsa bu firmalar bu migration ile
-- ANINDA erisimsiz kalacagi icin, migration KORLEMESINE COMMIT ETMEZ —
-- RAISE EXCEPTION ile durur, etkilenen firmalari listeler, manuel karar
-- (trial_ends_at set etmek veya is_pilot=true yapmak) ister.
--
-- "Trial durumunda" tanimi: is_active VE plan_status suspended/expired
-- DEGIL VE plan_status active/lifetime DEGIL (iki fonksiyonun kendi
-- tanimiyla ayni) — suspended/expired firmalar zaten ayri yollarla
-- engellendigi icin burada tekrar sayilmaz.
-- ============================================================================

DO $orphan_check$
DECLARE
  v_orphan_count int;
  v_orphan_list text;
BEGIN
  SELECT count(*), string_agg(id::text || ' (' || COALESCE(name, 'isimsiz') || ')', '; ')
    INTO v_orphan_count, v_orphan_list
  FROM public.companies
  WHERE COALESCE(is_active, true) = true
    AND COALESCE(plan_status, 'trial') NOT IN ('active', 'lifetime', 'suspended', 'expired')
    AND COALESCE(is_pilot, false) = false
    AND trial_ends_at IS NULL;

  IF v_orphan_count > 0 THEN
    RAISE EXCEPTION 'MANUEL KARAR GEREKLI: % firma trial durumunda, pilot degil ve trial_ends_at NULL — fail-closed kurali bu firmalari bu migration ile ANINDA erisimsiz birakir. Etkilenen firmalar: %. Migration DURDURULDU, HICBIR degisiklik uygulanmadi — devam etmeden once bu firmalarin trial_ends_at degerini elle set edin veya is_pilot=true yapin, sonra migration''i tekrar calistirin.',
      v_orphan_count, v_orphan_list;
  END IF;

  RAISE NOTICE 'ORPHAN-TRIAL GUARD PASS: trial durumunda, pilot olmayan ve trial_ends_at NULL olan firma yok (0 satir) — fail-closed kurali guvenle uygulanabilir.';
END;
$orphan_check$;

-- ============================================================================
-- 2) register_device_and_touch_login — AYNI imza/dil/SECURITY DEFINER/
--    search_path/volatility. Expiry mantigi FAIL-CLOSED kurala gore
--    yeniden yazildi (yukaridaki "YENI KONTROL IFADELERI" bolumune bakin).
--    Govde icinde "trial_end" veya "interval '1 day'" GECMEZ.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.register_device_and_touch_login(
    p_device_id TEXT,
    p_user_agent TEXT DEFAULT NULL::text,
    p_device_name TEXT DEFAULT NULL::text
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_company companies%ROWTYPE;
    v_company_id UUID;
    v_device_count INT;
    v_existing_active BOOLEAN;
BEGIN
    IF EXISTS (SELECT 1 FROM profiles WHERE user_id = auth.uid() AND role = 'super_admin') THEN
        RETURN 'ok';
    END IF;

    SELECT company_id INTO v_company_id
    FROM company_members
    WHERE user_id = auth.uid() AND COALESCE(is_active, true)
    ORDER BY created_at LIMIT 1;

    IF v_company_id IS NULL THEN RETURN 'no_company'; END IF;

    SELECT * INTO v_company FROM companies WHERE id = v_company_id;

    IF v_company.is_active = false OR lower(COALESCE(v_company.plan_status, '')) = 'suspended' THEN
        RETURN 'suspended';
    END IF;

    IF lower(COALESCE(v_company.plan_status, '')) = 'expired' THEN
        RETURN 'expired';
    END IF;

    IF lower(COALESCE(v_company.plan_status, '')) NOT IN ('active', 'lifetime')
       AND COALESCE(v_company.is_pilot, false) = false
       AND (v_company.trial_ends_at IS NULL OR v_company.trial_ends_at < now()) THEN
        RETURN 'expired';
    END IF;

    SELECT is_active INTO v_existing_active
    FROM company_devices
    WHERE company_id = v_company_id AND device_id = p_device_id;

    IF v_existing_active IS NOT NULL THEN
        IF v_existing_active = false THEN
            SELECT count(*) INTO v_device_count
            FROM company_devices
            WHERE company_id = v_company_id AND COALESCE(is_active, true);

            IF v_device_count >= COALESCE(v_company.max_devices, default_device_limit_for_package(COALESCE(v_company.package_code, v_company.subscription_plan))) THEN
                RETURN 'device_limit';
            END IF;
        END IF;

        UPDATE company_devices
        SET last_seen_at = now(),
            user_id = auth.uid(),
            user_agent = COALESCE(p_user_agent, user_agent),
            device_name = COALESCE(p_device_name, device_name),
            browser_name = COALESCE(parse_browser_name(p_user_agent), browser_name),
            os_name = COALESCE(parse_os_name(p_user_agent), os_name),
            ip_address = COALESCE(inet_client_addr(), ip_address),
            is_active = true,
            deactivated_at = NULL,
            deactivated_by = NULL
        WHERE company_id = v_company_id AND device_id = p_device_id;
    ELSE
        SELECT count(*) INTO v_device_count
        FROM company_devices
        WHERE company_id = v_company_id AND COALESCE(is_active, true);

        IF v_device_count >= COALESCE(v_company.max_devices, default_device_limit_for_package(COALESCE(v_company.package_code, v_company.subscription_plan))) THEN
            RETURN 'device_limit';
        END IF;

        INSERT INTO company_devices (
            company_id, user_id, device_id, user_agent, device_name,
            browser_name, os_name, ip_address, is_active
        )
        VALUES (
            v_company_id, auth.uid(), p_device_id, p_user_agent, p_device_name,
            parse_browser_name(p_user_agent), parse_os_name(p_user_agent), inet_client_addr(), true
        )
        ON CONFLICT (company_id, device_id) DO NOTHING;
    END IF;

    UPDATE companies SET last_login_at = now() WHERE id = v_company_id;

    RETURN 'ok';
END;
$function$;

-- Asagidaki GRANT YENI bir yetki OLUSTURMAZ: production inceleme sonucunda
-- bu fonksiyonun EXECUTE yetkisinin zaten PUBLIC'e (anon/authenticated/
-- service_role dahil) acik oldugu dogrulandi. Bu satir yalnizca CREATE OR
-- REPLACE sonrasi ayni mevcut durumu idempotent sekilde yeniden beyan eder.
GRANT EXECUTE ON FUNCTION public.register_device_and_touch_login(TEXT, TEXT, TEXT) TO PUBLIC;

-- ============================================================================
-- 3) is_company_writable — AYNI imza/dil(plpgsql)/SECURITY DEFINER/
--    search_path/volatility, AYNI rol-kontrolu + is_pilot bypass yapisi.
--    Trial kosulu FAIL-CLOSED kurala gore yeniden yazildi (yukaridaki
--    "YENI KONTROL IFADELERI" bolumune bakin). Govde icinde "trial_end"
--    veya "interval '1 day'" GECMEZ.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_company_writable(p_company_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN (
    is_super_admin()
    OR (
      EXISTS (
        SELECT 1
        FROM public.company_members
        WHERE user_id = auth.uid()
          AND company_id = p_company_id
          AND role IN ('admin', 'owner')
      )
      AND EXISTS (
        SELECT 1
        FROM public.companies c
        WHERE c.id = p_company_id
          AND COALESCE(c.is_active, true) = true
          AND COALESCE(c.read_only, false) = false
          AND COALESCE(c.plan_status, 'trial') NOT IN ('suspended', 'expired')
          AND (
            COALESCE(c.is_pilot, false) = true
            OR COALESCE(c.plan_status, 'trial') = 'active'
            OR COALESCE(c.plan_status, 'trial') = 'lifetime'
            OR (
              COALESCE(c.plan_status, 'trial') = 'trial'
              AND c.trial_ends_at IS NOT NULL
              AND c.trial_ends_at >= now()
            )
          )
      )
    )
  );
END;
$function$;

-- Asagidaki GRANT YENI bir yetki OLUSTURMAZ: production inceleme sonucunda
-- bu fonksiyonun EXECUTE yetkisinin zaten PUBLIC'e (anon/authenticated/
-- service_role dahil) acik oldugu dogrulandi. Bu satir yalnizca CREATE OR
-- REPLACE sonrasi ayni mevcut durumu idempotent sekilde yeniden beyan eder.
GRANT EXECUTE ON FUNCTION public.is_company_writable(uuid) TO PUBLIC;

-- ============================================================================
-- POST-CHECK GUARD (genisletildi) — COMMIT'ten hemen once calisir. Iki
-- fonksiyonun da guncel govdesinde:
--   (a) trial_end kolonuna NITELIKLI referans (ornegin "c.trial_end" veya
--       "v_company.trial_end") KALMADIGINI — regex \.trial_end([^s]|$)
--       bilerek "trial_ends_at" ile ESLESMEZ (sonrasinda 's' gelir).
--   (b) eski "interval '1 day'" FAIL-OPEN desenini ARTIK ICERMEDIGINI
--       dogrular.
-- Herhangi bir kontrol basarisizsa VEYA fonksiyon beklenen imzada
-- bulunamiyorsa RAISE EXCEPTION ile COMMIT ENGELLENIR ve bu transaction'daki
-- TUM degisiklikler (backfill + iki CREATE OR REPLACE + iki GRANT) geri
-- alinir.
-- ============================================================================

DO $postcheck$
DECLARE
  v_rdl_oid oid;
  v_icw_oid oid;
  v_rdl_def text;
  v_icw_def text;
BEGIN
  v_rdl_oid := to_regprocedure('public.register_device_and_touch_login(text,text,text)');

  IF v_rdl_oid IS NULL THEN
    RAISE EXCEPTION 'DOGRULAMA BASARISIZ: public.register_device_and_touch_login(text,text,text) degistirme sonrasi to_regprocedure ile bulunamadi — COMMIT ENGELLENDI.';
  END IF;

  SELECT pg_get_functiondef(v_rdl_oid) INTO v_rdl_def;

  IF v_rdl_def ~ '\.trial_end([^s]|$)' THEN
    RAISE EXCEPTION 'DOGRULAMA BASARISIZ: register_device_and_touch_login hala trial_end kolonuna nitelikli referans veriyor — COMMIT ENGELLENDI, tum degisiklikler geri alinacak.';
  END IF;

  IF v_rdl_def ILIKE '%interval ''1 day''%' THEN
    RAISE EXCEPTION 'DOGRULAMA BASARISIZ: register_device_and_touch_login hala eski fail-open (interval ''1 day'') desenini iceriyor — COMMIT ENGELLENDI, tum degisiklikler geri alinacak.';
  END IF;

  v_icw_oid := to_regprocedure('public.is_company_writable(uuid)');

  IF v_icw_oid IS NULL THEN
    RAISE EXCEPTION 'DOGRULAMA BASARISIZ: public.is_company_writable(uuid) degistirme sonrasi to_regprocedure ile bulunamadi — COMMIT ENGELLENDI.';
  END IF;

  SELECT pg_get_functiondef(v_icw_oid) INTO v_icw_def;

  IF v_icw_def ~ '\.trial_end([^s]|$)' THEN
    RAISE EXCEPTION 'DOGRULAMA BASARISIZ: is_company_writable hala trial_end kolonuna nitelikli referans veriyor — COMMIT ENGELLENDI, tum degisiklikler geri alinacak.';
  END IF;

  IF v_icw_def ILIKE '%interval ''1 day''%' THEN
    RAISE EXCEPTION 'DOGRULAMA BASARISIZ: is_company_writable hala eski fail-open (interval ''1 day'') desenini iceriyor — COMMIT ENGELLENDI, tum degisiklikler geri alinacak.';
  END IF;

  RAISE NOTICE 'DOGRULAMA PASS: iki fonksiyon da artik trial_end kolonuna referans vermiyor ve eski fail-open (interval 1 gun) desenini icermiyor.';
END;
$postcheck$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- COMMIT SONRASI, AYRICA calistirip gozle teyit etmek icin (opsiyonel):
--
-- 1) select id, name, is_pilot, plan_status, trial_end, trial_ends_at
--    from public.companies
--    where trial_ends_at is null and trial_end is not null;
--    -- Beklenen: 0 satir.
--
-- 2) select id, name, plan_status, is_pilot, trial_ends_at
--    from public.companies
--    where coalesce(is_active, true) = true
--      and coalesce(plan_status, 'trial') not in ('active','lifetime','suspended','expired')
--      and coalesce(is_pilot, false) = false
--      and trial_ends_at is null;
--    -- Beklenen: 0 satir (migration zaten bunu preflight olarak da kontrol etti).
--
-- 3) select proname, proowner::regrole, prosecdef, provolatile, proconfig, proacl
--    from pg_proc
--    where proname in ('register_device_and_touch_login', 'is_company_writable')
--      and prokind = 'f';
--    -- owner/security/volatility/proconfig/proacl'in migration ONCESI
--    -- aldigin inceleme sonucuyla birebir ayni oldugunu teyit edin.
-- ============================================================================

COMMIT;
