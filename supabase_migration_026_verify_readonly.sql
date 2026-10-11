-- Migration 026 SONRASI DOGRULAMA — SALT OKUNUR. Tek hucre doner.
-- Her satirin sonundaki [beklenen: ...] ile karsilastirin.
SELECT string_agg(satir, E'\n' ORDER BY sira, satir) AS sonuc FROM (
  -- 1) Yeni RPC'ler var mi, kimler cagirabilir (anon=false, authenticated=true)
  SELECT 1 AS sira, f.sig || ' -> anon/auth = '
         || coalesce(has_function_privilege('anon', to_regprocedure(f.sig), 'EXECUTE')::text, 'YOK') || '/'
         || coalesce(has_function_privilege('authenticated', to_regprocedure(f.sig), 'EXECUTE')::text, 'YOK')
         || '  [beklenen: false/true]' AS satir
  FROM unnest(ARRAY[
    'public.super_admin_list_company_identities()',
    'public.super_admin_get_company_access(uuid)',
    'public.super_admin_set_trial_end(uuid,timestamptz,text)',
    'public.super_admin_add_trial_days(uuid,integer,text)',
    'public.super_admin_end_trial_now(uuid,text,text)',
    'public.super_admin_set_special_access(uuid,boolean,timestamptz,text)',
    'public.extend_company_trial(uuid,integer)'
  ]) AS f(sig)
  UNION ALL
  -- 2) Ic yardimcilar istemciden cagrilamamali
  SELECT 2, f.sig || ' -> anon/auth = '
         || coalesce(has_function_privilege('anon', to_regprocedure(f.sig), 'EXECUTE')::text, 'YOK') || '/'
         || coalesce(has_function_privilege('authenticated', to_regprocedure(f.sig), 'EXECUTE')::text, 'YOK')
         || '  [beklenen: false/false]'
  FROM unnest(ARRAY[
    'public.super_admin_access_snapshot(uuid)',
    'public.super_admin_require()',
    'public.super_admin_log_access_change(uuid,text,jsonb,jsonb,text)',
    'public.super_admin_apply_trial_end(uuid,timestamptz)'
  ]) AS f(sig)
  UNION ALL
  -- 3) Yeni kolonlar
  SELECT 3, 'companies.' || x.c || ' kolonu = ' ||
         CASE WHEN EXISTS (SELECT 1 FROM information_schema.columns
                           WHERE table_schema = 'public' AND table_name = 'companies' AND column_name = x.c)
              THEN 'var' ELSE 'YOK' END || '  [beklenen: var]'
  FROM unnest(ARRAY['pilot_until', 'pilot_note']) AS x(c)
  UNION ALL
  -- 4) Profil yetki koruma tetikleyicisi
  SELECT 4, 'profiles yetki koruma tetikleyicisi = ' ||
         coalesce((SELECT CASE WHEN t.tgenabled <> 'D' THEN 'aktif' ELSE 'KAPALI' END
                   FROM pg_trigger t WHERE t.tgrelid = 'public.profiles'::regclass
                     AND t.tgname = 'trg_protect_profile_privileged_fields' AND NOT t.tgisinternal), 'YOK')
         || '  [beklenen: aktif]'
  UNION ALL
  -- 5) Kendini baska firmaya ekleme politikalari kaldirildi mi
  SELECT 5, 'company_members politikasi "' || x.p || '" = ' ||
         CASE WHEN EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'company_members' AND policyname = x.p)
              THEN 'HALA VAR' ELSE 'kaldirildi' END || '  [beklenen: kaldirildi]'
  FROM unnest(ARRAY['cm_insert_own', 'Kullanıcılar kendilerini şirkete kaydedebilir']) AS x(p)
  UNION ALL
  -- 6) Fonksiyon govdeleri pilot_until'i dikkate aliyor mu
  SELECT 6, p.proname || ' pilot_until iceriyor = ' || (pg_get_functiondef(p.oid) LIKE '%pilot_until%')::text || '  [beklenen: true]'
  FROM pg_proc p
  WHERE p.pronamespace = 'public'::regnamespace
    AND p.proname IN ('is_company_writable', 'company_subscription_allows_write', 'check_subscription_active',
                      'register_device_and_touch_login', 'protect_license_fields')
  UNION ALL
  -- 7) 024/025 korumasi yerinde (026 dokunmaz)
  SELECT 7, 'abonelik yazma korumali tablo sayisi = ' || count(*) || '  [beklenen: 37]'
  FROM pg_trigger t WHERE t.tgname = 'trg_subscription_write_guard' AND NOT t.tgisinternal AND t.tgenabled <> 'D'
  UNION ALL
  -- 8) Bilgi: ozel erisim durumu (veri degistirmez)
  SELECT 8, 'bilgi: is_pilot=' || count(*) FILTER (WHERE coalesce(is_pilot, false))
         || ' (suresiz=' || count(*) FILTER (WHERE coalesce(is_pilot, false) AND pilot_until IS NULL)
         || ', suresi gecmis=' || count(*) FILTER (WHERE coalesce(is_pilot, false) AND pilot_until < now()) || ')'
         || '  [beklenen: 026 hemen sonrasi suresiz = is_pilot sayisi, suresi gecmis = 0]'
  FROM public.companies
  UNION ALL
  -- 9) super_admin rolundeki profil sayisi (beklenmeyen artis olmamali)
  SELECT 9, 'bilgi: super_admin profil sayisi = ' || count(*) || '  [kendi bildiginiz sayi ile karsilastirin]'
  FROM public.profiles WHERE role = 'super_admin'
) s;
