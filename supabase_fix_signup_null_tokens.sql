-- ============================================================
-- PERDEPRO - "Database error finding user" KESİN FIX
-- (signup'ta GoTrue'nun e-posta araması aşamasında 500)
--
-- ANA SEBEP: SQL ile oluşturulmuş/onarılmış auth.users satırlarında
-- token kolonları NULL kalır. GoTrue bu satırları okurken NULL'u
-- string'e çeviremez ve "Database error finding user" döner.
--
-- Bu script:
--  1) auth.users'taki NULL string kolonlarını boş string yapar (veri kaybı yok)
--  2) handle_new_user trigger'ını sıfırdan, exception fırlatamaz şekilde kurar
--  3) Trigger'ın yazdığı profiles insert'inin RLS'e takılmamasını garanti eder
-- Tek seferde çalışır, idempotent.
-- ============================================================

-- ------------------------------------------------------------
-- 0) TANI: NULL token'lı kullanıcı var mı? (sorunun kanıtı)
-- ------------------------------------------------------------
select 'TANI: NULL token kolonlu auth.users' as section, count(*) as bozuk_satir
from auth.users
where confirmation_token is null
   or recovery_token is null
   or email_change is null
   or email_change_token_new is null
   or email_change_token_current is null
   or phone_change is null
   or phone_change_token is null
   or reauthentication_token is null;

-- ------------------------------------------------------------
-- 1) NULL STRING KOLONLARINI ONAR (GoTrue'nun beklediği boş string)
-- ------------------------------------------------------------
update auth.users set
    confirmation_token         = coalesce(confirmation_token, ''),
    recovery_token             = coalesce(recovery_token, ''),
    email_change               = coalesce(email_change, ''),
    email_change_token_new     = coalesce(email_change_token_new, ''),
    email_change_token_current = coalesce(email_change_token_current, ''),
    phone_change               = coalesce(phone_change, ''),
    phone_change_token         = coalesce(phone_change_token, ''),
    reauthentication_token     = coalesce(reauthentication_token, ''),
    email_change_confirm_status = coalesce(email_change_confirm_status, 0),
    aud  = coalesce(nullif(aud, ''), 'authenticated'),
    role = coalesce(nullif(role, ''), 'authenticated'),
    raw_app_meta_data  = coalesce(raw_app_meta_data, '{"provider":"email","providers":["email"]}'::jsonb),
    raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb),
    updated_at = coalesce(updated_at, now()),
    created_at = coalesce(created_at, now())
where confirmation_token is null
   or recovery_token is null
   or email_change is null
   or email_change_token_new is null
   or email_change_token_current is null
   or phone_change is null
   or phone_change_token is null
   or reauthentication_token is null
   or email_change_confirm_status is null
   or coalesce(aud, '') = ''
   or coalesce(role, '') = ''
   or raw_app_meta_data is null
   or raw_user_meta_data is null;

-- Aynı e-postaya birden fazla kullanıcı varsa GoTrue araması yine patlar — göster:
select 'TANI: duplicate email (elle incelenmeli)' as section, lower(email) as email, count(*)
from auth.users
where email is not null
group by lower(email)
having count(*) > 1;

-- ------------------------------------------------------------
-- 2) auth.users TRIGGERLARINI SIFIRLA
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
-- 3) handle_new_user — TAMAMEN GÜVENLİ SÜRÜM
--    * SECURITY DEFINER + sabit search_path → RLS/policy sorgusuna takılmaz
--    * Gövdenin TAMAMI exception yakalayıcı içinde → asla hata fırlatmaz
--    * profiles kaydı yoksa açar, varsa e-posta/isim günceller, role'a dokunmaz
--    * full_name/email metadata'dan alınır
-- ------------------------------------------------------------
drop function if exists public.handle_new_user() cascade;

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_full_name text;
  v_role text;
begin
  begin
    v_email := lower(coalesce(new.email, new.raw_user_meta_data->>'email', ''));
    v_full_name := nullif(trim(coalesce(
        new.raw_user_meta_data->>'full_name',
        new.raw_user_meta_data->>'name',
        split_part(v_email, '@', 1)
    )), '');
    v_role := lower(coalesce(new.raw_user_meta_data->>'role', 'installer'));
    if v_role not in ('super_admin','admin','accountant','installer','measurement','personnel') then
      v_role := 'installer';
    end if;

    insert into public.profiles (user_id, email, full_name, role, is_active, created_at, updated_at)
    values (new.id, nullif(v_email, ''), v_full_name, v_role, true, now(), now())
    on conflict (user_id) do update set
      email      = coalesce(excluded.email, public.profiles.email),
      full_name  = coalesce(public.profiles.full_name, excluded.full_name),
      updated_at = now();
      -- role bilinçli olarak güncellenmiyor: mevcut rol korunur

  exception when others then
    -- Signup HİÇBİR koşulda bloke edilmez; hata sadece loglanır
    begin
      insert into public.auth_repair_log(source, user_id, email, message, sqlstate)
      values ('handle_new_user', new.id, coalesce(v_email, new.email), sqlerrm, sqlstate);
    exception when others then
      null;
    end;
  end;

  return new;
end;
$$;

-- Trigger fonksiyonu tablo SAHİBİ olarak çalışır; profiles'ta RLS açık olsa
-- bile sahibi RLS'e tabi değildir. Yine de garanti olsun diye FORCE kapalı tut:
alter table public.profiles no force row level security;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- 4) İZİNLER (GoTrue'nun trigger'ı çalıştırabilmesi için)
-- ------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    grant usage on schema public to supabase_auth_admin;
    grant execute on function public.handle_new_user() to supabase_auth_admin;
  end if;
end $$;

-- ------------------------------------------------------------
-- 5) SON KONTROL
-- ------------------------------------------------------------
notify pgrst, 'reload schema';

select 'SONUC: NULL token kalan satir' as check_name,
       (select count(*) from auth.users
        where confirmation_token is null or recovery_token is null
           or email_change is null or email_change_token_new is null
           or email_change_token_current is null or phone_change is null
           or phone_change_token is null or reauthentication_token is null) = 0 as ok;

select 'SONUC: trigger kurulu' as check_name, t.tgname,
       p.prosecdef as security_definer
from pg_trigger t
join pg_proc p on p.oid = t.tgfoid
where t.tgrelid = 'auth.users'::regclass and not t.tgisinternal;
