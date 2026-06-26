-- Cleanup selected auth users before deleting them from Supabase Auth UI.
--
-- Usage:
-- 1) Replace the emails in v_emails below.
-- 2) Run the whole file in Supabase SQL Editor.
-- 3) Then go to Authentication > Users and delete those users again.
--
-- This clears public app references that commonly block auth user deletion.

create or replace function public.cleanup_user_refs_if_possible(p_user_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select table_schema, table_name, column_name, is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and column_name in (
        'user_id',
        'owner_id',
        'created_by',
        'updated_by',
        'assigned_to',
        'assigned_to_user_id',
        'employee_user_id',
        'invited_by'
      )
  loop
    begin
      if r.is_nullable = 'YES' then
        execute format(
          'update %I.%I set %I = null where %I = any($1)',
          r.table_schema,
          r.table_name,
          r.column_name,
          r.column_name
        )
        using p_user_ids;
      else
        execute format(
          'delete from %I.%I where %I = any($1)',
          r.table_schema,
          r.table_name,
          r.column_name
        )
        using p_user_ids;
      end if;
    exception when others then
      raise notice 'Skipped %.% column %: %', r.table_schema, r.table_name, r.column_name, sqlerrm;
    end;
  end loop;
end;
$$;

do $$
declare
  v_emails text[] := array[
    'test10@gmail.com'
  ];
  v_user_ids uuid[];
begin
  select coalesce(array_agg(au.id), array[]::uuid[])
    into v_user_ids
  from auth.users au
  where lower(au.email) = any (
    select lower(trim(email_value))
    from unnest(v_emails) as email_value
  );

  if array_length(v_user_ids, 1) is null then
    raise notice 'No auth users found for emails: %', v_emails;
    return;
  end if;

  perform public.cleanup_user_refs_if_possible(v_user_ids);

  delete from public.profiles p
  where p.user_id = any(v_user_ids)
     or lower(p.email) = any (
       select lower(trim(email_value))
       from unnest(v_emails) as email_value
     );

  delete from public.user_invites ui
  where lower(ui.email) = any (
    select lower(trim(email_value))
    from unnest(v_emails) as email_value
  );

  raise notice 'Cleaned public references for % users: %', array_length(v_user_ids, 1), v_emails;
end $$;
