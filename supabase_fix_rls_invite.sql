-- Davet kodunun dışarıdan sorgulanabilmesi için güvenlik kuralını esnetelim
-- Önce eski kuralı silelim (Eğer sadece bu kural varsa)
DROP POLICY IF EXISTS "Şirket personeli sadece kendi şirketini görür" ON employees;

-- Yeni Kural 1: Şirket içindekiler her şeyi görür
CREATE POLICY "Şirket üyeleri personeli görebilir" ON employees
    FOR ALL USING (company_id IN (SELECT company_id FROM company_members WHERE user_id = auth.uid()));

-- Yeni Kural 2: Kayıtsız kullanıcılar sadece davet kodunu kontrol edebilir
CREATE POLICY "Kayıtsız kullanıcılar davet kodu sorgulayabilir" ON employees
    FOR SELECT TO anon, authenticated
    USING (invite_code IS NOT NULL);
