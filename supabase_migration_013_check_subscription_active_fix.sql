-- ============================================================================
-- MIGRATION 013 (TASLAK) — check_subscription_active() YANLIŞ KOLONU OKUYOR.
--
-- HENÜZ PRODUCTION'DA ÇALIŞTIRILMADI. Kullanıcı isteği üzerine, ayrı onay
-- BEKLENMEDEN taslak olarak hazırlandı — UYGULAMA ONAYI, test sonuçları
-- (özellikle canlı akış testleri) tamamlandıktan SONRA ayrıca istenecek.
--
-- ============================================================================
-- BULGU — CANLI DOĞRULAMA (2026-09-09, süper admin salt-okunur oturumla)
-- ============================================================================
--
-- MEVCUT (production'daki) tanım — supabase_subscription_auth.sql:44-75,
-- BAŞKA HİÇBİR dosya bunu CREATE OR REPLACE ETMİYOR (migration 011/012 dahil):
--
--   CREATE OR REPLACE FUNCTION public.check_subscription_active(company_uuid uuid)
--   RETURNS boolean AS $$
--   DECLARE
--     v_plan TEXT;
--     v_ends TIMESTAMP WITH TIME ZONE;
--   BEGIN
--     IF company_uuid IS NULL THEN RETURN TRUE; END IF;
--     SELECT subscription_plan, trial_ends_at INTO v_plan, v_ends
--       FROM public.companies WHERE id = company_uuid;
--     IF v_plan IS NULL THEN RETURN TRUE; END IF;
--     IF v_plan = 'lifetime' THEN RETURN true; END IF;
--     IF v_plan = 'trial' AND now() > v_ends THEN RETURN false; END IF;
--     RETURN true;
--   END;
--   $$ LANGUAGE plpgsql SECURITY DEFINER;
--   -- NOT: SET search_path YOK (ayrı bir bulgu, bu migration'da da düzeltiliyor).
--
-- SORUN: Bu fonksiyon `subscription_plan` kolonunu okuyor. Ama sistemin GERÇEK
-- deneme/lisans yaşam-döngüsü durumu `plan_status` kolonunda tutuluyor
-- (Dashboard.tsx, Layout.tsx, migration 011, src/utils/trialLicense.ts hepsi
-- plan_status kullanıyor — bkz. migration 011). `subscription_plan` farklı
-- bir kavram gibi görünüyor (paket adı: 'solo'/'starter'/'pro'/'lifetime').
-- Bu 2 kolon BAĞIMSIZ ve production'da ÇOĞU firmada UYUŞMUYOR.
--
-- CANLI DOĞRULAMA SORGUSU (2026-09-09, süper admin oturumuyla, salt-okunur):
--
--   select id, name, subscription_plan, plan_status, trial_ends_at, is_active
--   from public.companies;
--
--   -- Ardından JS/istemci tarafında şu ölçütle filtrelendi (aynı SQL WHERE'e
--   -- çevrilebilir):
--   --   subscription_plan <> 'trial'
--   --   AND plan_status IN ('trial','expired','suspended')
--   -- (yani: check_subscription_active'in gerçek durumu YOK SAYIP her zaman
--   -- true dönmesine neden olan durum — subscription_plan zaten 'trial'
--   -- DEĞİLSE fonksiyon trial_ends_at kontrolüne HİÇ girmiyor.)
--
--   Aynı sonuç SQL'de:
--   select count(*) from public.companies
--   where subscription_plan is distinct from 'trial'
--     and plan_status in ('trial','expired','suspended');
--
-- SONUÇ (2026-09-09 itibarıyla): 37 firmanın 31'i bu ölçüte uyuyor —
-- subscription_plan çoğunlukla 'solo'/'starter'/'pro'/'lifetime' (bir paket
-- adı gibi), plan_status='trial', trial_ends_at ÇOĞUNLUKLA GEÇMİŞTE (bazıları
-- 5 ay önce). Örnek: Test Company 1/2 (subscription_plan='lifetime',
-- plan_status='trial', trial_ends_at o an geçmişteydi — bu migration
-- hazırlanmadan ÖNCE ayrıca test amacıyla geleceğe taşındı, bkz.
-- supabase_extend_test_company_trial_for_qa.sql). Bu bulgu, canlı bir
-- production ortamındaki GERÇEK veriden geliyor — sabit/varsayımsal değil;
-- ancak bu migration çalıştırılmadan HEMEN ÖNCE aynı sorgu TEKRAR
-- çalıştırılıp güncel sayı teyit edilmeli (zaman içinde değişmiş olabilir).
--
-- ETKİ: check_subscription_active() şu 13 dosyadaki SECURITY DEFINER
-- fonksiyonların TAMAMINDA lisans/deneme-süresi kapısı olarak kullanılıyor
-- (bkz. 2026-09-09 QA oturumu bulgu 6c): record_income_entry,
-- record_expense_entry, record_order_payment, record_invoice_save,
-- record_installer_payment, cancel_installer_payment, record_supplier_payment
-- (supabase_payment_transaction_safety.sql — migration 012 taslağı bunlara
-- FARKLI bir kontrol — firma-yetki — ekliyor, check_subscription_active
-- çağrısına DOKUNMUYOR), customer_record_collection/cancel_collection,
-- supplier_record_payment/cancel_payment, installer_record_payment/
-- cancel_payment/add_manual_earning, create/rebuild/cancel_order_installment_plan
-- (migration 010 — GERÇEKTEN CANLI KULLANIMDA, bkz. 7e). Yani bu bulgu
-- (subscription_plan yanlış kolon) migration 011/012'DEN TAMAMEN BAĞIMSIZ,
-- AYRI bir sorun — üçü de aynı "trial_ends_at tek doğruluk kaynağı olmalı"
-- ilkesinin farklı bir ihlalini düzeltiyor:
--   - Migration 011: is_company_writable() / register_device_and_touch_login()
--     — trial_end (donuk kolon) yerine trial_ends_at kullanmalarını sağladı.
--   - Migration 012 (taslak): finansal RPC'lere firma-yetki kontrolü ekliyor
--     (AYRI bir güvenlik açığı — bu migration'la İLGİSİZ).
--   - Migration 013 (bu dosya): check_subscription_active() — trial_ends_at'i
--     HİÇ OKUMAYAN (subscription_plan'e bakan) davranışını düzeltiyor.
--
-- BU MİGRASYONDA YAPILAN: migration 011'deki (trialLicense.ts ile de birebir
-- aynı) FAIL-CLOSED kurala göre yeniden yazım:
--   - is_pilot=true -> HER ZAMAN true (muaf).
--   - plan_status IN ('active','lifetime') -> true (trial kontrolüne hiç girmez).
--   - plan_status='expired' veya 'suspended' -> false.
--   - Aksi halde (plan_status='trial' veya NULL): trial_ends_at NULL veya
--     geçmişteyse -> false (fail-closed). trial_ends_at gelecekteyse -> true.
--   - `subscription_plan` kolonuna ARTIK HİÇ BAKILMIYOR.
--   - SET search_path = public eklendi (ayrı, düşük riskli hijyen düzeltmesi).
--
-- BU MİGRASYONDA YAPILMAYAN: migration 012'nin (firma-yetki kontrolü) veya
-- başka hiçbir fonksiyonun/politikanın DEĞİŞTİRİLMESİ. `subscription_plan`
-- kolonunun kendisi (silinmedi/değiştirilmedi) veya başka hiçbir firma alanı.
--
-- UYGULAMA ÖNCESİ GEREKENLER (kullanıcıdan onay istenmeden ÖNCE tamamlanmalı):
--   1) Bu migration'ın ana kullanıcı akışı (ölçü→teklif→sipariş→tahsilat→montaj)
--      canlı testleri BAŞARIYLA tamamlanmış olmalı (bu fonksiyon o akışların
--      bazılarını — sipariş tahsilatı, montajcı/tedarikçi ödemesi — dolaylı
--      olarak etkiliyor).
--   2) Yukarıdaki doğrulama sorgusu TEKRAR çalıştırılıp "31 firma" sayısının
--      güncel olduğu (ya da değiştiği) teyit edilmeli.
--   3) Fail-closed'a geçişin ANINDA erişimsiz bırakacağı firmalar için (31
--      firmanın çoğu muhtemelen zaten trial_ends_at'i geçmiş) ayrı bir
--      iletişim/aksiyon planı (lisans satışı, deneme uzatma vb.) kullanıcı
--      tarafından değerlendirilmeli — bu SADECE bir teknik düzeltme değil,
--      bir İŞ KARARI da içeriyor (bir gecede 31 firmanın finansal işlem
--      yapamaz hale gelmesi anlamına gelebilir).
-- ============================================================================

