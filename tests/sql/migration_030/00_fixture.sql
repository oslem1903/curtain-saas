-- LOCAL TEST DATABASE ONLY. Uretimdeki create_company_invite tanimini yansitir (yalnizca test icin).
CREATE OR REPLACE FUNCTION public.create_company_invite(p_company_id uuid, p_email text, p_role text, p_expires_in_days integer DEFAULT 7)
RETURNS TABLE(invite_id uuid, token text, invite_code text, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $f$
declare v_role text := lower(coalesce(p_role,'')); v_id uuid; v_tok text; v_code text; v_exp timestamptz;
begin
  if not public.is_super_admin() and not public.is_company_admin(p_company_id) then raise exception 'Bu daveti olusturma yetkiniz yok.'; end if;
  if not public.is_super_admin() and v_role='admin' then raise exception 'Firma yoneticisi yeni admin olusturamaz.'; end if;
  if v_role not in ('admin','accountant','installer','measurement') then raise exception 'Gecersiz rol.'; end if;
  v_tok := md5(random()::text || clock_timestamp()::text);
  v_code := public.generate_invite_code();
  v_exp := now() + make_interval(days => greatest(1, least(coalesce(p_expires_in_days,7),30)));
  insert into public.user_invites(company_id,email,role,token,invite_code,expires_at,invited_by)
  values (p_company_id, lower(trim(p_email)), v_role, v_tok, v_code, v_exp, auth.uid()) returning id into v_id;
  return query select v_id, v_tok, v_code, v_exp;
end $f$;

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS encrypted_password text DEFAULT 'bcrypt-test-hash';
ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
