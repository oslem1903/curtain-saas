-- =============================================================================
-- Migration 029d: destek ekini talebe BAGLAMA icin dar kapsamli RPC
--   attach_support_ticket_screenshot(p_ticket_id uuid, p_path text)
--
-- Sorun: SupportModal ekran goruntusunu Storage'a yukler, sonra support_tickets.screenshot_url alanini
-- UPDATE ile doldurmaya calisir. Kullanicinin support_tickets uzerinde UPDATE politikasi yoktur
-- (yalniz super admin guncelleyebilir); istek 0 satirla sessizce biter, ek talebe hic baglanmaz.
--
-- Cozum: genel UPDATE yetkisi ACILMAZ. Bu RPC yalnizca screenshot_url alanini doldurur ve sunlari sart kosar:
--   * oturum var;
--   * cagiran, talebin firmasinin AKTIF uyesidir ve (talebi acan kisidir VEYA firma admin/owner'idir);
--   * yol, bu talebin kendi klasorudur: "<company_id>/<ticket_id>/screenshot.(png|jpg|jpeg|webp)";
--   * nesne support-attachments bucket'inda gercekten vardir.
-- Talep yok / baska firma / yetkisiz durumlari AYNI hatayi (42501) verir (varlik sizmaz).
-- Abonelik/lisans kontrolu YOKTUR: suresi bitmis firma da destek talebine ek baglayabilir (029c ile tutarli).
-- ETKI: yeni fonksiyon; mevcut tablo/politika/fonksiyon degismez. GERI ALMA: DROP FUNCTION (asagida).
-- =============================================================================
BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.support_tickets') IS NULL OR to_regclass('public.company_members') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: support_tickets/company_members yok.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema='public' AND table_name='support_tickets' AND column_name='screenshot_url') THEN
    RAISE EXCEPTION 'PREFLIGHT: support_tickets.screenshot_url kolonu yok.';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.attach_support_ticket_screenshot(p_ticket_id uuid, p_path text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_ticket public.support_tickets%ROWTYPE;
  v_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: Oturum gerekli.' USING ERRCODE = '42501';
  END IF;
  IF p_ticket_id IS NULL OR p_path IS NULL OR length(p_path) > 300 THEN
    RAISE EXCEPTION 'PERDEPRO_INVALID: Geçersiz istek.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_ticket FROM public.support_tickets WHERE id = p_ticket_id;
  IF NOT FOUND OR v_ticket.company_id IS NULL THEN
    RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: Bu talebe erişiminiz yok.' USING ERRCODE = '42501';
  END IF;

  SELECT m.role INTO v_role
  FROM public.company_members m
  WHERE m.user_id = v_uid AND m.company_id = v_ticket.company_id AND coalesce(m.is_active, true)
  LIMIT 1;

  IF v_role IS NULL
     OR NOT (v_ticket.user_id IS NOT DISTINCT FROM v_uid OR lower(v_role) IN ('admin', 'owner')) THEN
    RAISE EXCEPTION 'PERDEPRO_FORBIDDEN: Bu talebe erişiminiz yok.' USING ERRCODE = '42501';
  END IF;

  IF lower(p_path) !~ ('^' || lower(v_ticket.company_id::text) || '/' || lower(v_ticket.id::text) || '/screenshot\.(png|jpe?g|webp)$') THEN
    RAISE EXCEPTION 'PERDEPRO_INVALID: Ek yolu bu talebe ait değil.' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'support-attachments' AND o.name = p_path) THEN
    RAISE EXCEPTION 'PERDEPRO_INVALID: Ek dosyası bulunamadı.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.support_tickets SET screenshot_url = p_path WHERE id = v_ticket.id;

  RETURN jsonb_build_object('ok', true, 'ticket_id', v_ticket.id, 'screenshot_url', p_path);
END
$fn$;

REVOKE ALL ON FUNCTION public.attach_support_ticket_screenshot(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attach_support_ticket_screenshot(uuid, text) TO authenticated;

DO $post$
BEGIN
  IF to_regprocedure('public.attach_support_ticket_screenshot(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'POSTCHECK: fonksiyon kurulamadi. Islem GERI ALINDI.';
  END IF;
  IF has_function_privilege('anon', 'public.attach_support_ticket_screenshot(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'POSTCHECK: anon EXECUTE yetkisi var. Islem GERI ALINDI.';
  END IF;
END
$post$;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- GERI ALMA (supabase_migration_029d_rollback.sql ile ayni):
--   DROP FUNCTION IF EXISTS public.attach_support_ticket_screenshot(uuid, text);
