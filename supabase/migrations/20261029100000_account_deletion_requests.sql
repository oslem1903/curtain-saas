-- Dedicated in-app permanent account erasure requests; NOT a support ticket or deactivation.
-- Fulfilment is manual, within seven days. No automatic tenant/business deletion.
begin;
create table public.account_deletion_requests (
    id uuid primary key default gen_random_uuid(),
    receipt_secret uuid not null default gen_random_uuid(),
    user_id uuid references auth.users(id) on delete set null,
    subject_user_id uuid,
    email text,
    status text not null default 'pending' check (status in ('pending','completed')),
    requested_at timestamptz not null default now(),
    due_at timestamptz not null default (now() + interval '7 days'),
    completed_at timestamptz,
    completion_note text,
    constraint completed_request_erases_identity check (
        status <> 'completed' or (user_id is null and subject_user_id is null and email is null and completed_at is not null)
    )
);
create unique index one_pending_account_deletion on public.account_deletion_requests(user_id) where status='pending';
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from public, anon, authenticated;
grant select on public.account_deletion_requests to authenticated;
create policy deletion_request_owner_or_admin on public.account_deletion_requests
    for select to authenticated using (user_id=auth.uid() or public.is_super_admin());

create function public.request_my_account_deletion(p_confirm text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user uuid := auth.uid(); v_email text; r public.account_deletion_requests;
begin
    if v_user is null then raise exception 'AUTH_REQUIRED'; end if;
    if p_confirm is distinct from 'HESABIMI SIL' then raise exception 'CONFIRM_REQUIRED'; end if;
    select email into v_email from auth.users where id=v_user;
    if not found then raise exception 'AUTH_REQUIRED'; end if;
    -- Serialize requests by the caller, not a user id supplied by the client.
    perform pg_advisory_xact_lock(hashtextextended(v_user::text,0));
    select * into r from public.account_deletion_requests where user_id=v_user and status='pending';
    if not found then
        insert into public.account_deletion_requests(user_id,subject_user_id,email)
            values(v_user,v_user,v_email) returning * into r;
    end if;
    return jsonb_build_object('id',r.id,'receipt_secret',r.receipt_secret,'status',r.status,
        'requested_at',r.requested_at,'due_at',r.due_at,'completed_at',r.completed_at,'completion_note',r.completion_note);
end;
$$;
revoke all on function public.request_my_account_deletion(text) from public,anon;
grant execute on function public.request_my_account_deletion(text) to authenticated;

-- Receipt is a two-part unguessable capability. No identity/company data is returned.
-- Lets the person see completion after their Auth account has been removed.
create function public.get_account_deletion_receipt(p_id uuid,p_secret uuid)
returns jsonb language sql stable security definer set search_path=public,pg_temp as $$
    select jsonb_build_object('id',id,'receipt_secret',receipt_secret,'status',status,
        'requested_at',requested_at,'due_at',due_at,'completed_at',completed_at,'completion_note',completion_note)
    from public.account_deletion_requests where id=p_id and receipt_secret=p_secret;
$$;
revoke all on function public.get_account_deletion_receipt(uuid,uuid) from public;
grant execute on function public.get_account_deletion_receipt(uuid,uuid) to anon,authenticated;

-- An operator may only confirm completion AFTER real erasure, never merely close a ticket.
create function public.complete_account_deletion_request(p_id uuid,p_confirm text,p_retention_note text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare r public.account_deletion_requests; v_storage boolean; v_owner_column text;
begin
    if auth.uid() is null or not public.is_super_admin() then raise exception 'SUPER_ADMIN_ONLY'; end if;
    if p_confirm is distinct from 'KALICI SILINDI' then raise exception 'CONFIRM_REQUIRED'; end if;
    if length(trim(coalesce(p_retention_note,''))) < 3 or length(p_retention_note)>1500 then raise exception 'RETENTION_NOTE_REQUIRED'; end if;
    select * into r from public.account_deletion_requests where id=p_id for update;
    if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
    if r.status='completed' then return; end if;
    if r.subject_user_id=auth.uid() then raise exception 'ANOTHER_ADMIN_REQUIRED'; end if;
    if exists(select 1 from auth.users where id=r.subject_user_id) then raise exception 'AUTH_ACCOUNT_STILL_EXISTS'; end if;
    if exists(select 1 from public.profiles where user_id=r.subject_user_id)
       or exists(select 1 from public.company_members where user_id=r.subject_user_id) then raise exception 'ACCOUNT_LINKS_STILL_EXIST'; end if;
    -- Storage schema versions use owner or owner_id. Check each available column.
    for v_owner_column in select column_name from information_schema.columns
        where table_schema='storage' and table_name='objects' and column_name in ('owner','owner_id')
    loop
        execute format('select exists(select 1 from storage.objects where %I::text=$1)',v_owner_column)
            into v_storage using r.subject_user_id::text;
        if v_storage then raise exception 'OWNED_STORAGE_STILL_EXISTS'; end if;
    end loop;
    update public.account_deletion_requests set status='completed',completed_at=now(),
        completion_note=trim(p_retention_note),user_id=null,subject_user_id=null,email=null where id=p_id;
end;
$$;
revoke all on function public.complete_account_deletion_request(uuid,text,text) from public,anon;
grant execute on function public.complete_account_deletion_request(uuid,text,text) to authenticated;
commit;
