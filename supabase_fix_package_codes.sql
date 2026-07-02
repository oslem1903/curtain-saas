-- ============================================================
-- PERDEPRO - Paket kodu düzeltmesi
-- Sorun: Super Admin'de "Solo Perdeci" seçildiğinde subscription_plan
-- alanına yanlışlıkla 'starter' yazılıyordu. Bu script mevcut
-- firmalardaki tutarsızlığı düzeltir. Veri silmez, idempotent.
-- ============================================================

-- TANI: tutarsız firmalar
select 'TANI: package_code solo ama plan starter' as section, id, name, subscription_plan, package_code
from companies
where package_code in ('solo', 'solo_perdeci') and subscription_plan = 'starter';

-- 1) package_code solo olan firmalarda subscription_plan'ı eşitle
update companies
set subscription_plan = package_code
where package_code in ('solo', 'solo_perdeci', 'pro', 'yonetici', 'enterprise', 'ekip')
  and (subscription_plan is null or subscription_plan in ('starter', 'trial'))
  and subscription_plan is distinct from package_code;

-- 2) package_code boş ama enabled_modules solo setine sahip firmalar:
--    (suppliers + installation içeriyorsa solo kabul et)
update companies
set package_code = 'solo',
    subscription_plan = 'solo'
where package_code is null
  and subscription_plan in ('starter', 'trial')
  and enabled_modules is not null
  and 'suppliers' = any(enabled_modules)
  and 'installation' = any(enabled_modules)
  and not ('accounting' = any(enabled_modules));

-- 3) Solo firmalarda enabled_modules boşsa varsayılan solo setini yaz
update companies
set enabled_modules = array['admin','measurements','orders','customers','appointments','suppliers','installation','catalogs','staff']
where package_code in ('solo', 'solo_perdeci')
  and (enabled_modules is null or array_length(enabled_modules, 1) is null);

-- SONUC
select 'SONUC: paket dagilimi' as section, package_code, subscription_plan, count(*)
from companies
group by package_code, subscription_plan
order by count(*) desc;

notify pgrst, 'reload schema';
