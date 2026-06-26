-- Profiles tablosuna email sütunu ekleme ve verileri taşıma
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email text;

-- Auth tablosundaki mailleri profiles tablosuna kopyalama
-- Not: Bu işlem Supabase Dashboard üzerinden çalıştırılmalıdır.
UPDATE profiles 
SET email = (SELECT email FROM auth.users WHERE auth.users.id = profiles.user_id)
WHERE email IS NULL;
