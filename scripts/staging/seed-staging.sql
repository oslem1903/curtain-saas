-- TEST ortami tohum verisi. Yalnizca yapilandirma: musteri/firma/kullanici verisi YOK.
-- Gerekli: sema aktarimi + supabase_migration_032_billing_core_DRAFT.sql (test ortaminda uygulanmis).
INSERT INTO public.self_signup_settings (id, enabled, trial_days)
VALUES (1, true, 7)
ON CONFLICT (id) DO UPDATE SET trial_days = 7;

-- Plan fiyatlari TEST degeridir; iyzico_plan_ref iyzico SANDBOX panelinde olusturulan plan referans kodlariyla doldurulur.
INSERT INTO public.billing_plans (code, name, period, price_minor, currency, package_code, iyzico_plan_ref)
VALUES
  ('solo_monthly', 'Solo Perdeci — Aylık', 'month', 99900,  'TRY', 'solo', NULL),
  ('solo_yearly',  'Solo Perdeci — Yıllık', 'year',  999000, 'TRY', 'solo', NULL)
ON CONFLICT (code) DO NOTHING;
