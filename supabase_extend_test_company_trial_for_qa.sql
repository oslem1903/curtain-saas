-- ============================================================================
-- TEK SEFERLIK, HEDEFLI VERI DUZELTMESI — yalnizca 2 exact test firma ID'si icin.
--
-- HENUZ PRODUCTION'DA CALISTIRILMADI. Once incelenip onaylanacak.
--
-- AMAC: Test Company 1/2, gercek bir deneme-suresi-dolmus firma senaryosunu
-- temsil etmek uzere bilincli olarak GECMISTE bir trial_ends_at'e sahipti
-- (bkz. supabase_fix_test_company_trial_ends_at.sql, 2026-07-02). Bu, dogru
-- ve kasitli bir durumdu — ama simdi bu 2 firma AYNI ZAMANDA E2E yazma
-- testleri (siparis/tahsilat/montaj akislarini GERCEKTEN calistirma) icin de
-- kullanilmasi gerekiyor, ve trial_ends_at gecmiste oldugu surece uygulama
-- (dogru sekilde) tum yazma islemlerini engelliyor ("Deneme süreniz
-- dolmuştur" banner'i + salt-okunur mod).
--
-- BU SCRIPT LISANS KONTROLUNU DEVRE DISI BIRAKMAZ — is_company_writable(),
-- check_subscription_active(), frontend'deki trialLicense.ts mantigi HICBIRI
-- DEGISTIRILMIYOR. Yalnizca bu 2 test firmasinin trial_ends_at'i GELECEGE
-- tasinarak, AYNI kontrolleri "aktif deneme" olarak GECMELERI saglaniyor —
-- tipki gercek bir yeni musterinin denemesi gibi. Gercek hicbir firmaya
-- dokunulmuyor.
--
-- GUARD'LAR (UPDATE'ten ONCE calisir, uymayan durumda RAISE EXCEPTION ile
-- TUM transaction geri alinir, HICBIR SATIR degismez):
--   1) Her iki ID de companies tablosunda, BEKLENEN isimle (Test Company 1/2)
--      bulunmali.
--   2) Her ikisinin de is_pilot=false, plan_status='trial' olmali (guard'in
--      hedefledigi TAM durum) — baska bir duruma denk gelirse DURDURULUR.
--   3) Her ikisinin de customers/orders/payments SIFIR olmali (gercek is
--      verisi ICEREN bir firmaya YANLISLIKLA dokunulmasin diye) — degilse
--      DURDURULUR.
--   4) Mevcut trial_ends_at, bilinen deger (2026-07-02T12:23:19.328922+00)
--      ile BIREBIR eslesmeli — birisi bu arada elle degistirmisse islem
--      DURDURULUR, korlemesine UZERINE YAZILMAZ.
--
-- SONRASI (UPDATE'ten SONRA, COMMIT'ten ONCE calisir):
--   5) Tam olarak 2 satirin guncellendigi dogrulanir.
--   6) Iki firmanin da: trial_ends_at artik GELECEKTE; is_pilot, plan_status,
--      subscription_plan, is_active, read_only guncelleme ONCESINDEKI ile
--      BIREBIR AYNI (bu alanlara DOKUNULMADI) dogrulanir.
--   7) Bu iki ID DISINDAKI hicbir firmanin trial_ends_at'inin DEGISMEDIGI
--      dogrulanir.
--
-- YENI trial_ends_at: now() + 180 gun (test suresince rahat bir pencere,
-- gercek bir deneme suresiyle KARISTIRILMAMASI icin normal 7 gunluk kanonik
-- sureden bilincli olarak FARKLI/UZUN tutuldu).
--
-- ROLLBACK: bu 2 ID icin trial_ends_at'i tekrar '2026-07-02T12:23:19.328922+00'
-- yapan bir UPDATE (asagida, COMMIT sonrasi bolumde hazir).
-- ============================================================================

BEGIN;

