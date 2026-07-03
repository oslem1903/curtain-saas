-- ============================================================================
-- INSTALLER COMMISSION — TRIGGER TEMİZLİĞİ (Production Safe, v2)
-- ============================================================================
-- Bu sürüm, montaj işi tamamlandığında/silindiğinde veya ödeme girildiğinde
-- OTOMATİK 'earning'/'adjustment'/'payment' kaydı üreten trigger'ları İÇERMEZ.
--
-- NEDEN (supabase_supplier_cari_automation.sql ile aynı mimari):
--   Uygulama (src/pages/InstallerLedger.tsx) montajcı cari'sini ZATEN tek
--   kaynaktan yönetiyor:
--     • Hakediş (earned) = TAMAMLANAN işlerin installation_jobs.installer_fee
--       toplamı (ekranda hesaplanır; installer_transactions'a YAZILMAZ).
--     • installer_transactions = YALNIZCA ödeme ('payment') ve iptal ('cancel')
--       kayıtlarını tutar (uygulama elle ekler).
--   Otomatik 'earning' üreten trigger'lar, aynı hakedişi İKİNCİ bir kaynak
--   olarak yazıyor ve montajcı bakiyesini ÇİFT sayıyordu (job-fee modeli ile
--   transaction modeli ayrışıyordu). installer_payments üzerindeki otomatik
--   'payment' trigger'ı da, uygulama ödemeyi doğrudan installer_transactions'a
--   yazdığı için kullanılmıyor; devreye girerse ödemeyi çift sayardı.
--
-- BU YÜZDEN:
--   1) Çift sayım/ayrışma üreten earning ve auto-payment trigger'ları ile
--      fonksiyonları idempotent olarak KALDIRILIR (önceki kısmi kurulumdan
--      kalmışsa temizler; yoksa no-op). DROP TRIGGER IF EXISTS yapısı korunur.
--   2) installer_fee TEK DOĞRULUK KAYNAĞI olarak bırakılır (yazma trigger'ı yok
--      → çakışma/çift sayım yok).
--   3) RPC'ler (get_installer_cari_summary / get_installer_ledger) BU DOSYADA
--      DEĞİŞTİRİLMEZ; onlar supabase_installer_commission_schema.sql içindedir.
--
-- VERİ KAYBI YOK: yalnızca trigger/fonksiyon kaldırılır; hiçbir tablo, kolon
-- veya satır SİLİNMEZ. Idempotent: birden çok kez güvenle çalıştırılabilir.
--
-- BAĞIMLILIK SIRASI (değişmedi): modular_saas_upgrade (installer_payments,
-- installation_jobs) → installation_workflow (job kolonları) →
-- installer_ledger (installer_transactions) → commission_schema
-- (installer_earnings + ALTER + RPC'ler) → BU DOSYA.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) CLEANUP — Otomatik earning üreten trigger'lar (installation_jobs üzerinde)
--    DROP TRIGGER IF EXISTS yapısı korunur; önce trigger'lar, sonra fonksiyonlar.
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_installation_job_completed ON public.installation_jobs;
DROP TRIGGER IF EXISTS on_installation_job_deleted   ON public.installation_jobs;

-- ----------------------------------------------------------------------------
-- 2) CLEANUP — Otomatik payment yazan trigger (installer_payments üzerinde)
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS on_installer_payment_created ON public.installer_payments;

-- ----------------------------------------------------------------------------
-- 3) CLEANUP — Trigger fonksiyonları (trigger'lar kaldırıldıktan SONRA)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.on_installation_job_completed();
DROP FUNCTION IF EXISTS public.on_installation_job_deleted();
DROP FUNCTION IF EXISTS public.on_installer_payment_created();

-- ============================================================================
-- 4) PostgREST şema cache yenileme
-- ============================================================================
NOTIFY pgrst, 'reload schema';

-- ============================================================================
-- 5) SONUÇ — Yazma trigger'larının kalmadığını doğrula
-- ============================================================================
SELECT 'SONUC: installer earning/payment yazma trigger temizligi' AS check_name,
       NOT EXISTS (
           SELECT 1 FROM pg_trigger
           WHERE NOT tgisinternal
             AND tgname IN (
                 'on_installation_job_completed',
                 'on_installation_job_deleted',
                 'on_installer_payment_created'
             )
       ) AS ok;
