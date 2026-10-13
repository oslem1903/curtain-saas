-- Migration 029c geri alma: enforce_tenant_write() onceki govdeye (md5 dc12f3630526561fd2e95fb9eee1d23c) doner.
BEGIN;
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

  if not public.is_company_writable(new.company_id) then
    raise exception 'Firma lisansı aktif değil veya sadece okuma modunda.';
  end if;

  return new;
end;
$function$;
COMMIT;
