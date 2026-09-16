-- Atomic deletion. Foreign-key restrictions deliberately remain in force.
-- Requires existing companies and is_super_admin(). No auth users or Storage objects are deleted.
begin;
create or replace function public.super_admin_delete_company(p_company_id uuid, p_confirm_name text)
returns uuid language plpgsql security definer set search_path=public
as $$
declare v_name text; v_deleted uuid;
begin
  if auth.uid() is null or not public.is_super_admin() then raise exception 'Yalnızca süper admin firma silebilir.'; end if;
  select name into v_name from public.companies where id=p_company_id for update;
  if not found then raise exception 'Firma bulunamadı.'; end if;
  if p_confirm_name is null or p_confirm_name is distinct from v_name then raise exception 'Firma adı eşleşmedi.'; end if;
  delete from public.companies where id=p_company_id returning id into v_deleted;
  return v_deleted;
exception when foreign_key_violation then
  raise exception 'Firmaya bağlı kayıtlar silmeyi engelliyor. Hiçbir kayıt silinmedi; ilişki kuralları kontrol edilmeli.';
end;
$$;
revoke all on function public.super_admin_delete_company(uuid,text) from public, anon;
grant execute on function public.super_admin_delete_company(uuid,text) to authenticated;
commit;