DO $extend_test_company_trials$
DECLARE
  v_id_1 CONSTANT uuid := '87fd5e69-4a04-4fbd-bea9-038de4dbdd5e'; -- Test Company 1
  v_id_2 CONSTANT uuid := '80fef6ae-a1bc-4fd1-9af0-d7b40f6938b3'; -- Test Company 2
  v_expected_name_1 CONSTANT text := 'Test Company 1';
  v_expected_name_2 CONSTANT text := 'Test Company 2';
  v_expected_old_trial_ends_at CONSTANT timestamptz := '2026-07-02T12:23:19.328922+00';
  v_new_trial_ends_at CONSTANT timestamptz := now() + interval '180 days';

  v_name_1 text; v_plan_status_1 text; v_is_pilot_1 boolean; v_trial_ends_at_1 timestamptz;
  v_subscription_plan_1 text; v_is_active_1 boolean; v_read_only_1 boolean;
  v_customers_1 int; v_orders_1 int; v_payments_1 int;

  v_name_2 text; v_plan_status_2 text; v_is_pilot_2 boolean; v_trial_ends_at_2 timestamptz;
  v_subscription_plan_2 text; v_is_active_2 boolean; v_read_only_2 boolean;
  v_customers_2 int; v_orders_2 int; v_payments_2 int;

  v_other_count_before int;
  v_other_count_after int;
  v_updated_count int;

  v_post_is_pilot_1 boolean; v_post_plan_status_1 text; v_post_subscription_plan_1 text;
  v_post_is_active_1 boolean; v_post_read_only_1 boolean; v_post_trial_ends_at_1 timestamptz;
  v_post_is_pilot_2 boolean; v_post_plan_status_2 text; v_post_subscription_plan_2 text;
  v_post_is_active_2 boolean; v_post_read_only_2 boolean; v_post_trial_ends_at_2 timestamptz;
