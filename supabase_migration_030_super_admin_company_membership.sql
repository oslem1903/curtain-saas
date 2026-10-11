-- Migration 030: guvenli super-admin firma/hesap eslestirmesi.
-- Firma iletisim e-postasi companies.email alanidir; auth.users.email degismez.
-- Var olan firma uyelikleri baska firmaya tasinmaz/silinmez.
-- Gerekli: migration 026 ve create_company_invite(uuid,text,text,integer).

BEGIN;

DO $pre$
BEGIN
  IF to_regprocedure('public.super_admin_require()') IS NULL
     OR to_regprocedure('public.super_admin_log_access_change(uuid,text,jsonb,jsonb,text)') IS NULL
     OR to_regprocedure('public.create_company_invite(uuid,text,text,integer)') IS NULL THEN
    RAISE EXCEPTION 'PREFLIGHT: migration 026 ve mevcut davet RPCsi gerekli.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='companies' AND column_name='email') THEN
    RAISE EXCEPTION 'PREFLIGHT: companies.email yok; iletisim e-postasi semasi incelenmeli.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='user_invites' AND column_name='invite_code')
     OR coalesce(pg_get_function_result(to_regprocedure('public.create_company_invite(uuid,text,text,integer)')),'') NOT ILIKE '%invite_code%' THEN
    RAISE EXCEPTION 'PREFLIGHT: mevcut davet RPCsi davet kodu dondurmuyor; supabase_invite_code_flow.sql semasi dogrulanmali.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.company_members'::regclass
    AND contype IN ('u','p') AND pg_get_constraintdef(oid) IN ('UNIQUE (company_id, user_id)','PRIMARY KEY (company_id, user_id)')) THEN
    RAISE EXCEPTION 'PREFLIGHT: company_members unique(company_id,user_id) gerekli.';
  END IF;
END
$pre$;

