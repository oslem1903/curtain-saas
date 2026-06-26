-- Strong invite accept RPC hotfix for:
--   column reference "company_id" is ambiguous
--   SQLSTATE 42702
--
-- IMPORTANT:
-- Run the whole file in Supabase SQL Editor.
-- This version DROPS and recreates the invite accept functions so old
-- RETURNS TABLE(company_id uuid, role text) output variables cannot keep
-- colliding with table columns inside PL/pgSQL.

drop function if exists public.accept_invite_code_for_current_user(text, text, text);
drop function if exists public.accept_invite_for_current_user(text, text);

create or replace function public.accept_invite_code_for_current_user(
  p_email text,
  p_code text,
  p_full_name text default null
)
returns table(accepted_company_id uuid, accepted_role text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_email text;
  v_invite public.user_invites%rowtype;
  v_company public.companies%rowtype;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  select lower(au.email)
    into v_user_email
  from auth.users as au
  where au.id = v_user_id
  limit 1;

  if nullif(v_user_email, '') is null then
    raise exception 'Kullanici e-postasi bulunamadi.';
  end if;

  if lower(trim(p_email)) <> v_user_email then
    raise exception 'Kod farkli bir e-posta adresi icin girildi.';
  end if;

  select ui.*
    into v_invite
  from public.user_invites as ui
  where lower(ui.email) = v_user_email
    and upper(replace(ui.invite_code, ' ', '')) = upper(replace(trim(p_code), ' ', ''))
  order by ui.created_at desc
  limit 1
  for update;

  if v_invite.id is null then
    raise exception 'Davet kodu bulunamadi veya gecersiz.';
  end if;

  if v_invite.used_at is not null then
    raise exception 'Bu davet kodu daha once kullanilmis.';
  end if;

  if v_invite.expires_at < now() then
    raise exception 'Davet kodunun suresi dolmus.';
  end if;

  if v_invite.role not in ('admin', 'accountant', 'installer', 'measurement') then
    raise exception 'Davet rolu gecersiz.';
  end if;

  select c.*
    into v_company
  from public.companies as c
  where c.id = v_invite.company_id
  limit 1;

  if v_company.id is null then
    raise exception 'Davet edilen firma bulunamadi.';
  end if;

  if coalesce(v_company.is_active, true) = false
     or coalesce(v_company.plan_status, 'trial') = 'suspended' then
    raise exception 'Firma aktif degil. Lutfen yonetici ile iletisime gecin.';
  end if;

  insert into public.profiles(user_id, email, full_name, role, is_active, updated_at)
  values (
    v_user_id,
    v_user_email,
    coalesce(nullif(trim(p_full_name), ''), split_part(v_user_email, '@', 1)),
    v_invite.role,
    true,
    now()
  )
  on conflict (user_id)
  do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    role = excluded.role,
    is_active = true,
    updated_at = now();

  update public.company_members as cm
  set role = v_invite.role,
      is_active = true,
      updated_by = v_invite.invited_by,
      updated_at = now()
  where cm.company_id = v_invite.company_id
    and cm.user_id = v_user_id;

  if not found then
    insert into public.company_members(company_id, user_id, role, is_active, created_by, updated_at)
    values (v_invite.company_id, v_user_id, v_invite.role, true, v_invite.invited_by, now());
  end if;

  if v_invite.role = 'admin' then
    update public.companies as c
    set owner_id = coalesce(c.owner_id, v_user_id),
        updated_by = v_invite.invited_by,
        updated_at = now()
    where c.id = v_invite.company_id
      and c.owner_id is null;
  end if;

  update public.user_invites as ui
  set used_at = now(),
      updated_at = now()
  where ui.id = v_invite.id
    and ui.used_at is null;

  return query select v_invite.company_id::uuid, v_invite.role::text;
end;
$$;

grant execute on function public.accept_invite_code_for_current_user(text, text, text) to authenticated;

create or replace function public.accept_invite_for_current_user(
  p_token text,
  p_full_name text default null
)
returns table(accepted_company_id uuid, accepted_role text)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_user_id uuid := auth.uid();
  v_user_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_invite public.user_invites%rowtype;
  v_company public.companies%rowtype;
begin
  if v_user_id is null then
    raise exception 'Oturum bulunamadi.';
  end if;

  if nullif(v_user_email, '') is null then
    select lower(au.email)
      into v_user_email
    from auth.users as au
    where au.id = v_user_id
    limit 1;
  end if;

  if nullif(v_user_email, '') is null then
    raise exception 'Kullanici e-postasi bulunamadi.';
  end if;

  select ui.*
    into v_invite
  from public.user_invites as ui
  where ui.token = p_token
  limit 1
  for update;

  if v_invite.id is null then
    raise exception 'Davet bulunamadi veya gecersiz.';
  end if;

  if lower(v_invite.email) <> v_user_email then
    raise exception 'Bu davet farkli bir e-posta adresi icin olusturulmus.';
  end if;

  if v_invite.expires_at < now() then
    raise exception 'Davet suresi dolmus.';
  end if;

  if v_invite.role not in ('admin', 'accountant', 'installer', 'measurement') then
    raise exception 'Davet rolu gecersiz.';
  end if;

  select c.*
    into v_company
  from public.companies as c
  where c.id = v_invite.company_id
  limit 1;

  if v_company.id is null then
    raise exception 'Davet edilen firma bulunamadi.';
  end if;

  if coalesce(v_company.is_active, true) = false
     or coalesce(v_company.plan_status, 'trial') = 'suspended' then
    raise exception 'Firma aktif degil. Lutfen yonetici ile iletisime gecin.';
  end if;

  if v_invite.used_at is not null then
    if exists (
      select 1
      from public.company_members as cm
      where cm.company_id = v_invite.company_id
        and cm.user_id = v_user_id
    ) then
      return query select v_invite.company_id::uuid, v_invite.role::text;
      return;
    end if;

    raise exception 'Bu davet daha once kullanilmis.';
  end if;

  insert into public.profiles(user_id, email, full_name, role, is_active, updated_at)
  values (
    v_user_id,
    v_user_email,
    coalesce(nullif(trim(p_full_name), ''), split_part(v_user_email, '@', 1)),
    v_invite.role,
    true,
    now()
  )
  on conflict (user_id)
  do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    role = excluded.role,
    is_active = true,
    updated_at = now();

  update public.company_members as cm
  set role = v_invite.role,
      is_active = true,
      updated_by = v_invite.invited_by,
      updated_at = now()
  where cm.company_id = v_invite.company_id
    and cm.user_id = v_user_id;

  if not found then
    insert into public.company_members(company_id, user_id, role, is_active, created_by, updated_at)
    values (v_invite.company_id, v_user_id, v_invite.role, true, v_invite.invited_by, now());
  end if;

  if v_invite.role = 'admin' then
    update public.companies as c
    set owner_id = coalesce(c.owner_id, v_user_id),
        updated_by = v_invite.invited_by,
        updated_at = now()
    where c.id = v_invite.company_id
      and c.owner_id is null;
  end if;

  update public.user_invites as ui
  set used_at = now(),
      updated_at = now()
  where ui.id = v_invite.id
    and ui.used_at is null;

  return query select v_invite.company_id::uuid, v_invite.role::text;
end;
$$;

grant execute on function public.accept_invite_for_current_user(text, text) to authenticated;
