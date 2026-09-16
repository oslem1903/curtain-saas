-- Requires existing error_logs, company_members and is_super_admin().
-- One bounded diagnostic per user per five seconds; identity comes from auth.
begin;
create or replace function public.report_client_error(
  p_message text, p_stack text default '', p_path text default '/', p_version text default ''
) returns void language plpgsql security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_company uuid;
  v_count integer;
begin
  if v_user is null then raise exception 'Oturum gerekli'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_user::text, 91));
  select count(*) into v_count from public.company_members
    where user_id = v_user and coalesce(is_active, true);
  if v_count = 1 then
    select company_id into v_company from public.company_members
      where user_id = v_user and coalesce(is_active, true);
  elsif not public.is_super_admin() then
    raise exception 'Firma bağlantısı tekil değil';
  end if;
  if exists (select 1 from public.error_logs where user_id = v_user
    and created_at > now() - interval '5 seconds') then return; end if;
  insert into public.error_logs(company_id, user_id, message, error_message, stack, path, app_version)
  values (v_company, v_user, left(p_message,2000), left(p_message,2000), left(p_stack,2000), left(p_path,250), left(p_version,40));
end;
$$;
revoke all on function public.report_client_error(text,text,text,text) from public, anon;
grant execute on function public.report_client_error(text,text,text,text) to authenticated;
commit;
