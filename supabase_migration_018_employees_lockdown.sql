-- ============================================================
-- Migration 018: employees tablosunun anonim / çapraz-firma okunmasını kapat
-- KRİTİK GÜVENLİK. PRODUCTION'da (perdepro / ffhmzlcsgsgjonqqhgqq) elle çalıştırın.
--
-- Bulgu: supabase_fix_rls_invite.sql içindeki
--   "Kayıtsız kullanıcılar davet kodu sorgulayabilir" (SELECT TO anon, authenticated
--   USING (invite_code IS NOT NULL)) politikası, oturumsuz (anon) kişinin -- ve başka
--   firmanın kullanıcısının -- invite_code / telefon / e-posta gibi alanları okumasına
--   izin veriyordu (canlıda doğrulandı: anon REST sorgusu invite_code döndürdü).
--
-- Davet akışı bu politikaya BAĞIMLI DEĞİL: istemci get_invite_by_token /
-- get_invite_by_email_code / accept_invite_code_for_current_user RPC'lerini kullanır
-- (SECURITY DEFINER). employees'e doğrudan anon sorgusu yapan istemci kodu yok.
--
-- Etki: yalnızca gereksiz açık kapanır; şirket içi okuma/yazma (company_id izolasyonu)
-- ve super admin erişimi DEĞİŞMEZ. Veri silinmez/değiştirilmez. Tekrar çalıştırılabilir.
-- ============================================================

-- 1) Anon'a açık ya da invite_code'a göre herkese açan TÜM select/all politikalarını kaldır.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'employees'
      AND (
        'anon' = ANY (roles)
        OR (cmd IN ('SELECT', 'ALL') AND coalesce(qual, '') ~* 'invite_code\s+IS\s+NOT\s+NULL')
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.employees', r.policyname);
    RAISE NOTICE 'employees politikası kaldırıldı: %', r.policyname;
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Kayıtsız kullanıcılar davet kodu sorgulayabilir" ON public.employees;

-- 2) Anon rolünün tablo yetkisini tamamen al (RLS'e ek ikinci savunma hattı).
REVOKE ALL ON public.employees FROM anon;

-- 3) Firma izolasyonlu erişimin mevcut olduğundan emin ol (yoksa oluştur; varsa dokunma).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'employees' AND cmd IN ('SELECT', 'ALL')
      AND (coalesce(qual, '') ILIKE '%is_super_admin%' OR coalesce(qual, '') ILIKE '%company_members%' OR coalesce(qual, '') ILIKE '%is_company_member%')
  ) THEN
    EXECUTE $p$CREATE POLICY employees_tenant_select ON public.employees
      FOR SELECT TO authenticated
      USING (public.is_super_admin() OR company_id IN (SELECT company_id FROM public.company_members WHERE user_id = auth.uid()))$p$;
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.employees TO authenticated;

-- 4) DOĞRULAMA (salt okunur) -- sonuçta anon'a açık politika OLMAMALI:
-- SELECT policyname, cmd, roles, qual FROM pg_policies WHERE tablename = 'employees';
-- SELECT has_table_privilege('anon', 'public.employees', 'SELECT');  -- false olmalı
--
-- GERİ ALMA (gerekirse, önerilmez): supabase_fix_rls_invite.sql içindeki 2. politikayı yeniden oluşturun.
