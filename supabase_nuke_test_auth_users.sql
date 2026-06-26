-- Nuclear cleanup for stuck test auth users.
--
-- WARNING: This permanently deletes the listed Auth users and their app links.
-- Use only for test/demo emails.
--
-- Usage:
-- 1) Edit v_emails below.
-- 2) Run the whole file in Supabase SQL Editor.
-- 3) Create a fresh invite again from Super Admin.

do $$
declare
  v_emails text[] := array[
    'test10@gmail.com'
  ];
  v_user_ids uuid[];
  r record;
begin
  select coalesce(array_agg(au.id), array[]::uuid[])
    into v_user_ids
  from auth.users au
  where lower(au.email) in (
    select lower(trim(email_value))
    from unnest(v_emails) as email_value
  );

  if array_length(v_user_ids, 1) is null then
    raise notice 'No auth users found for emails: %', v_emails;
    return;
  end if;

  -- Remove invite rows by email first so the old code cannot be reused.
  if to_regclass('public.user_invites') is not null then
    delete from public.user_invites ui
    where lower(ui.email) in (
      select lower(trim(email_value))
      from unnest(v_emails) as email_value
    )
       or ui.invited_by = any(v_user_ids);
  end if;

  -- Clean every public column that stores one of these user ids.
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
        using v_user_ids;
      else
        execute format(
          'delete from %I.%I where %I = any($1)',
          r.table_schema,
          r.table_name,
          r.column_name
        )
        using v_user_ids;
      end if;
    exception when others then
      raise notice 'Skipped public %.% column %: %', r.table_name, r.column_name, r.column_name, sqlerrm;
    end;
  end loop;

  -- Profiles sometimes also need email cleanup even if user_id was already nulled/deleted.
  if to_regclass('public.profiles') is not null then
    delete from public.profiles p
    where p.user_id = any(v_user_ids)
       or lower(p.email) in (
         select lower(trim(email_value))
         from unnest(v_emails) as email_value
       );
  end if;

  -- Delete Auth child rows dynamically. Keep auth.users for the final step.
  for r in
    select table_schema, table_name, column_name
    from information_schema.columns
    where table_schema = 'auth'
      and table_name <> 'users'
      and column_name in ('user_id', 'id')
  loop
    begin
      if r.column_name = 'user_id' then
        execute format(
          'delete from %I.%I where %I = any($1)',
          r.table_schema,
          r.table_name,
          r.column_name
        )
        using v_user_ids;
      end if;
    exception when others then
      raise notice 'Skipped auth %.% column %: %', r.table_name, r.column_name, r.column_name, sqlerrm;
    end;
  end loop;

  -- Known Auth tables that may not be covered depending on Supabase version.
  begin
    delete from auth.identities i where i.user_id = any(v_user_ids);
  exception when undefined_table then
    null;
  end;

  begin
    delete from auth.sessions s where s.user_id = any(v_user_ids);
  exception when undefined_table then
    null;
  end;

  begin
    delete from auth.mfa_factors m where m.user_id = any(v_user_ids);
  exception when undefined_table then
    null;
  end;

  begin
    delete from auth.one_time_tokens ott where ott.user_id = any(v_user_ids);
  exception when undefined_table then
    null;
  end;

  -- Final delete: bypass the dashboard delete path.
  delete from auth.users au
  where au.id = any(v_user_ids);

  raise notice 'NUKED auth users and app links for emails: %', v_emails;
end $$;
