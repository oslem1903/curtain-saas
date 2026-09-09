-- ============================================================================
-- TEK SEFERLIK, HEDEFLI VERI DUZELTMESI — yalnizca 2 exact firma ID'si icin.
--
-- HENUZ PRODUCTION'DA CALISTIRILMADI. Once incelenip onaylanacak, sonra
-- Supabase SQL Editor'da elle calistirilacak. Migration 011 revizyon 4,
-- ORPHAN-TRIAL GUARD'i asagidaki 2 firma yuzunden durdurmustu (trial
-- durumunda, is_pilot=false, trial_ends_at NULL). Salt-okunur inceleme
-- sonucu (musteri/siparis/odeme/ticket/cihaz sayilari) degerlendirildi:
--
--   Test Company 2 (80fef6ae-a1bc-4fd1-9af0-d7b40f6938b3):
--     0 musteri, 0 siparis, 0 odeme, 0 ticket, 1 aktif uye, 0 cihaz.
--   Test Company 1 (87fd5e69-4a04-4fbd-bea9-038de4dbdd5e):
--     1 musteri, 1 siparis, 0 odeme, 1 acik ticket, 1 aktif uye,
--     1 aktif cihaz + gecmis login aktivitesi.
--
-- KARAR: Iki firma da SILINMEYECEK, is_pilot=true YAPILMAYACAK. Mevcut
-- kayitlar korunarak FAIL-CLOSED birakilacak — ancak trial_ends_at'in
-- SONSUZA KADAR NULL kalmasi yerine, HER trial firmasi icin gecerli olan
-- AYNI genel kurala (provisioning aninda trial_start/created_at + kanonik
-- deneme suresi) gore GERCEK bir tarihe backfill edilecek. Bu tarih zaten
-- gecmiste kalacagi icin sonuc ayni: firmalar kilitli kalir — ama artik
-- "tanimsiz NULL" degil, diger tum firmalarla AYNI mantikla hesaplanmis
-- gercek bir trial_ends_at degerine sahip olacaklar.
--
-- KANONIK DENEME SURESI: 7 GUN.
-- Kaynak (varsayim DEGIL, repodaki GERCEK kod/kolon varsayilanlarindan
-- dogrulandi — hepsi ayni degerde birlesiyor):
--   - companies.trial_ends_at kolon varsayilani: DEFAULT (now() + interval
--     '7 days')  [supabase_7_day_trial_admin.sql, supabase_fix_provision_
--     trial_rpc.sql, supabase_subscription_auth.sql, supabase_super_admin_
--     trial_rpc.sql]
--   - provision_trial_admin(...) RPC'sinin TUM revizyonlarinda p_trial_days
--     integer DEFAULT 7  [supabase_fix_provision_trial_rpc.sql,
--     supabase_pilot_saas_hardening.sql, supabase_invite_code_flow.sql,
--     supabase_invite_token_pgcrypto_hotfix.sql, supabase_schema_repair_
--     invites_errors.sql, supabase_super_admin_trial_rpc.sql]
-- Hicbir dosya farkli bir varsayilan sure kullanmiyor — 7 gun, bu repoda
-- trial suresi icin TEK ve tutarli kanonik degerdir.
--
-- TABAN TARIH: COALESCE(trial_start, created_at) — firmanin kendi
-- trial_start'i varsa o, yoksa created_at kullanilir (baska hicbir
-- firmaya veya baska hicbir tarihe REFERANS verilmez).
--
-- GUARD'LAR (hepsi UPDATE'ten ONCE calisir, uymayan durumda RAISE
-- EXCEPTION ile TUM transaction geri alinir, HICBIR SATIR degismez):
--   1) Her iki ID de companies tablosunda bulunmali.
--   2) name alani BEKLENEN isimle (Test Company 1 / Test Company 2)
--      BIREBIR eslesmeli — production inceleme sonucunda dogrulanan
--      gercek isimler.
--   3) plan_status='trial' VE is_pilot=false VE trial_ends_at IS NULL
--      olmali (guard'in orijinal olarak durdugu TAM durum) — baska bir
--      duruma denk gelirse (birisi bu arada elle degistirmisse) islem
--      DURDURULUR, korlemesine UZERINE YAZILMAZ.
--   4) Hesaplanan yeni trial_ends_at GECMISTE olmali (fail-closed sonucun
--      korunmasi icin) — degilse (beklenmedik sekilde yakin tarihli
--      created_at ile karsilasilirsa) islem DURDURULUR, manuel karar
--      istenir.
--
-- SONRASI (UPDATE'ten SONRA, COMMIT'ten ONCE calisir):
--   5) Tam olarak 2 satirin guncellendigi dogrulanir (ne az ne fazla).
--   6) Iki firmanin da: trial_ends_at artik NULL degil VE gecmiste;
--      plan_status, is_pilot, subscription_plan, subscription_status
--      guncelleme ONCESINDEKI ile BIREBIR AYNI (yani bu alanlara
--      DOKUNULMADI) dogrulanir.
--   7) Bu iki ID DISINDAKI hicbir firmanin "trial + pilot degil + NULL"
--      durumunun DEGISMEDIGI (once/sonra sayisi ayni) dogrulanir — baska
--      hicbir firmaya yan etki olmadiginin kaniti.
--
-- BU SQL'DE DOKUNULMAYANLAR (bilinçli): subscription_plan,
-- subscription_status, is_pilot, plan_status, is_active, read_only,
-- customers/orders/order_items/payments (is verileri), company_members,
-- company_devices, support_tickets — SADECE trial_ends_at kolonu, SADECE
-- bu 2 satirda degisir.
-- ============================================================================

