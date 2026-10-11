-- Migration 024 SONRASI DOGRULAMA — SALT OKUNUR. Tek sonuc tablosu doner.
WITH checks AS (
  SELECT 'fn start_self_service_trial' AS kontrol,
         (to_regprocedure('public.start_self_service_trial(text,text)') IS NOT NULL)::text AS sonuc,
         'true' AS beklenen
  UNION ALL SELECT 'fn company_subscription_allows_write',
         (to_regprocedure('public.company_subscription_allows_write(uuid)') IS NOT NULL)::text, 'true'
  UNION ALL SELECT 'fn enforce_company_subscription_write',
         (to_regprocedure('public.enforce_company_subscription_write()') IS NOT NULL)::text, 'true'
  UNION ALL SELECT 'start_self_service_trial SECURITY DEFINER',
         coalesce((SELECT p.prosecdef::text FROM pg_proc p WHERE p.oid = to_regprocedure('public.start_self_service_trial(text,text)')), 'yok'), 'true'
  UNION ALL SELECT 'anon start_self_service_trial calistirabilir mi',
         coalesce(has_function_privilege('anon', 'public.start_self_service_trial(text,text)', 'EXECUTE')::text, 'yok'), 'false'
  UNION ALL SELECT 'authenticated start_self_service_trial calistirabilir mi',
         coalesce(has_function_privilege('authenticated', 'public.start_self_service_trial(text,text)', 'EXECUTE')::text, 'yok'), 'true'
  UNION ALL SELECT 'handle_new_user metadata rolune guvenmiyor',
         (pg_get_functiondef('public.handle_new_user()'::regprocedure) NOT LIKE '%raw_user_meta_data->>''role''%')::text, 'true'
  UNION ALL SELECT 'on_auth_user_created tetikleyicisi',
         (SELECT count(*)::text FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
          WHERE c.relnamespace = 'auth'::regnamespace AND c.relname = 'users'
            AND t.tgname = 'on_auth_user_created' AND NOT t.tgisinternal AND t.tgenabled <> 'D'), '1'
  UNION ALL SELECT 'self_signup_settings satiri (enabled/gun/paket)',
         coalesce((SELECT enabled::text || ' / ' || trial_days || ' / ' || package_code FROM public.self_signup_settings WHERE id = 1), 'yok'), 'true / 7 / solo'
  UNION ALL SELECT 'RLS self_signup_settings',
         (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.self_signup_settings'::regclass), 'true'
  UNION ALL SELECT 'RLS trial_grants',
         (SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.trial_grants'::regclass), 'true'
  UNION ALL SELECT 'trial_grants legacy_backfill sayisi',
         (SELECT count(*)::text FROM public.trial_grants WHERE source = 'legacy_backfill'), '> 0'
  UNION ALL SELECT 'companies.trial_started_at / signup_source kolonlari',
         (SELECT count(*)::text FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'companies' AND column_name IN ('trial_started_at', 'signup_source')), '2'
  UNION ALL SELECT 'mevcut firmalardan signup_source dolu olan (0 olmali)',
         (SELECT count(*)::text FROM public.companies WHERE signup_source IS NOT NULL AND created_at < now() - interval '1 hour'), '0'
  UNION ALL SELECT 'yazma korumasi kurulu tablo sayisi',
         (SELECT count(*)::text FROM pg_trigger t
          WHERE t.tgname = 'trg_subscription_write_guard' AND NOT t.tgisinternal AND t.tgenabled <> 'D'), '29'
  UNION ALL SELECT 'koruma INSERT+UPDATE+DELETE+BEFORE+ROW (hatali tetikleyici)',
         (SELECT count(*)::text FROM pg_trigger t
          WHERE t.tgname = 'trg_subscription_write_guard' AND NOT t.tgisinternal
            AND NOT ((t.tgtype & 1) = 1 AND (t.tgtype & 2) = 2 AND (t.tgtype & 4) = 4 AND (t.tgtype & 8) = 8 AND (t.tgtype & 16) = 16)), '0'
  UNION ALL SELECT 'company_members tenant tetikleyicisi fonksiyonu',
         coalesce((SELECT string_agg(p.proname, ',') FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
          WHERE t.tgrelid = 'public.company_members'::regclass AND t.tgname = 'trg_company_members_tenant_write'), 'tetikleyici yok'),
         'tetikleyici yok VEYA enforce_company_members_tenant_write'
)
SELECT kontrol, sonuc, beklenen FROM checks;

-- Korunan tablolar listesi (29 satir beklenir)
SELECT c.relname AS korunan_tablo
FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
WHERE t.tgname = 'trg_subscription_write_guard' AND NOT t.tgisinternal
ORDER BY 1;

-- company_id kolonu olan ama koruma OLMAYAN tablolar (bilgi amacli; log/destek/uyelik tablolari bilerek disarida)
SELECT c.table_name AS korumasiz_company_id_tablosu
FROM information_schema.columns c
JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
WHERE c.table_schema = 'public' AND c.column_name = 'company_id'
  AND NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class k ON k.oid = t.tgrelid
    WHERE k.relname = c.table_name AND k.relnamespace = 'public'::regnamespace
      AND t.tgname = 'trg_subscription_write_guard')
ORDER BY 1;
