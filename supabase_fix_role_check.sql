-- Profiles tablosundaki rol kısıtlamasını güncelleyelim
-- Önce eski kısıtlamayı kaldıralım (hata vermemesi için)
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

-- Eski/ara roller varsa 3 ana role taşıyalım
UPDATE profiles SET role = 'installer' WHERE role IN ('staff', 'montajcı');
UPDATE profiles SET role = 'admin' WHERE role = 'manager';

-- Yeni kısıtlamayı bizim güncel rollerimize göre ekleyelim
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check 
CHECK (role IN (
    'admin', 'yönetici', 
    'accountant', 'muhasebe', 
    'installer', 'montajci', 'montaj'
));