BEGIN
  -- --------------------------------------------------------------------
  -- PREFLIGHT
  -- --------------------------------------------------------------------
  SELECT name, plan_status, is_pilot, trial_ends_at, subscription_plan, is_active, read_only
    INTO v_name_1, v_plan_status_1, v_is_pilot_1, v_trial_ends_at_1, v_subscription_plan_1, v_is_active_1, v_read_only_1
  FROM public.companies WHERE id = v_id_1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: ID % (Test Company 1) bulunamadi — islem DURDURULDU.', v_id_1;
  END IF;
  IF v_name_1 IS DISTINCT FROM v_expected_name_1 THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: ID % icin beklenen isim "%" ama bulunan "%" — islem DURDURULDU.', v_id_1, v_expected_name_1, v_name_1;
  END IF;
  IF v_plan_status_1 IS DISTINCT FROM 'trial' OR COALESCE(v_is_pilot_1, false) <> false THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: ID % (Test Company 1) beklenen durumda degil (plan_status=%, is_pilot=%) — islem DURDURULDU.', v_id_1, v_plan_status_1, v_is_pilot_1;
  END IF;
  IF v_trial_ends_at_1 IS DISTINCT FROM v_expected_old_trial_ends_at THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: ID % (Test Company 1) trial_ends_at beklenenden farkli (%), birisi elle degistirmis olabilir — islem DURDURULDU.', v_id_1, v_trial_ends_at_1;
  END IF;

  SELECT count(*) FILTER (WHERE true) INTO v_customers_1 FROM public.customers WHERE company_id = v_id_1;
  SELECT count(*) INTO v_orders_1 FROM public.orders WHERE company_id = v_id_1;
  SELECT count(*) INTO v_payments_1 FROM public.payments WHERE company_id = v_id_1;
  IF v_customers_1 <> 0 OR v_orders_1 <> 0 OR v_payments_1 <> 0 THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: ID % (Test Company 1) gercek is verisi iceriyor (musteri=%, siparis=%, odeme=%) — bu bir TEST firmasi gibi gorunmuyor, islem DURDURULDU.', v_id_1, v_customers_1, v_orders_1, v_payments_1;
  END IF;

  SELECT name, plan_status, is_pilot, trial_ends_at, subscription_plan, is_active, read_only
    INTO v_name_2, v_plan_status_2, v_is_pilot_2, v_trial_ends_at_2, v_subscription_plan_2, v_is_active_2, v_read_only_2
  FROM public.companies WHERE id = v_id_2;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: ID % (Test Company 2) bulunamadi — islem DURDURULDU.', v_id_2;
  END IF;
  IF v_name_2 IS DISTINCT FROM v_expected_name_2 THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: ID % icin beklenen isim "%" ama bulunan "%" — islem DURDURULDU.', v_id_2, v_expected_name_2, v_name_2;
  END IF;
  IF v_plan_status_2 IS DISTINCT FROM 'trial' OR COALESCE(v_is_pilot_2, false) <> false THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: ID % (Test Company 2) beklenen durumda degil (plan_status=%, is_pilot=%) — islem DURDURULDU.', v_id_2, v_plan_status_2, v_is_pilot_2;
  END IF;
  IF v_trial_ends_at_2 IS DISTINCT FROM v_expected_old_trial_ends_at THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: ID % (Test Company 2) trial_ends_at beklenenden farkli (%), birisi elle degistirmis olabilir — islem DURDURULDU.', v_id_2, v_trial_ends_at_2;
  END IF;

  SELECT count(*) INTO v_customers_2 FROM public.customers WHERE company_id = v_id_2;
  SELECT count(*) INTO v_orders_2 FROM public.orders WHERE company_id = v_id_2;
  SELECT count(*) INTO v_payments_2 FROM public.payments WHERE company_id = v_id_2;
  IF v_customers_2 <> 0 OR v_orders_2 <> 0 OR v_payments_2 <> 0 THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: ID % (Test Company 2) gercek is verisi iceriyor (musteri=%, siparis=%, odeme=%) — islem DURDURULDU.', v_id_2, v_customers_2, v_orders_2, v_payments_2;
  END IF;

  -- --------------------------------------------------------------------
  -- YAN ETKI KONTROLU (ONCE) — bu 2 ID disindaki hicbir firmanin
  -- trial_ends_at'i bu islemden ETKILENMEMELI.
  -- --------------------------------------------------------------------
  SELECT count(*) INTO v_other_count_before
  FROM public.companies WHERE id NOT IN (v_id_1, v_id_2) AND trial_ends_at = v_expected_old_trial_ends_at;

  -- --------------------------------------------------------------------
  -- TEK GUNCELLEME — YALNIZCA trial_ends_at, YALNIZCA bu 2 ID.
  -- --------------------------------------------------------------------
  UPDATE public.companies
  SET trial_ends_at = v_new_trial_ends_at
  WHERE id IN (v_id_1, v_id_2)
    AND plan_status = 'trial'
    AND COALESCE(is_pilot, false) = false
    AND trial_ends_at = v_expected_old_trial_ends_at;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  IF v_updated_count <> 2 THEN
    RAISE EXCEPTION 'DOGRULAMA BASARISIZ: beklenen 2 satir yerine % satir guncellendi — islem DURDURULDU, TUM degisiklikler geri alinacak.', v_updated_count;
  END IF;

  -- --------------------------------------------------------------------
  -- POST-CHECK
  -- --------------------------------------------------------------------
  SELECT is_pilot, plan_status, subscription_plan, is_active, read_only, trial_ends_at
    INTO v_post_is_pilot_1, v_post_plan_status_1, v_post_subscription_plan_1, v_post_is_active_1, v_post_read_only_1, v_post_trial_ends_at_1
  FROM public.companies WHERE id = v_id_1;
  IF v_post_trial_ends_at_1 <= now() THEN
    RAISE EXCEPTION 'DOGRULAMA BASARISIZ: ID % (Test Company 1) guncelleme sonrasi trial_ends_at hala gecmiste: %', v_id_1, v_post_trial_ends_at_1;
  END IF;
  IF v_post_is_pilot_1 IS DISTINCT FROM v_is_pilot_1 OR v_post_plan_status_1 IS DISTINCT FROM v_plan_status_1
     OR v_post_subscription_plan_1 IS DISTINCT FROM v_subscription_plan_1 OR v_post_is_active_1 IS DISTINCT FROM v_is_active_1
     OR v_post_read_only_1 IS DISTINCT FROM v_read_only_1 THEN
    RAISE EXCEPTION 'DOGRULAMA BASARISIZ: ID % (Test Company 1) icin trial_ends_at DISINDA bir alan degismis — islem DURDURULDU.', v_id_1;
  END IF;

  SELECT is_pilot, plan_status, subscription_plan, is_active, read_only, trial_ends_at
    INTO v_post_is_pilot_2, v_post_plan_status_2, v_post_subscription_plan_2, v_post_is_active_2, v_post_read_only_2, v_post_trial_ends_at_2
  FROM public.companies WHERE id = v_id_2;
  IF v_post_trial_ends_at_2 <= now() THEN
    RAISE EXCEPTION 'DOGRULAMA BASARISIZ: ID % (Test Company 2) guncelleme sonrasi trial_ends_at hala gecmiste: %', v_id_2, v_post_trial_ends_at_2;
  END IF;
  IF v_post_is_pilot_2 IS DISTINCT FROM v_is_pilot_2 OR v_post_plan_status_2 IS DISTINCT FROM v_plan_status_2
     OR v_post_subscription_plan_2 IS DISTINCT FROM v_subscription_plan_2 OR v_post_is_active_2 IS DISTINCT FROM v_is_active_2
     OR v_post_read_only_2 IS DISTINCT FROM v_read_only_2 THEN
    RAISE EXCEPTION 'DOGRULAMA BASARISIZ: ID % (Test Company 2) icin trial_ends_at DISINDA bir alan degismis — islem DURDURULDU.', v_id_2;
  END IF;

  SELECT count(*) INTO v_other_count_after
  FROM public.companies WHERE id NOT IN (v_id_1, v_id_2) AND trial_ends_at = v_expected_old_trial_ends_at;
  IF v_other_count_before IS DISTINCT FROM v_other_count_after THEN
    RAISE EXCEPTION 'DOGRULAMA BASARISIZ: bu 2 ID DISINDAKI firmalarin trial_ends_at durumu degisti (once=%, sonra=%) — islem DURDURULDU.', v_other_count_before, v_other_count_after;
  END IF;

  RAISE NOTICE 'BASARILI: Test Company 1 (%) ve Test Company 2 (%) trial_ends_at = % (simdiden +180 gun) olarak ayarlandi. Baska hicbir alan/firma degismedi.',
    v_id_1, v_id_2, v_new_trial_ends_at;
END;
$extend_test_company_trials$;

COMMIT;

-- ============================================================================
-- ROLLBACK (gerekirse, elle calistirin):
--
-- UPDATE public.companies
-- SET trial_ends_at = '2026-07-02T12:23:19.328922+00'
-- WHERE id IN ('87fd5e69-4a04-4fbd-bea9-038de4dbdd5e', '80fef6ae-a1bc-4fd1-9af0-d7b40f6938b3')
--   AND plan_status = 'trial' AND COALESCE(is_pilot, false) = false;
--
-- COMMIT SONRASI TEYIT:
-- SELECT id, name, plan_status, is_pilot, trial_ends_at, subscription_plan, is_active, read_only
-- FROM public.companies
-- WHERE id IN ('87fd5e69-4a04-4fbd-bea9-038de4dbdd5e', '80fef6ae-a1bc-4fd1-9af0-d7b40f6938b3');
-- -- Beklenen: trial_ends_at artik ~180 gun sonrasinda, diger tum alanlar AYNI.
-- ============================================================================
