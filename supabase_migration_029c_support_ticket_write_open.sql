-- =============================================================================
-- Migration 029c (UYGULANDI 2026-10-13, PerdePRO ffhmzlcsgsgjonqqhgqq):
-- suresi bitmis firma da DESTEK TALEBI acabilmeli.
--
-- Bulgu (canli, QA firmasi B suresi bitmis): POST /rest/v1/support_tickets -> 400 P0001
-- "Firma lisansi aktif degil veya sadece okuma modunda." Kaynak: support_tickets uzerindeki
-- trg_support_tickets_tenant_write -> enforce_tenant_write() (supabase_customer_ready_hardening.sql),
-- is_company_writable() uzerinden lisans kontrolu yapar. Migration 024 ise "suresi dolan kullanici
-- giris yapabilmeli, destek talebi acabilmeli" der; urun karari da destegin acik kalmasidir.
--
-- Duzeltme (dar): enforce_tenant_write() govdesi AYNEN korunur; yalnizca tg_table_name='support_tickets'
-- icin lisans/yazma-modu kontrolu atlanir. company_id zorunlulugu ve firma uyeligi kontrolu
-- (support_tickets icin de) KORUNUR; diger 23 tablonun davranisi DEGISMEZ.
-- Onceki govde (md5 dc12f3630526561fd2e95fb9eee1d23c) geri alma dosyasinda.
-- =============================================================================
BEGIN;

DO $pre$
BEGIN
  IF to_regprocedure('public.enforce_tenant_write()') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: public.enforce_tenant_write() yok.';
  END IF;
  IF md5(btrim(regexp_replace((SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'public.enforce_tenant_write()'::regprocedure), '\s+', ' ', 'g')))
       <> 'dc12f3630526561fd2e95fb9eee1d23c' THEN
    RAISE EXCEPTION 'PREFLIGHT: enforce_tenant_write govdesi beklenenden farkli; islem durduruldu.';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.enforce_tenant_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  if new.company_id is null then
    raise exception 'company_id zorunludur.';
  end if;

  if not public.is_super_admin() and not public.is_company_member(new.company_id) then
    raise exception 'Bu firmaya işlem yapma yetkiniz yok.';
  end if;

  if public.is_super_admin() then
    return new;
  end if;

  -- Destek talebi: sure bitmis/salt okunur firma da talep acabilmeli (uyelik yukarida dogrulandi).
  if tg_table_name = 'support_tickets' then
    return new;
  end if;

  if not public.is_company_writable(new.company_id) then
    raise exception 'Firma lisansı aktif değil veya sadece okuma modunda.';
  end if;

  return new;
end;
$function$;

DO $post$
BEGIN
  IF position('support_tickets' IN (SELECT p.prosrc FROM pg_proc p WHERE p.oid = 'public.enforce_tenant_write()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'POSTCHECK: yeni govde kurulamadi. Islem GERI ALINDI.';
  END IF;
END
$post$;

COMMIT;
