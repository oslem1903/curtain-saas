-- =============================================================
-- appointments: super admin (impersonation) UPDATE RLS bypass
--
-- Root cause: "Firma Olarak Giris" sirasinda auth.uid() gercek
-- super admin ID'si olarak kalir; bu ID ilgili firmanin
-- company_members tablosunda YOK. appointments UPDATE icin iki
-- permissive policy var: "appointments company members update"
-- (company_members uyeligi) ve "appointments_update_role_scope"
-- (public.current_company_id() -> super admin icin NULL doner,
-- hicbir zaman eslesmez). Postgres'te ayni komut icin permissive
-- policy'ler OR ile birlesir; bu yuzden yalnizca birine
-- is_super_admin() bypass eklemek yeterlidir.
--
-- Bu migration YALNIZCA "appointments company members update"
-- policy'sini degistirir. "appointments_update_role_scope"'a
-- (personel/rol bazli, daha karmasik) DOKUNULMAZ.
--
-- Normal tenant kullanicisi icin mevcut company_members kosulu
-- BIREBIR korunur (sadece OR ile genisletilir, daraltilmaz).
-- Idempotent, additive: veri/semaya dokunmaz, RLS'i disable
-- etmez, using(true)/with check(true) kullanmaz.
-- =============================================================

drop policy if exists "appointments company members update" on public.appointments;
create policy "appointments company members update"
on public.appointments for update
using (
  public.is_super_admin()
  or exists (
    select 1
    from public.company_members cm
    where cm.company_id = appointments.company_id
      and cm.user_id = auth.uid()
  )
)
with check (
  public.is_super_admin()
  or exists (
    select 1
    from public.company_members cm
    where cm.company_id = appointments.company_id
      and cm.user_id = auth.uid()
  )
);

-- Dogrulama (READ-ONLY, migration disinda calistirin):
-- select polname, polcmd,
--        pg_get_expr(polqual, polrelid)      as using_expr,
--        pg_get_expr(polwithcheck, polrelid) as with_check_expr
-- from pg_policy
-- where polrelid = 'public.appointments'::regclass
--   and polcmd = 'u';
