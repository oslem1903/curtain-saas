-- ============================================================
-- PERDEPRO - "Database error finding user" (signup 500) FIX
-- Tek seferde çalıştırılabilir, idempotent.
-- Mevcut kullanıcıları ve firma verilerini SİLMEZ; yalnızca
-- auth şemasındaki öksüz/bozuk artıkları temizler ve
-- signup trigger/hook zincirini güvenli hale getirir.
-- ============================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------
-- 0) TANI: sorunun kaynağını göster (sadece SELECT)
-- ------------------------------------------------------------

-- Aynı e-postaya birden fazla auth.users kaydı var mı?
select 'TANI: duplicate auth.users email' as section, lower(email) as email, count(*) as adet
from auth.users
group by lower(email)
having count(*) > 1;

-- Silinmiş kullanıcıya işaret eden öksüz identity var mı? (signup 500'ün 1 numaralı sebebi)
select 'TANI: orphan auth.identities' as section, i.id, i.provider, i.user_id
from auth.identities i
left join auth.users u on u.id = i.user_id
where u.id is null;

-- Aynı kullanıcı+provider için yinelenen identity var mı?
select 'TANI: duplicate identities' as section, user_id, provider, count(*) as adet
from auth.identities
group by user_id, provider
having count(*) > 1;

-- auth.users üzerinde kalan custom trigger var mı?
select 'TANI: auth.users triggers' as section, t.tgname,
       n.nspname || '.' || p.proname as fn
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
join pg_namespace n on n.oid = p.pronamespace
where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal;

-- ------------------------------------------------------------
-- 1) ÖKSÜZ AUTH ARTIKLARINI TEMİZLE
--    (yalnızca var olmayan kullanıcılara işaret eden satırlar silinir;
--     gerçek kullanıcı verisi etkilenmez)
-- ------------------------------------------------------------

do $$
begin
  delete from auth.identities i
  where not exists (select 1 from auth.users u where u.id = i.user_id);

  delete from auth.sessions s
  where not exists (select 1 from auth.users u where u.id = s.user_id);

  delete from auth.refresh_tokens r
  where r.user_id is not null
    and not exists (select 1 from auth.users u where u.id::text = r.user_id);

  if to_regclass('auth.mfa_factors') is not null then
    delete from auth.mfa_factors f
    where not exists (select 1 from auth.users u where u.id = f.user_id);
  end if;

  if to_regclass('auth.one_time_tokens') is not null then
    delete from auth.one_time_tokens o
    where not exists (select 1 from auth.users u where u.id = o.user_id);
  end if;
end $$;

-- Aynı kullanıcı+provider için yinelenen identity'lerden eskisini bırak, fazlasını sil
delete from auth.identities i
using auth.identities j
where i.user_id = j.user_id
  and i.provider = j.provider
  and i.id > j.id;

-- E-postası boş kalmış identity_data onarımı (GoTrue email araması bunu da devirebilir)
update auth.identities i
set identity_data = jsonb_set(coalesce(i.identity_data, '{}'::jsonb), '{email}', to_jsonb(lower(u.email)))
from auth.users u
where u.id = i.user_id
  and i.provider = 'email'
  and coalesce(i.identity_data->>'email', '') = ''
  and u.email is not null;

-- ------------------------------------------------------------
-- 2) auth.users ÜZERİNDEKİ TÜM CUSTOM TRIGGERLARI KALDIR
--    (signup'ı bloke eden eski/bozuk triggerlar)
-- ------------------------------------------------------------

do $$
declare r record;
begin
  for r in
    select tgname from pg_trigger
    where tgrelid = 'auth.users'::regclass and not tgisinternal
  loop
    execute format('drop trigger if exists %I on auth.users', r.tgname);
  end loop;
end $$;

-- ------------------------------------------------------------
-- 3) GÜVENLİ handle_new_user TRIGGER'I (asla exception fırlatmaz)
--    profiles kaydı otomatik açılır; hata olursa loglanır, signup bozulmaz
-- ------------------------------------------------------------

