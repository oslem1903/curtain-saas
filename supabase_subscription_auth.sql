-- =========================================================================================
-- CURTAIN SAAS: LICENSING & SUBSCRIPTION SCHEMA PATCH
-- =========================================================================================
-- Bu SQL dosyasını Supabase arayüzünden (SQL Editor) çalıştırarak 
-- Trial (Deneme) hesap ve Lisanslı hesap mantığını veritabanı seviyesine taşıyabilirsiniz.

-- 1. COMPANIES TABLOSUNA GEREKLI SUTUNLARIN EKLENMESI
-- (Eğer tablonuzda bu veya bu isimlerde kolonlar yoksa hata vermeden oluşturacaktır.)
ALTER TABLE public.companies
ADD COLUMN IF NOT EXISTS subscription_plan TEXT DEFAULT 'trial', -- 'trial', 'lifetime'
ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + interval '7 days');

-- Device binding (Cihaz kilidi) Profile tablosunda olmalı
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS bound_device_id TEXT;


-- 2. KENDİ KENDİNE KAYIT OLMAYI (SELF-SIGNUP) TAMAMEN KAPATMA
-- Uyarı: Bunu Supabase arayüzünden Authentication > Configuration menüsünden
-- "Enable email signup" ayarını kapatarak arayüzden yapmanız en doğrusudur.
-- SQL seviyesinde trigger ile de yasaklayabilirsiniz:

CREATE OR REPLACE FUNCTION public.check_user_signup()
RETURNS trigger AS $$
BEGIN
  -- Dışarıdan manuel kaydı engellemek için hata fırlatabiliriz.
  -- RAISE EXCEPTION 'Self-signup is disabled by policy.';
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger'ı auth.users veya public.profiles'a bağlayabiliriz (Profiles daha yaygın)
-- DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
-- CREATE TRIGGER on_auth_user_created BEFORE INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.check_user_signup();



-- 3. GLOBAL READ-ONLY (YALNIZCA OKUMA) GÜVENLİK YAZILIMI (RLS)
--
-- Gerçek bir kısıtlama istiyorsanız, tüm tablolarınıza (orders, customers, vb.) 
-- aşağıdaki gibi bir kontrol fonksiyonu bağlayabilirsiniz.
-- İşlemden önce abonelik bitmişse hata fırlatır.

CREATE OR REPLACE FUNCTION public.check_subscription_active(company_uuid uuid)
RETURNS boolean AS $$
DECLARE
  v_plan TEXT;
  v_ends TIMESTAMP WITH TIME ZONE;
BEGIN
  -- company_uuid NULL ise (eski hatalı kayıtlar) işlemi engelleme ama uyar
  IF company_uuid IS NULL THEN
     RETURN TRUE; 
  END IF;

  SELECT subscription_plan, trial_ends_at 
  INTO v_plan, v_ends
  FROM public.companies 
  WHERE id = company_uuid;

  -- Kayıt bulunamadıysa (geçersiz ID)
  IF v_plan IS NULL THEN
    RETURN TRUE;
  END IF;

  IF v_plan = 'lifetime' THEN
    RETURN true;
  END IF;

  IF v_plan = 'trial' AND now() > v_ends THEN
    RETURN false;
  END IF;
  
  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =========================================================================================
-- KRITIK: NULL COMPANY_ID ONARIMI (Ekran görüntüsündeki NULL hatası için)
-- =========================================================================================
-- Eğer tablolarınızda company_id kolonları boş (NULL) kalmışsa, aşağıdaki komutları
-- kendi şirket ID'nizle (87f97199... ile başlayan ID) güncelleyerek çalıştırın.

-- Örnek (Sadece 1 şirketiniz varsa hepsini ona bağlar):
-- UPDATE public.orders SET company_id = (SELECT id FROM public.companies LIMIT 1) WHERE company_id IS NULL;
-- UPDATE public.customers SET company_id = (SELECT id FROM public.companies LIMIT 1) WHERE company_id IS NULL;
-- UPDATE public.appointments SET company_id = (SELECT id FROM public.companies LIMIT 1) WHERE company_id IS NULL;

-- Örnek: Orders (Siparişler) tablosu için Insert engelleme RLS kuralı (Policy)
-- (Sisteminizi tam kilitlemek için bunu her tabloda yapabilirsiniz. VEYA frontend'den yapabilirsiniz)

-- RLS Politikalarını Etkinleştir
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Block insert if trial expired" ON public.orders FOR INSERT WITH CHECK (public.check_subscription_active(company_id));
CREATE POLICY "Block update if trial expired" ON public.orders FOR UPDATE USING (public.check_subscription_active(company_id));
CREATE POLICY "Block delete if trial expired" ON public.orders FOR DELETE USING (public.check_subscription_active(company_id));

CREATE POLICY "Block all if trial expired" ON public.customers FOR ALL USING (public.check_subscription_active(company_id));
CREATE POLICY "Block all if trial expired" ON public.appointments FOR ALL USING (public.check_subscription_active(company_id));
CREATE POLICY "Block all if trial expired" ON public.expenses FOR ALL USING (public.check_subscription_active(company_id));


-- =========================================================================================
-- BAŞARILI KURULUM SONRASI
-- 1. Özel müşteriler ('Hülya' vb.) için Supabase -> Table Editor kullanarak
--    Şirket satırındaki subscription_plan hücresini 'lifetime' olarak güncelleyiniz.
-- 2. Eğer cihaza bağlamak istiyorsanız 'bound_device_id' sütununa kişinin 
--    sabit cihaz kimliğini girerek backend üzerinde ek kısıtlama yaratabilirsiniz.
-- =========================================================================================
