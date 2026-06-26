-- Employees tablosuna davet kodu ekleme
ALTER TABLE employees ADD COLUMN IF NOT EXISTS invite_code text UNIQUE;

-- Cihaz Güvenlik Kayıtları için profiles tablosuna da sütun ekleyelim (Eğer yoksa)
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bound_device_id text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_locked boolean DEFAULT false;
