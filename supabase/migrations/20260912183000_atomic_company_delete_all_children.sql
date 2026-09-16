-- Deletes all direct company_id rows before the company row, retrying FK-dependent tables.
-- Only a confirmed super-admin can execute it; each call is one transaction.
begin;
create or replace function public.super_admin_delete_company(p_company_id uuid, p_confirm_name text)
returns uuid language plpgsql security definer set search_path=public
as $$
declare
  v_name text;
  v_deleted uuid;
  v_progress integer := 1;
  v_round integer := 0;
  r record;
begin
  if auth.uid() is null or not public.is_super_admin() then raise exception 'Yalnızca süper admin firma silebilir.'; end if;
  select name into v_name from public.companies where id=p_company_id for update;
  if not found then raise exception 'Firma bulunamadı.'; end if;
  if p_confirm_name is null or p_confirm_name is distinct from v_name then raise exception 'Firma adı eşleşmedi.'; end if;

  -- Repeat because child tables can reference one another.
  while v_progress > 0 and v_round < 20 loop
    v_round := v_round + 1;
    v_progress := 0;
    for r in
      select c.table_schema, c.table_name
      from information_schema.columns c
      join pg_class cls on cls.relname=c.table_name
      join pg_namespace ns on ns.oid=cls.relnamespace and ns.nspname=c.table_schema
      where c.table_schema='public' and c.column_name='company_id'
        and c.table_name <> 'companies' and cls.relkind='r'
        and c.table_name not in ('schema_migrations')
    loop
      begin
        execute format('delete from %I.%I where company_id=$1',r.table_schema,r.table_name) using p_company_id;
        if found then v_progress := v_progress + 1; end if;
      exception when foreign_key_violation then
        -- Referenced child will be deleted in a later round.
        null;
      end;
    end loop;
  end loop;

  delete from public.companies where id=p_company_id returning id into v_deleted;
  if v_deleted is null then raise exception 'Firma silinemedi.'; end if;
  return v_deleted;
exception when foreign_key_violation then
  raise exception 'Firmaya bağlı kayıtlar otomatik temizlenemedi. Hiçbir kayıt silinmedi.';
end;
$$;
revoke all on function public.super_admin_delete_company(uuid,text) from public, anon;
grant execute on function public.super_admin_delete_company(uuid,text) to authenticated;
commit;
