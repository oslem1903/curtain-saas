create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text := lower(coalesce(new.email, ''));
  v_full_name text := coalesce(new.raw_user_meta_data->>'full_name', split_part(v_email, '@', 1), '');
  v_role text := lower(coalesce(new.raw_user_meta_data->>'role', 'installer'));
begin
  if v_role not in ('super_admin', 'admin', 'accountant', 'installer', 'measurement', 'personnel') then
    v_role := 'installer';
  end if;

  insert into public.profiles(user_id, email, full_name, role, is_active, updated_at)
  values (new.id, v_email, nullif(v_full_name, ''), v_role, true, now())
  on conflict (user_id)
  do update set
    email = coalesce(excluded.email, public.profiles.email),
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    is_active = coalesce(public.profiles.is_active, true),
    updated_at = now();

  return new;
exception when others then
  raise warning 'handle_new_user skipped for %: %', new.id, sqlerrm;
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