CREATE OR REPLACE FUNCTION public.super_admin_update_company_details(
  p_company_id uuid,p_name text,p_contact_email text,p_package_code text,
  p_plan_status text,p_max_devices integer,p_read_only boolean,p_is_active boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $fn$
DECLARE
  v_actor uuid := public.super_admin_require();
  v_company public.companies%ROWTYPE;
  v_email text := nullif(lower(trim(coalesce(p_contact_email,''))),'');
  v_name text := left(trim(coalesce(p_name,'')),120);
  v_package text := lower(trim(coalesce(p_package_code,'')));
  v_status text := lower(trim(coalesce(p_plan_status,'')));
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF length(v_name)<2 THEN RAISE EXCEPTION 'Firma adi en az 2 karakter olmali.'; END IF;
  IF v_email IS NOT NULL AND v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Gecerli firma iletisim e-postasi girin.'; END IF;
  IF v_package NOT IN ('solo','starter','pro','enterprise') THEN RAISE EXCEPTION 'Gecersiz firma paketi.'; END IF;
  IF v_status NOT IN ('trial','active','expired','suspended') THEN RAISE EXCEPTION 'Gecersiz firma durumu.'; END IF;
  IF p_max_devices IS NULL OR p_max_devices<1 OR p_max_devices>50 THEN RAISE EXCEPTION 'Cihaz limiti 1 ile 50 arasinda olmali.'; END IF;

  SELECT * INTO v_company FROM public.companies WHERE id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERDEPRO_NOT_FOUND: Firma bulunamadi.'; END IF;
  v_before := jsonb_build_object('name',v_company.name,'contact_email',v_company.email,'package_code',v_company.package_code,
    'plan_status',v_company.plan_status,'max_devices',v_company.max_devices,'read_only',v_company.read_only,'is_active',v_company.is_active);
  UPDATE public.companies SET name=v_name,email=v_email,package_code=v_package,
    subscription_plan=CASE WHEN v_package='solo' THEN 'starter' ELSE v_package END,
    plan_status=v_status,subscription_status=CASE WHEN v_status IN ('trial','active','expired','suspended') THEN v_status ELSE subscription_status END,
    max_devices=p_max_devices,read_only=coalesce(p_read_only,false),is_active=coalesce(p_is_active,true),
    updated_by=v_actor,updated_at=now()
  WHERE id=p_company_id;
  v_after := jsonb_build_object('name',v_name,'contact_email',v_email,'package_code',v_package,
    'plan_status',v_status,'max_devices',p_max_devices,'read_only',coalesce(p_read_only,false),'is_active',coalesce(p_is_active,true));
  PERFORM public.super_admin_log_access_change(p_company_id,'SUPER_ADMIN_COMPANY_DETAILS_UPDATED',v_before,v_after,NULL);
  RETURN jsonb_build_object('company_id',p_company_id,'before',v_before,'after',v_after);
END
$fn$;

CREATE OR REPLACE FUNCTION public.super_admin_search_accounts_by_email(p_email text)
RETURNS TABLE(
  user_id uuid,email text,full_name text,email_confirmed_at timestamptz,
  profile_role text,is_active boolean,memberships jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth
AS $fn$
DECLARE v_query text := lower(trim(coalesce(p_email,'')));
BEGIN
  PERFORM public.super_admin_require();
  IF length(v_query)<3 THEN RAISE EXCEPTION 'En az 3 karakter girin.'; END IF;
  RETURN QUERY
  SELECT u.id,lower(u.email),coalesce(p.full_name,u.raw_user_meta_data->>'full_name'),u.email_confirmed_at,
    p.role,p.is_active,
    coalesce((SELECT jsonb_agg(jsonb_build_object('company_id',m.company_id,'company_name',c.name,'role',m.role,'is_active',coalesce(m.is_active,true))
      ORDER BY coalesce(m.is_active,true) DESC,m.created_at)
      FROM public.company_members m JOIN public.companies c ON c.id=m.company_id WHERE m.user_id=u.id),'[]'::jsonb)
  FROM auth.users u LEFT JOIN public.profiles p ON p.user_id=u.id
  WHERE lower(u.email) LIKE v_query || '%'
  ORDER BY lower(u.email) LIMIT 20;
END
$fn$;

CREATE OR REPLACE FUNCTION public.super_admin_list_company_members(p_company_id uuid)
RETURNS TABLE(user_id uuid,email text,full_name text,role text,is_active boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,auth
AS $fn$
BEGIN
  PERFORM public.super_admin_require();
  IF NOT EXISTS (SELECT 1 FROM public.companies WHERE id=p_company_id) THEN
    RAISE EXCEPTION 'PERDEPRO_NOT_FOUND: Firma bulunamadi.';
  END IF;
  RETURN QUERY
  SELECT m.user_id,lower(u.email),p.full_name,m.role,coalesce(m.is_active,true)
  FROM public.company_members m LEFT JOIN auth.users u ON u.id=m.user_id
  LEFT JOIN public.profiles p ON p.user_id=m.user_id
  WHERE m.company_id=p_company_id
  ORDER BY (m.role IN ('admin','owner')) DESC,coalesce(m.is_active,true) DESC,lower(u.email);
END
$fn$;

CREATE OR REPLACE FUNCTION public.super_admin_link_company_user(
  p_company_id uuid,p_user_id uuid,p_role text,p_confirm_other_memberships boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth
AS $fn$
DECLARE
  v_actor uuid := public.super_admin_require();
  v_role text := lower(trim(coalesce(p_role,'')));
  v_user auth.users%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_company public.companies%ROWTYPE;
  v_existing public.company_members%ROWTYPE;
  v_other jsonb;
  v_before jsonb;
  v_after jsonb;
BEGIN
  IF v_role NOT IN ('admin','accountant','installer','measurement') THEN RAISE EXCEPTION 'Gecersiz firma rolu.'; END IF;
  SELECT * INTO v_company FROM public.companies WHERE id=p_company_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERDEPRO_NOT_FOUND: Firma bulunamadi.'; END IF;
  SELECT * INTO v_user FROM auth.users WHERE id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERDEPRO_NOT_FOUND: Auth hesabi bulunamadi.'; END IF;
  IF v_user.email_confirmed_at IS NULL THEN RAISE EXCEPTION 'E-posta dogrulanmamis; mevcut hesap baglanmadi.'; END IF;
  SELECT * INTO v_profile FROM public.profiles WHERE user_id=p_user_id FOR UPDATE;
  IF FOUND AND lower(coalesce(v_profile.role,''))='super_admin' THEN RAISE EXCEPTION 'Super admin hesabi firma kullanicisi yapilamaz.'; END IF;
  IF FOUND AND coalesce(v_profile.is_active,true)=false THEN RAISE EXCEPTION 'Hesap pasif; yeniden etkinlestirme ayri ve acik bir islem olmali.'; END IF;

  SELECT * INTO v_existing FROM public.company_members WHERE company_id=p_company_id AND user_id=p_user_id FOR UPDATE;
  IF FOUND AND coalesce(v_existing.is_active,true)=false THEN RAISE EXCEPTION 'Bu firmadaki uyelik pasif; bu akistan yeniden etkinlestirilmez.'; END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object('company_id',m.company_id,'company_name',c.name,'role',m.role)
    ORDER BY m.created_at),'[]'::jsonb) INTO v_other
  FROM public.company_members m JOIN public.companies c ON c.id=m.company_id
  WHERE m.user_id=p_user_id AND m.company_id<>p_company_id AND coalesce(m.is_active,true);

  IF jsonb_array_length(v_other)>0 AND NOT coalesce(p_confirm_other_memberships,false) THEN
    RETURN jsonb_build_object('linked',false,'requires_confirmation',true,'existing_memberships',v_other);
  END IF;

  IF v_existing.user_id IS NULL AND v_company.max_users IS NOT NULL AND (
    SELECT count(DISTINCT m.user_id) FROM public.company_members m
    WHERE m.company_id=p_company_id AND coalesce(m.is_active,true)
  ) >= v_company.max_users THEN RAISE EXCEPTION 'Firma kullanici limiti dolu.'; END IF;

  v_before := jsonb_build_object(
    'user_id',p_user_id,'company_id',p_company_id,
    'membership_role',v_existing.role,'membership_active',v_existing.is_active,
    'profile_role',v_profile.role);

  INSERT INTO public.profiles(user_id,email,full_name,role,is_active,created_at,updated_at)
  VALUES(p_user_id,lower(v_user.email),left(coalesce(nullif(v_user.raw_user_meta_data->>'full_name',''),split_part(v_user.email,'@',1)),120),v_role,true,now(),now())
  ON CONFLICT(user_id) DO UPDATE SET email=excluded.email,
    role=CASE WHEN jsonb_array_length(v_other)=0 AND lower(coalesce(public.profiles.role,''))<>'super_admin'
              THEN excluded.role ELSE public.profiles.role END,
    updated_at=now();

  INSERT INTO public.company_members(company_id,user_id,role,is_active,created_by,updated_by,updated_at)
  VALUES(p_company_id,p_user_id,v_role,true,v_actor,v_actor,now())
  ON CONFLICT(company_id,user_id) DO UPDATE SET role=excluded.role,updated_by=v_actor,updated_at=now();

  IF v_role='admin' AND v_company.owner_id IS NULL THEN
    UPDATE public.companies SET owner_id=p_user_id,updated_by=v_actor,updated_at=now() WHERE id=p_company_id;
  END IF;

  v_after := jsonb_build_object('user_id',p_user_id,'email',lower(v_user.email),'company_id',p_company_id,
    'membership_role',v_role,'profile_role_before',v_profile.role,'other_memberships_preserved',true);
  PERFORM public.super_admin_log_access_change(p_company_id,'SUPER_ADMIN_MEMBER_LINKED',v_before,v_after,NULL);
  RETURN jsonb_build_object('linked',true,'requires_confirmation',false,'company_id',p_company_id,'user_id',p_user_id,'role',v_role);
END
$fn$;

CREATE OR REPLACE FUNCTION public.super_admin_create_company_invite(p_company_id uuid,p_email text,p_role text)
RETURNS TABLE(invite_id uuid,invite_code text,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public
AS $fn$
DECLARE v_email text := lower(trim(coalesce(p_email,''))); v_result record;
BEGIN
  PERFORM public.super_admin_require();
  IF v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'Gecerli e-posta gerekli.'; END IF;
  SELECT * INTO STRICT v_result FROM public.create_company_invite(p_company_id,v_email,p_role,7);
  PERFORM public.super_admin_log_access_change(p_company_id,'SUPER_ADMIN_MEMBER_INVITED',NULL,
    jsonb_build_object('invite_id',v_result.invite_id,'email',v_email,'role',lower(p_role),'expires_at',v_result.expires_at),NULL);
  RETURN QUERY SELECT v_result.invite_id,v_result.invite_code,v_result.expires_at;
END
$fn$;


-- Tek giris noktasi: e-posta + firma ID + rol. Mevcut dogrulanmis hesap -> uyelik;
-- hesap yok/dogrulanmamis -> yalnizca bekleyen davet (tekrar tiklamada ayni davet doner).
CREATE OR REPLACE FUNCTION public.super_admin_assign_user_to_company(
  p_email text,p_company_id uuid,p_role text,p_confirm_other_memberships boolean DEFAULT false
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth
AS $fn$
DECLARE
  v_actor uuid := public.super_admin_require();
  v_email text := lower(regexp_replace(coalesce(p_email,''),'\s','','g'));
  v_role text := lower(trim(coalesce(p_role,'')));
  v_company public.companies%ROWTYPE;
  v_user auth.users%ROWTYPE;
  v_member public.company_members%ROWTYPE;
  v_link jsonb;
  v_invite public.user_invites%ROWTYPE;
  v_created record;
BEGIN
  IF p_company_id IS NULL THEN RAISE EXCEPTION 'Firma secilmeden kullanici eklenemez.'; END IF;
  IF v_email !~ '^[^@]+@[^@]+\.[^@]+$' THEN RAISE EXCEPTION 'Gecerli e-posta gerekli.'; END IF;
  IF v_role NOT IN ('admin','accountant','installer','measurement') THEN RAISE EXCEPTION 'Gecersiz firma rolu.'; END IF;
  SELECT * INTO v_company FROM public.companies WHERE id=p_company_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'PERDEPRO_NOT_FOUND: Firma bulunamadi.'; END IF;

  SELECT * INTO v_user FROM auth.users WHERE lower(trim(email))=v_email ORDER BY created_at LIMIT 1;
  IF FOUND AND v_user.email_confirmed_at IS NOT NULL THEN
    SELECT * INTO v_member FROM public.company_members WHERE company_id=p_company_id AND user_id=v_user.id;
    IF FOUND AND coalesce(v_member.is_active,true) AND v_member.role=v_role THEN
      RETURN jsonb_build_object('status','already_member','company_id',p_company_id,'user_id',v_user.id,'role',v_role);
    END IF;
    v_link := public.super_admin_link_company_user(p_company_id,v_user.id,v_role,coalesce(p_confirm_other_memberships,false));
    IF coalesce((v_link->>'requires_confirmation')::boolean,false) THEN
      RETURN jsonb_build_object('status','requires_confirmation','existing_memberships',v_link->'existing_memberships',
        'user_id',v_user.id,'company_id',p_company_id);
    END IF;
    RETURN jsonb_build_object('status','linked','company_id',p_company_id,'user_id',v_user.id,'role',v_role);
  END IF;

  -- Hesap yok ya da e-posta sahipligi dogrulanmamis: erisim VERILMEZ, bekleyen davet tutulur.
  SELECT * INTO v_invite FROM public.user_invites i
  WHERE i.company_id=p_company_id AND lower(trim(i.email))=v_email AND i.role=v_role
    AND i.used_at IS NULL AND i.expires_at>now()
  ORDER BY i.created_at DESC LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('status','invited','reused',true,'invite_id',v_invite.id,
      'invite_code',v_invite.invite_code,'expires_at',v_invite.expires_at,'company_id',p_company_id,
      'account_exists',v_user.id IS NOT NULL);
  END IF;
  SELECT * INTO v_created FROM public.create_company_invite(p_company_id,v_email,v_role,7);
  PERFORM public.super_admin_log_access_change(p_company_id,'SUPER_ADMIN_MEMBER_INVITED',NULL,
    jsonb_build_object('invite_id',v_created.invite_id,'email',v_email,'role',v_role,'expires_at',v_created.expires_at),NULL);
  RETURN jsonb_build_object('status','invited','reused',false,'invite_id',v_created.invite_id,
    'invite_code',v_created.invite_code,'expires_at',v_created.expires_at,'company_id',p_company_id,
    'account_exists',v_user.id IS NOT NULL);
END
$fn$;

-- Giris yapmis, e-postasi DOGRULANMIS kullanicinin kendi adresine yazilmis bekleyen
-- davetlerini kodsuz tamamlar. Mukerrer cagri ayni uyelikte kalir (idempotent).
CREATE OR REPLACE FUNCTION public.claim_pending_invites_for_current_user()
RETURNS TABLE(accepted_company_id uuid,accepted_role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,auth
AS $fn$
DECLARE v_uid uuid := auth.uid(); v_email text; v_confirmed timestamptz; r record; v_res record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'EMAIL_NOT_VERIFIED'; END IF;
  SELECT lower(trim(u.email)),u.email_confirmed_at INTO v_email,v_confirmed FROM auth.users u WHERE u.id=v_uid;
  IF v_email IS NULL OR v_confirmed IS NULL THEN RAISE EXCEPTION 'EMAIL_NOT_VERIFIED'; END IF;
  FOR r IN
    SELECT DISTINCT ON (i.company_id) i.id FROM public.user_invites i
    WHERE lower(trim(i.email))=v_email AND i.used_at IS NULL AND i.expires_at>now()
    ORDER BY i.company_id,i.created_at DESC
  LOOP
    BEGIN
      SELECT * INTO v_res FROM public.accept_verified_invite(r.id,NULL);
      accepted_company_id := v_res.accepted_company_id; accepted_role := v_res.accepted_role;
      RETURN NEXT;
    EXCEPTION WHEN OTHERS THEN
      -- limit dolu, firma pasif vb.: o davet atlanir, digerleri etkilenmez.
      CONTINUE;
    END;
  END LOOP;
END
$fn$;

REVOKE ALL ON FUNCTION public.super_admin_search_accounts_by_email(text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.super_admin_update_company_details(uuid,text,text,text,text,integer,boolean,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.super_admin_list_company_members(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.super_admin_link_company_user(uuid,uuid,text,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.super_admin_create_company_invite(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.super_admin_search_accounts_by_email(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_update_company_details(uuid,text,text,text,text,integer,boolean,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_list_company_members(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_link_company_user(uuid,uuid,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_create_company_invite(uuid,text,text) TO authenticated;
REVOKE ALL ON FUNCTION public.super_admin_assign_user_to_company(text,uuid,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.super_admin_assign_user_to_company(text,uuid,text,boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.claim_pending_invites_for_current_user() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.claim_pending_invites_for_current_user() TO authenticated;

NOTIFY pgrst,'reload schema';
COMMIT;