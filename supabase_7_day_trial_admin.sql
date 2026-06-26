-- 7 gunluk yonetici denemesi acma
-- Supabase SQL Editor'da calistirmadan once asagidaki e-postayi degistirin.

DO $$
DECLARE
  v_email text := 'kullanici@mail.com';
  v_user_id uuid;
  v_company_id uuid;
BEGIN
  ALTER TABLE public.companies
    ADD COLUMN IF NOT EXISTS subscription_plan text DEFAULT 'trial',
    ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz DEFAULT (now() + interval '7 days');

  SELECT id
    INTO v_user_id
  FROM auth.users
  WHERE lower(email) = lower(v_email)
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Bu e-posta ile auth.users kaydi bulunamadi: %', v_email;
  END IF;

  SELECT company_id
    INTO v_company_id
  FROM public.company_members
  WHERE user_id = v_user_id
  LIMIT 1;

  IF v_company_id IS NULL THEN
    INSERT INTO public.companies (name, owner_id, subscription_plan, trial_ends_at)
    VALUES ('PerdePRO', v_user_id, 'trial', now() + interval '7 days')
    RETURNING id INTO v_company_id;

    INSERT INTO public.company_members (company_id, user_id, role)
    VALUES (v_company_id, v_user_id, 'admin');
  ELSE
    UPDATE public.company_members
       SET role = 'admin'
     WHERE company_id = v_company_id
       AND user_id = v_user_id;
  END IF;

  UPDATE public.companies
     SET subscription_plan = 'trial',
         trial_ends_at = now() + interval '7 days'
   WHERE id = v_company_id;

  INSERT INTO public.profiles (user_id, email, role)
  VALUES (v_user_id, lower(v_email), 'admin')
  ON CONFLICT (user_id)
  DO UPDATE SET
    email = excluded.email,
    role = 'admin';
END $$;

-- Sure bitince kullanici giris yapabilir ama uygulama yazma islemlerini engeller.
-- Satin alan hesap icin:
-- UPDATE public.companies SET subscription_plan = 'lifetime', trial_ends_at = NULL WHERE id = 'SIRKET_ID';
