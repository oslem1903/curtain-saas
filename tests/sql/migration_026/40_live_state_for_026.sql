-- Canlidan (2026-10-03, salt okunur) alinan tanimlarin yerel kopyasi
alter table public.companies add column if not exists payment_reference text;
alter table public.companies add column if not exists billing_note text;
alter table public.companies drop constraint if exists companies_subscription_plan_chk;
alter table public.companies add constraint companies_subscription_plan_chk check (subscription_plan is null or lower(subscription_plan) in ('starter','trial','free','solo','solo_perdeci','pro','professional','yonetici','enterprise','ekip','kurumsal','lifetime'));

-- audit_logs (canli kolonlar + 017 senkron tetikleyici + politikalar)
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(), company_id uuid, actor_user_id uuid, action text not null,
  entity_table text, entity_id uuid, metadata jsonb, created_at timestamptz not null default now(),
  user_id uuid, entity_type text, details jsonb, ip_address text);
create or replace function public.audit_logs_sync_columns() returns trigger language plpgsql set search_path = public as $$
begin
  new.actor_user_id := coalesce(new.actor_user_id, new.user_id, auth.uid());
  new.user_id := coalesce(new.user_id, new.actor_user_id);
  new.entity_table := coalesce(new.entity_table, new.entity_type);
  new.entity_type := coalesce(new.entity_type, new.entity_table);
  new.metadata := coalesce(new.metadata, new.details);
  new.details := coalesce(new.details, new.metadata);
  return new; end $$;
create trigger trg_audit_logs_sync_columns before insert on public.audit_logs for each row execute function public.audit_logs_sync_columns();
alter table public.audit_logs enable row level security;
create policy audit_logs_select_scope on public.audit_logs for select to authenticated using (public.is_super_admin() or company_id in (select cm.company_id from public.company_members cm where cm.user_id = auth.uid()));
create policy audit_logs_insert_scope on public.audit_logs for insert to authenticated with check (public.is_super_admin() or (company_id in (select cm.company_id from public.company_members cm where cm.user_id = auth.uid()) and coalesce(actor_user_id, user_id, auth.uid()) = auth.uid()));

-- canli is_super_admin (plpgsql surumu)
create or replace function public.is_super_admin() returns boolean language plpgsql security definer set search_path to 'public' as $$
begin return (select role = 'super_admin' from public.profiles where user_id = auth.uid() limit 1); end $$;

-- canli protect_license_fields (026 oncesi)
create or replace function public.protect_license_fields() returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
    if exists (select 1 from profiles where user_id = auth.uid() and role = 'super_admin') then return new; end if;
    if auth.uid() is null then return new; end if;
    if new.plan_status is distinct from old.plan_status or new.subscription_plan is distinct from old.subscription_plan
    or new.package_code is distinct from old.package_code or new.enabled_modules is distinct from old.enabled_modules
    or new.trial_end is distinct from old.trial_end or new.trial_ends_at is distinct from old.trial_ends_at
    or new.is_active is distinct from old.is_active or new.read_only is distinct from old.read_only
    or new.max_users is distinct from old.max_users or new.max_devices is distinct from old.max_devices
    or new.is_pilot is distinct from old.is_pilot then
        raise exception 'Lisans alanlarını yalnızca super admin değiştirebilir.';
    end if;
    return new; end $$;
create trigger trg_protect_license_fields before update on public.companies for each row execute function public.protect_license_fields();

-- canli check_subscription_active (026 oncesi)
create or replace function public.check_subscription_active(company_uuid uuid) returns boolean language plpgsql security definer set search_path to 'public' as $$
declare v_plan_status text; v_is_pilot boolean; v_trial_ends_at timestamptz;
begin
  if company_uuid is null then return true; end if;
  select plan_status, is_pilot, trial_ends_at into v_plan_status, v_is_pilot, v_trial_ends_at from public.companies where id = company_uuid;
  if not found then return true; end if;
  if coalesce(v_is_pilot, false) = true then return true; end if;
  if coalesce(v_plan_status, 'trial') in ('active', 'lifetime') then return true; end if;
  if coalesce(v_plan_status, 'trial') in ('expired', 'suspended') then return false; end if;
  return v_trial_ends_at is not null and v_trial_ends_at >= now(); end $$;