BEGIN;

DO $preflight$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'check_subscription_active'
      AND pg_get_function_identity_arguments(p.oid) = 'company_uuid uuid'
  ) THEN
    RAISE EXCEPTION 'PREFLIGHT BASARISIZ: check_subscription_active(uuid) beklenen imzada bulunamadi — migration DURDURULDU.';
  END IF;
  RAISE NOTICE 'PREFLIGHT PASS.';
END;
$preflight$;

CREATE OR REPLACE FUNCTION public.check_subscription_active(company_uuid uuid)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_plan_status text;
  v_is_pilot boolean;
  v_trial_ends_at timestamptz;
BEGIN
  IF company_uuid IS NULL THEN
    RETURN TRUE;
  END IF;

  SELECT plan_status, is_pilot, trial_ends_at
    INTO v_plan_status, v_is_pilot, v_trial_ends_at
  FROM public.companies
  WHERE id = company_uuid;

  IF NOT FOUND THEN
    RETURN TRUE;
  END IF;

  IF COALESCE(v_is_pilot, false) = true THEN
    RETURN true;
  END IF;

  IF COALESCE(v_plan_status, 'trial') IN ('active', 'lifetime') THEN
    RETURN true;
  END IF;

  IF COALESCE(v_plan_status, 'trial') IN ('expired', 'suspended') THEN
    RETURN false;
  END IF;

  -- Aksi halde 'trial' (veya NULL) sayılır — fail-closed: trial_ends_at NULL
  -- veya geçmişteyse false.
  RETURN v_trial_ends_at IS NOT NULL AND v_trial_ends_at >= now();
