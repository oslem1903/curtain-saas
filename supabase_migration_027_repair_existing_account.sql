-- ONCELIK: migration 027 sonrasi mevcut hesapla giris yapin, Davet Kodu Gir ile katilin.
-- Bu alternatif yalnizca SQL Editor'da yetkili yonetici icindir.
-- Once 027_precheck_readonly ile kesin Auth kullanicisi ve davet ID'sini inceleyin.
-- Hesap/profil silmez, e-postayi onaylamaz, daveti yeniden acmaz, RLS degistirmez.
-- Kullanilmis ama uyeligi kayip daveti zorla onarmaz: yonetici yeni davet vermelidir.
BEGIN;
DO $$
DECLARE
  v_user_id uuid := NULL;   -- on incelemedeki auth.users.id
  v_invite_id uuid := NULL; -- ayni e-postaya/firma/role ait user_invites.id
  v_result record;
BEGIN
  IF v_user_id IS NULL OR v_invite_id IS NULL THEN
    RAISE EXCEPTION 'Once salt okunur incelemeyi yapip kesin kullanici ve davet IDlerini girin.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id=v_user_id AND email_confirmed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Mevcut hesabin e-postasi dogrulanmis olmali.';
  END IF;
  PERFORM set_config('request.jwt.claim.sub',v_user_id::text,true);
  -- Ayni guvenli yol: email, sure, rol, firma, kota ve idempotency tekrar denetlenir.
  SELECT * INTO STRICT v_result FROM public.accept_verified_invite(v_invite_id,NULL);
  RAISE NOTICE 'Tamamlandi: Auth ID %, firma %, rol %',v_user_id,v_result.accepted_company_id,v_result.accepted_role;
END $$;
COMMIT;
