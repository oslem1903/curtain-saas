-- Role cleanup for stable app authorization.
-- Run this once in Supabase SQL editor if existing users have legacy role values.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

UPDATE public.profiles
SET role = CASE
  WHEN lower(trim(role)) IN ('super_admin', 'superadmin', 'super yonetici', 'super yönetici') THEN 'super_admin'
  WHEN lower(trim(role)) IN ('admin', 'manager', 'yonetici', 'yönetici') THEN 'admin'
  WHEN lower(trim(role)) IN ('accountant', 'accounting', 'muhasebe', 'muhasebeci') THEN 'accountant'
  WHEN lower(trim(role)) IN ('installer', 'staff', 'montaj', 'montajci', 'montajcı') THEN 'installer'
  ELSE role
END
WHERE role IS NOT NULL;

ALTER TABLE public.profiles
ADD CONSTRAINT profiles_role_check
CHECK (role IN ('super_admin', 'admin', 'accountant', 'installer'));

ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'installer';