END;
$$;

DO $postcheck$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'check_subscription_active';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'DOGRULAMA BASARISIZ: check_subscription_active bulunamadi — COMMIT ENGELLENDI.';
  END IF;
  IF v_def ILIKE '%subscription_plan%' THEN
    RAISE EXCEPTION 'DOGRULAMA BASARISIZ: check_subscription_active hala subscription_plan okuyor — COMMIT ENGELLENDI.';
  END IF;
  IF v_def NOT ILIKE '%search_path=public%' AND v_def NOT ILIKE '%search_path = public%' AND v_def NOT ILIKE '%SET search_path TO ''public''%' THEN
    RAISE EXCEPTION 'DOGRULAMA BASARISIZ: search_path pinlenmemis — COMMIT ENGELLENDI.';
  END IF;
  RAISE NOTICE 'DOGRULAMA PASS: check_subscription_active artik plan_status/trial_ends_at/is_pilot okuyor, search_path pinli.';
END;
$postcheck$;

NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- COMMIT SONRASI TEYİT (opsiyonel):
--
-- 1) select proname, prosecdef, proconfig from pg_proc where proname = 'check_subscription_active';
--    -- proconfig içinde 'search_path=public' görünmeli.
--
-- 2) -- Migration ÖNCESİ "etkilenen" sayılan firmaların bir kısmını seçip
--    -- (örn. Test Company 1/2 + 2-3 gerçek firma), bu migration SONRASI
--    -- check_subscription_active(id) çağırıp beklenen sonucu (plan_status/
--    -- trial_ends_at'e göre) verdiğini doğrulayın:
--    select id, name, plan_status, is_pilot, trial_ends_at,
--           public.check_subscription_active(id) as is_active_now
--    from public.companies
--    where id in (/* ... */);
--
-- 3) Regresyon: aktif ücretli (plan_status='active'/'lifetime') bir firmada
--    gelir/gider/tahsilat/montajcı-ödemesi işlemlerinin ESKİSİ GİBİ
--    çalıştığını doğrulayın (bu migration onları HİÇ etkilememeli).
-- ============================================================================

COMMIT;