-- canli extend_company_trial (026 oncesi)
create or replace function public.extend_company_trial(p_company_id uuid, p_extra_days integer default 7)
returns table(extended_company_id uuid, new_trial_ends_at timestamptz) language plpgsql security definer set search_path to 'public','auth' as $$
declare v_actor_role text; v_extra_days integer; v_current_ends_at timestamptz; v_new_ends_at timestamptz;
begin
  select p.role into v_actor_role from public.profiles p where p.user_id = auth.uid();
  if coalesce(v_actor_role, '') <> 'super_admin' then raise exception 'Bu islemi sadece super yonetici yapabilir.'; end if;
  if p_company_id is null then raise exception 'Sirket secilemedi.'; end if;
  v_extra_days := greatest(1, least(coalesce(p_extra_days, 7), 365));
  select c.trial_ends_at into v_current_ends_at from public.companies c where c.id = p_company_id;
  if not found then raise exception 'Sirket bulunamadi.'; end if;
  v_new_ends_at := greatest(coalesce(v_current_ends_at, now()), now()) + make_interval(days => v_extra_days);
  update public.companies c set subscription_plan = 'trial', trial_ends_at = v_new_ends_at where c.id = p_company_id;
  return query select p_company_id, v_new_ends_at; end $$;
grant execute on function public.extend_company_trial(uuid,integer) to anon, authenticated;

-- register_device bagimliliklari + canli 023 govdesi
create table if not exists public.company_devices (id uuid primary key default gen_random_uuid(), company_id uuid, user_id uuid, device_id text, user_agent text, device_name text, browser_name text, os_name text, ip_address inet, is_active boolean default true, last_seen_at timestamptz, deactivated_at timestamptz, deactivated_by uuid, unique (company_id, device_id));
create or replace function public.parse_browser_name(t text) returns text language sql immutable as $$ select 'b' $$;
create or replace function public.parse_os_name(t text) returns text language sql immutable as $$ select 'o' $$;
create or replace function public.default_device_limit_for_package(p text) returns integer language sql immutable as $$ select 3 $$;
alter table public.companies add column if not exists last_login_at timestamptz;

-- canli companies politikalari (update: super admin VEYA firma admini)
drop policy if exists companies_member_select on public.companies;
create policy companies_member_select on public.companies for select using (id in (select company_members.company_id from company_members where company_members.user_id = auth.uid()));
create policy companies_super_admin_select on public.companies for select using (is_super_admin());
create policy companies_update_super_admin_only on public.companies for update
  using ((exists (select 1 from profiles where profiles.user_id = auth.uid() and profiles.role = 'super_admin')) or (id in (select company_members.company_id from company_members where company_members.user_id = auth.uid() and company_members.role = 'admin')))
  with check ((exists (select 1 from profiles where profiles.user_id = auth.uid() and profiles.role = 'super_admin')) or (id in (select company_members.company_id from company_members where company_members.user_id = auth.uid() and company_members.role = 'admin')));

-- canli ACIKLAR: profiles self update, company_members self insert
drop policy if exists profiles_self on public.profiles;
create policy profiles_self_select on public.profiles for select using (user_id = auth.uid());
create policy profiles_super_admin_select on public.profiles for select using (is_super_admin());
create policy profiles_company_select on public.profiles for select using (user_id in (select m2.user_id from company_members m2 where m2.company_id in (select m1.company_id from company_members m1 where m1.user_id = auth.uid())));
create policy profiles_self_update on public.profiles for update using (user_id = auth.uid());
create policy profiles_admin_update on public.profiles for update using ((user_id in (select company_members.user_id from company_members where company_members.company_id in (select company_members_1.company_id from company_members company_members_1 where company_members_1.user_id = auth.uid() and company_members_1.role = any (array['admin','owner'])))) or is_super_admin());
drop policy if exists cm_self_select on public.company_members;
create policy cm_select_own on public.company_members for select using (user_id = auth.uid());
create policy cm_insert_own on public.company_members for insert with check (user_id = auth.uid());
create policy "Kullanıcılar kendilerini şirkete kaydedebilir" on public.company_members for insert with check (user_id = auth.uid());
grant all on all tables in schema public to authenticated, anon;