BEGIN;

DO $fix_test_company_trials$
DECLARE
  v_trial_days CONSTANT int := 7;
  v_id_1 CONSTANT uuid := '87fd5e69-4a04-4fbd-bea9-038de4dbdd5e'; -- Test Company 1
  v_id_2 CONSTANT uuid := '80fef6ae-a1bc-4fd1-9af0-d7b40f6938b3'; -- Test Company 2
  v_expected_name_1 CONSTANT text := 'Test Company 1';
  v_expected_name_2 CONSTANT text := 'Test Company 2';

  v_name_1 text; v_plan_status_1 text; v_is_pilot_1 boolean; v_trial_ends_at_1 timestamptz;
  v_trial_start_1 timestamptz; v_created_at_1 timestamptz; v_subscription_plan_1 text; v_subscription_status_1 text;
  v_is_active_1 boolean; v_read_only_1 boolean;

  v_name_2 text; v_plan_status_2 text; v_is_pilot_2 boolean; v_trial_ends_at_2 timestamptz;
  v_trial_start_2 timestamptz; v_created_at_2 timestamptz; v_subscription_plan_2 text; v_subscription_status_2 text;
  v_is_active_2 boolean; v_read_only_2 boolean;

  v_new_trial_ends_at_1 timestamptz;
  v_new_trial_ends_at_2 timestamptz;

  v_other_orphan_before int;
  v_other_orphan_after int;

  v_updated_count int;

  v_post_plan_status_1 text; v_post_is_pilot_1 boolean; v_post_trial_ends_at_1 timestamptz;
  v_post_subscription_plan_1 text; v_post_subscription_status_1 text; v_post_is_active_1 boolean; v_post_read_only_1 boolean;

  v_post_plan_status_2 text; v_post_is_pilot_2 boolean; v_post_trial_ends_at_2 timestamptz;
  v_post_subscription_plan_2 text; v_post_subscription_status_2 text; v_post_is_active_2 boolean; v_post_read_only_2 boolean;
