-- SALT OKUNUR: deneme/lisans kilidi teşhisi. Hiçbir veriyi değiştirmez.
-- perdepro (ffhmzlcsgsgjonqqhgqq) projesinde SQL Editor'da çalıştırın, çıktıyı gönderin.

-- 1) Her firmanın lisans durumu ve şu an DOLMUŞ sayılıp sayılmadığı
SELECT
  c.name,
  c.plan_status,
  c.subscription_plan,
  c.subscription_status,
  c.is_pilot,
  c.is_active,
  c.read_only,
  c.trial_ends_at,
  c.license_expires_at,
  (c.trial_ends_at < now())                                   AS deneme_bitmis_mi,
  CASE
    WHEN c.is_pilot THEN 'PILOT: hic kilitlenmez'
    WHEN c.plan_status IN ('active','lifetime') THEN 'ODEMELI: trial kilidi uygulanmaz'
    WHEN c.plan_status = 'expired' THEN 'KILITLI (expired)'
    WHEN c.trial_ends_at IS NULL THEN 'KILITLI (tarih yok, fail-closed)'
    WHEN c.trial_ends_at < now() THEN 'KILITLI (deneme bitti)'
    ELSE 'ACIK (deneme suruyor)'
  END                                                          AS beklenen_durum
FROM public.companies c
ORDER BY c.name;

-- 2) Sunucu tarafı yazma kilidi canlıda nasıl tanımlı? (trial_ends_at kontrolü görünmeli,
--    'interval 1 day' fallback OLMAMALI)
SELECT pg_get_functiondef(p.oid) AS is_company_writable_tanimi
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'is_company_writable';

-- 3) Bu fonksiyona bağlı yazma tetikleyicileri/politikaları hangi tablolarda var?
SELECT tablename, policyname, cmd
FROM pg_policies
WHERE schemaname = 'public' AND (qual ILIKE '%is_company_writable%' OR with_check ILIKE '%is_company_writable%')
ORDER BY tablename, policyname;