create table if not exists public.auth_repair_log (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  user_id uuid,
  email text,
  message text,
  sqlstate text,
  detail text,
  hint text,
  created_at timestamptz not null default now()
);

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

  begin
    insert into public.profiles(user_id, email, full_name, role, is_active, updated_at)
    values (new.id, v_email, nullif(v_full_name, ''), v_role, true, now())
    on conflict (user_id) do update set
      email = coalesce(excluded.email, public.profiles.email),
      full_name = coalesce(excluded.full_name, public.profiles.full_name),
      updated_at = now();
  exception when others then
    begin
      insert into public.auth_repair_log(source, user_id, email, message, sqlstate)
      values ('handle_new_user', new.id, v_email, sqlerrm, sqlstate);
    exception when others then null;
    end;
  end;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 4) AUTH HOOK GÜVENLİĞİ
--    Bozuk bir custom_access_token_hook tüm girişleri 500'e düşürür.
--    Bu sürüm event'i olduğu gibi döndürür, asla bloke etmez.
-- ------------------------------------------------------------

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $$
begin
  return coalesce(event, '{}'::jsonb);
exception when others then
  return coalesce(event, '{}'::jsonb);
end;
$$;

-- ------------------------------------------------------------
-- 5) supabase_auth_admin İZİNLERİ
--    GoTrue'nun public şemadaki trigger fonksiyonlarını çalıştırabilmesi için
-- ------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.handle_new_user() to supabase_auth_admin;
    revoke all on function public.custom_access_token_hook(jsonb) from public, anon, authenticated;
    grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
    -- handle_new_user'ın yazdığı tablolara definer sahibi erişir; ekstra grant gerekmez
  end if;
end $$;

-- ------------------------------------------------------------
-- 6) profiles / company_members / user_invites RLS GÜVENLİ TABANI
--    (RPC'ler SECURITY DEFINER olduğundan RLS'i atlar; bu policyler
--     yalnızca istemciden doğrudan okuma için gereken asgari erişimi verir.
--     Mevcut aynı isimli policyler yeniden oluşturulur, diğerleri korunur.)
-- ------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.company_members enable row level security;
alter table public.user_invites enable row level security;

drop policy if exists "profiles_select_self_or_super" on public.profiles;
create policy "profiles_select_self_or_super" on public.profiles
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.profiles p2 where p2.user_id = auth.uid() and p2.role = 'super_admin')
    or exists (
      select 1 from public.company_members me
      join public.company_members them on them.company_id = me.company_id
      where me.user_id = auth.uid() and them.user_id = public.profiles.user_id
    )
  );

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self" on public.profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "company_members_select_same_company" on public.company_members;
create policy "company_members_select_same_company" on public.company_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or company_id in (select company_id from public.company_members where user_id = auth.uid())
    or exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'super_admin')
  );

-- user_invites: istemci doğrudan okumaz (token/kod doğrulaması RPC ile yapılır);
-- super admin paneli için okuma izni
drop policy if exists "user_invites_select_super_or_admin" on public.user_invites;
create policy "user_invites_select_super_or_admin" on public.user_invites
  for select to authenticated
  using (
    exists (select 1 from public.profiles p where p.user_id = auth.uid() and p.role = 'super_admin')
    or company_id in (
      select company_id from public.company_members
      where user_id = auth.uid() and role = 'admin' and coalesce(is_active, true)
    )
  );

-- ------------------------------------------------------------
-- 7) SON KONTROL
-- ------------------------------------------------------------

notify pgrst, 'reload schema';

select 'SONUC: orphan identities kaldi mi' as check_name,
       (select count(*) from auth.identities i left join auth.users u on u.id = i.user_id where u.id is null) = 0 as ok;

select 'SONUC: auth.users trigger' as check_name, t.tgname,
       n.nspname || '.' || p.proname as fn
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
join pg_namespace n on n.oid = p.pronamespace
where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal;

select 'SONUC: son hata loglari' as section, source, email, message, sqlstate, created_at
from public.auth_repair_log
order by created_at desc
limit 10;