BEGIN
  -- --------------------------------------------------------------------
  -- PREFLIGHT — mevcut durumu oku ve dogrula (henuz hicbir yazma yok).
  -- --------------------------------------------------------------------
  SELECT name, plan_status, is_pilot, trial_ends_at, trial_start, created_at,
         subscription_plan, subscription_status, is_active, read_only
    INTO v_name_1, v_plan_status_1, v_is_pilot_1, v_trial_ends_at_1, v_trial_start_1, v_created_at_1,
         v_subscription_plan_1, v_subscription_status_1, v_is_active_1, v_read_only_1
  FROM public.companies WHERE id = v_id_1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: ID % (Test Company 1 olmasi beklenen) companies tablosunda bulunamadi — islem DURDURULDU.', v_id_1;
  END IF;

  IF v_name_1 IS DISTINCT FROM v_expected_name_1 THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: ID % icin beklenen isim "%" ama bulunan isim "%" — isim eslesmiyor, islem DURDURULDU (yanlis firmaya dokunulmasin diye).', v_id_1, v_expected_name_1, v_name_1;
  END IF;

  IF v_plan_status_1 IS DISTINCT FROM 'trial' OR COALESCE(v_is_pilot_1, false) <> false OR v_trial_ends_at_1 IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: ID % (Test Company 1) beklenen durumda degil (plan_status=%, is_pilot=%, trial_ends_at=%) — bu SQL SADECE plan_status=trial, is_pilot=false, trial_ends_at IS NULL durumunu duzeltir. Islem DURDURULDU, HICBIR SATIR degismedi.', v_id_1, v_plan_status_1, v_is_pilot_1, v_trial_ends_at_1;
  END IF;

  SELECT name, plan_status, is_pilot, trial_ends_at, trial_start, created_at,
         subscription_plan, subscription_status, is_active, read_only
    INTO v_name_2, v_plan_status_2, v_is_pilot_2, v_trial_ends_at_2, v_trial_start_2, v_created_at_2,
         v_subscription_plan_2, v_subscription_status_2, v_is_active_2, v_read_only_2
  FROM public.companies WHERE id = v_id_2;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: ID % (Test Company 2 olmasi beklenen) companies tablosunda bulunamadi — islem DURDURULDU.', v_id_2;
  END IF;

  IF v_name_2 IS DISTINCT FROM v_expected_name_2 THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: ID % icin beklenen isim "%" ama bulunan isim "%" — isim eslesmiyor, islem DURDURULDU (yanlis firmaya dokunulmasin diye).', v_id_2, v_expected_name_2, v_name_2;
  END IF;

  IF v_plan_status_2 IS DISTINCT FROM 'trial' OR COALESCE(v_is_pilot_2, false) <> false OR v_trial_ends_at_2 IS NOT NULL THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: ID % (Test Company 2) beklenen durumda degil (plan_status=%, is_pilot=%, trial_ends_at=%) — bu SQL SADECE plan_status=trial, is_pilot=false, trial_ends_at IS NULL durumunu duzeltir. Islem DURDURULDU, HICBIR SATIR degismedi.', v_id_2, v_plan_status_2, v_is_pilot_2, v_trial_ends_at_2;
  END IF;

  -- --------------------------------------------------------------------
  -- YENI trial_ends_at HESABI — kanonik 7 gun, kendi trial_start/created_at
  -- tabaninda. Baska hicbir firmaya/tarihe referans YOK.
  -- --------------------------------------------------------------------
  v_new_trial_ends_at_1 := COALESCE(v_trial_start_1, v_created_at_1) + make_interval(days => v_trial_days);
  v_new_trial_ends_at_2 := COALESCE(v_trial_start_2, v_created_at_2) + make_interval(days => v_trial_days);

  IF v_new_trial_ends_at_1 >= now() THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: ID % (Test Company 1) icin hesaplanan trial_ends_at (%) GECMISTE DEGIL — beklenen fail-closed sonuc bozulur, islem DURDURULDU (manuel karar gerekir).', v_id_1, v_new_trial_ends_at_1;
  END IF;

  IF v_new_trial_ends_at_2 >= now() THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: ID % (Test Company 2) icin hesaplanan trial_ends_at (%) GECMISTE DEGIL — beklenen fail-closed sonuc bozulur, islem DURDURULDU (manuel karar gerekir).', v_id_2, v_new_trial_ends_at_2;
  END IF;

  -- --------------------------------------------------------------------
  -- YAN ETKI KONTROLU (ONCE) — bu 2 ID DISINDA "trial+pilot degil+NULL"
  -- durumunda kac firma var, UPDATE'ten SONRA da AYNI sayida olmali.
  -- --------------------------------------------------------------------
  SELECT count(*) INTO v_other_orphan_before
  FROM public.companies
  WHERE id NOT IN (v_id_1, v_id_2)
    AND COALESCE(plan_status, 'trial') = 'trial'
    AND COALESCE(is_pilot, false) = false
    AND trial_ends_at IS NULL;

  -- --------------------------------------------------------------------
  -- TEK GUNCELLEME — YALNIZCA trial_ends_at, YALNIZCA bu 2 ID, YALNIZCA
  -- guard kosullari hala saglaniyorsa (WHERE'de tekrar dogrulanir).
  -- --------------------------------------------------------------------
  UPDATE public.companies
  SET trial_ends_at = CASE id
        WHEN v_id_1 THEN v_new_trial_ends_at_1
        WHEN v_id_2 THEN v_new_trial_ends_at_2
      END
  WHERE id IN (v_id_1, v_id_2)
    AND plan_status = 'trial'
    AND COALESCE(is_pilot, false) = false
    AND trial_ends_at IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count <> 2 THEN
    RAISE EXCEPTION 'DOGRULAMA BASARISIZ: beklenen 2 satir yerine % satir guncellendi — islem DURDURULDU, TUM degisiklikler geri alinacak.', v_updated_count;
  END IF;

  -- --------------------------------------------------------------------
  -- POST-CHECK — her iki satir da beklenen sonucta mi, BASKA HICBIR ALAN
  -- degismedi mi.
  -- --------------------------------------------------------------------
  SELECT plan_status, is_pilot, trial_ends_at, subscription_plan, subscription_status, is_active, read_only
    INTO v_post_plan_status_1, v_post_is_pilot_1, v_post_trial_ends_at_1,
         v_post_subscription_plan_1, v_post_subscription_status_1, v_post_is_active_1, v_post_read_only_1
  FROM public.companies WHERE id = v_id_1;

  IF v_post_trial_ends_at_1 IS NULL OR v_post_trial_ends_at_1 >= now() THEN
    RAISE EXCEPTION 'DOGRULAMA BASARISIZ: ID % (Test Company 1) guncelleme sonrasi trial_ends_at beklenen gibi degil (NULL veya gelecekte): %', v_id_1, v_post_trial_ends_at_1;
  END IF;

  IF v_post_plan_status_1 IS DISTINCT FROM v_plan_status_1
     OR v_post_is_pilot_1 IS DISTINCT FROM v_is_pilot_1
     OR v_post_subscription_plan_1 IS DISTINCT FROM v_subscription_plan_1
     OR v_post_subscription_status_1 IS DISTINCT FROM v_subscription_status_1
     OR v_post_is_active_1 IS DISTINCT FROM v_is_active_1
     OR v_post_read_only_1 IS DISTINCT FROM v_read_only_1 THEN
    RAISE EXCEPTION 'DOGRULAMA BASARISIZ: ID % (Test Company 1) icin trial_ends_at DISINDA bir alan degismis — beklenmeyen yan etki, islem DURDURULDU.', v_id_1;
  END IF;

  SELECT plan_status, is_pilot, trial_ends_at, subscription_plan, subscription_status, is_active, read_only
    INTO v_post_plan_status_2, v_post_is_pilot_2, v_post_trial_ends_at_2,
         v_post_subscription_plan_2, v_post_subscription_status_2, v_post_is_active_2, v_post_read_only_2
  FROM public.companies WHERE id = v_id_2;

  IF v_post_trial_ends_at_2 IS NULL OR v_post_trial_ends_at_2 >= now() THEN
    RAISE EXCEPTION 'DOGRULAMA BASARISIZ: ID % (Test Company 2) guncelleme sonrasi trial_ends_at beklenen gibi degil (NULL veya gelecekte): %', v_id_2, v_post_trial_ends_at_2;
  END IF;

  IF v_post_plan_status_2 IS DISTINCT FROM v_plan_status_2
     OR v_post_is_pilot_2 IS DISTINCT FROM v_is_pilot_2
     OR v_post_subscription_plan_2 IS DISTINCT FROM v_subscription_plan_2
     OR v_post_subscription_status_2 IS DISTINCT FROM v_subscription_status_2
     OR v_post_is_active_2 IS DISTINCT FROM v_is_active_2
     OR v_post_read_only_2 IS DISTINCT FROM v_read_only_2 THEN
    RAISE EXCEPTION 'DOGRULAMA BASARISIZ: ID % (Test Company 2) icin trial_ends_at DISINDA bir alan degismis — beklenmeyen yan etki, islem DURDURULDU.', v_id_2;
  END IF;

  -- --------------------------------------------------------------------
  -- YAN ETKI KONTROLU (SONRA) — baska hicbir firmaya dokunulmadi mi.
  -- --------------------------------------------------------------------
  SELECT count(*) INTO v_other_orphan_after
  FROM public.companies
  WHERE id NOT IN (v_id_1, v_id_2)
    AND COALESCE(plan_status, 'trial') = 'trial'
    AND COALESCE(is_pilot, false) = false
    AND trial_ends_at IS NULL;

  IF v_other_orphan_before IS DISTINCT FROM v_other_orphan_after THEN
    RAISE EXCEPTION 'DOGRULAMA BASARISIZ: bu 2 ID DISINDAKI firmalarin trial-orphan durumu degisti (once=%, sonra=%) — beklenmeyen yan etki, islem DURDURULDU.', v_other_orphan_before, v_other_orphan_after;
  END IF;

  RAISE NOTICE 'BASARILI: Test Company 1 (%) trial_ends_at = % olarak ayarlandi. Test Company 2 (%) trial_ends_at = % olarak ayarlandi. Baska hicbir alan/firma degismedi.',
    v_id_1, v_post_trial_ends_at_1, v_id_2, v_post_trial_ends_at_2;
END;
$fix_test_company_trials$;

-- ============================================================================
-- COMMIT SONRASI, AYRICA calistirip gozle teyit etmek icin (opsiyonel):
--
-- select id, name, plan_status, is_pilot, trial_start, created_at,
--        trial_end, trial_ends_at, subscription_plan, subscription_status
-- from public.companies
-- where id in ('87fd5e69-4a04-4fbd-bea9-038de4dbdd5e', '80fef6ae-a1bc-4fd1-9af0-d7b40f6938b3');
-- -- Beklenen: her iki satirda da trial_ends_at DOLU ve GECMISTE; diger
-- -- tum alanlar (subscription_plan/status, is_pilot, plan_status) bu
-- -- calistirmadan ONCEKI degerleriyle AYNI.
-- ============================================================================

COMMIT;
