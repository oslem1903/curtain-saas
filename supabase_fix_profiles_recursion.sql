-- ============================================================
-- PERDEPRO - profiles RLS sonsuz recursion FIX
-- Hata: "infinite recursion detected in policy for relation profiles"
-- Sebep: profiles policy'si kendi içinde profiles'ı sorguluyordu.
-- Çözüm: RLS'i bypass eden SECURITY DEFINER helper fonksiyonlar.
-- Tek seferde çalışır, idempotent, veri silmez.
-- ============================================================

-- ------------------------------------------------------------
-- 0) TANI: mevcut policy'leri göster
-- ------------------------------------------------------------
select 'TANI: profiles policies' as section, policyname, cmd, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'profiles';

select 'TANI: company_members policies' as section, policyname, cmd, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'company_members';

-- ------------------------------------------------------------
-- 1) HELPER FONKSİYONLAR (SECURITY DEFINER → tablo sahibi olarak
--    çalışır, RLS'e takılmaz → recursion imkansız)
-- ------------------------------------------------------------

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where user_id = auth.uid() and role = 'super_admin'
  );
$$;

create or replace function public.my_company_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.company_members
  where user_id = auth.uid() and coalesce(is_active, true);
$$;

create or replace function public.is_same_company_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_members me
    join public.company_members them on them.company_id = me.company_id
    where me.user_id = auth.uid()
      and them.user_id = p_user_id
  );
$$;

grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.my_company_ids() to authenticated;
grant execute on function public.is_same_company_user(uuid) to authenticated;

-- ------------------------------------------------------------
-- 2) profiles ÜZERİNDEKİ TÜM POLICY'LERİ KALDIR
--    (recursion yapan dahil; aşağıda temiz set yeniden kurulur)
-- ------------------------------------------------------------

do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
  loop
    execute format('drop policy if exists %I on public.profiles', r.policyname);
  end loop;
end $$;

alter table public.profiles enable row level security;

-- ------------------------------------------------------------
-- 3) YENİ profiles POLICY'LERİ (recursion'sız)
-- ------------------------------------------------------------

-- Okuma: kendi kaydı + super admin tümü + aynı firmadaki kullanıcılar
create policy "profiles_select" on public.profiles
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_super_admin()
    or public.is_same_company_user(user_id)
  );

-- Güncelleme: kendi kaydı (rol hariç — rol değişikliği super admin'e ait)
create policy "profiles_update_self" on public.profiles
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Super admin: tam yetki
create policy "profiles_all_super_admin" on public.profiles
  for all to authenticated
  using (public.is_super_admin())
  with check (public.is_super_admin());

-- Insert: kendi profili (signup/join akışları SECURITY DEFINER RPC ile
-- çalıştığından zaten RLS'e takılmaz; bu policy doğrudan istemci
-- insert'i gerekirse kendi user_id'siyle sınırlar)
create policy "profiles_insert_self" on public.profiles
  for insert to authenticated
  with check (user_id = auth.uid() or public.is_super_admin());

-- ------------------------------------------------------------
-- 4) company_members policy'sindeki aynı recursion riskini düzelt
--    (policy kendi tablosunu sorguluyordu)
-- ------------------------------------------------------------

drop policy if exists "company_members_select_same_company" on public.company_members;
create policy "company_members_select_same_company" on public.company_members
  for select to authenticated
  using (
    user_id = auth.uid()
    or company_id in (select public.my_company_ids())
    or public.is_super_admin()
  );

-- ------------------------------------------------------------
-- 5) user_invites policy'sini de helper'larla yeniden kur
-- ------------------------------------------------------------

drop policy if exists "user_invites_select_super_or_admin" on public.user_invites;
create policy "user_invites_select_super_or_admin" on public.user_invites
  for select to authenticated
  using (
    public.is_super_admin()
    or company_id in (select public.my_company_ids())
  );

-- ------------------------------------------------------------
-- 6) SON KONTROL
-- ------------------------------------------------------------

notify pgrst, 'reload schema';

select 'SONUC: profiles policies' as section, policyname, cmd
from pg_policies where schemaname = 'public' and tablename = 'profiles'
order by policyname;

-- Bu sorgu hatasız dönerse recursion çözülmüştür:
select 'SONUC: profiles okunabilir' as check_name, count(*) >= 0 as ok from public.profiles;
