-- ============================================================
-- PERDEPRO - subscription_plan check constraint düzeltmesi
-- Hata: companies_subscription_plan_chk 'solo' değerini kabul etmiyor.
-- Bu script:
--   1) Mevcut constraint tanımını gösterir (TANI)
--   2) Constraint'i kaldırıp yeni paket kodlarını da içeren
--      genişletilmiş haliyle yeniden kurar
--   3) Paket düzeltmelerini yeniden uygular
-- Tek seferde çalışır, idempotent, veri silmez.
-- ============================================================

-- ------------------------------------------------------------
-- 0) TANI: mevcut constraint hangi değerlere izin veriyor?
-- ------------------------------------------------------------
select 'TANI: mevcut constraint' as section,
       conname,
       pg_get_constraintdef(oid) as tanim
from pg_constraint
where conrelid = 'public.companies'::regclass
  and contype = 'c'
  and conname ilike '%subscription_plan%';

-- Mevcut verideki tüm plan değerleri (hiçbiri kapsam dışı kalmasın diye)
select 'TANI: kullanilan plan degerleri' as section,
       subscription_plan, count(*)
from companies
group by subscription_plan;

-- ------------------------------------------------------------
-- 1) CONSTRAINT'İ GENİŞLET
--    Eski izinli değerler + yeni paket kodları + NULL serbest.
--    NOT VALID ile eklenir: mevcut satırlar ne olursa olsun script
--    hata vermez; yalnızca yeni yazımlar denetlenir.
-- ------------------------------------------------------------

alter table public.companies
    drop constraint if exists companies_subscription_plan_chk;

alter table public.companies
    add constraint companies_subscription_plan_chk
    check (
        subscription_plan is null
        or lower(subscription_plan) in (
            'starter', 'trial', 'free',
            'solo', 'solo_perdeci',
            'pro', 'professional', 'yonetici',
            'enterprise', 'ekip', 'kurumsal',
            'lifetime'
        )
    ) not valid;

-- Mevcut satırları da doğrulamayı dene; kapsam dışı eski bir değer
-- varsa script durmasın, sadece raporlansın:
do $$
begin
    begin
        alter table public.companies validate constraint companies_subscription_plan_chk;
        raise notice 'Constraint dogrulandi: tum mevcut satirlar uyumlu.';
    exception when check_violation then
        raise notice 'UYARI: bazi eski satirlar yeni constraint disinda. Asagidaki TANI sorgusuyla gorebilirsiniz; yeni yazimlar yine de denetleniyor.';
    end;
end $$;

-- Kapsam dışı kalan satırlar (varsa elle inceleyin)
select 'TANI: kapsam disi plan degerleri' as section, id, name, subscription_plan
from companies
where subscription_plan is not null
  and lower(subscription_plan) not in (
      'starter','trial','free','solo','solo_perdeci',
      'pro','professional','yonetici','enterprise','ekip','kurumsal','lifetime'
  );

-- ------------------------------------------------------------
-- 2) PAKET DÜZELTMELERİNİ UYGULA
--    (önceki supabase_fix_package_codes.sql'in yapamadığı kısım)
-- ------------------------------------------------------------

-- package_code dolu olan firmalarda subscription_plan'ı eşitle
update companies
set subscription_plan = package_code
where package_code in ('solo', 'solo_perdeci', 'pro', 'yonetici', 'enterprise', 'ekip')
  and (subscription_plan is null or lower(subscription_plan) in ('starter', 'trial'))
  and subscription_plan is distinct from package_code;

-- package_code boş ama modül seti Solo olan firmaları işaretle
update companies
set package_code = 'solo',
    subscription_plan = 'solo'
where package_code is null
  and lower(coalesce(subscription_plan, 'starter')) in ('starter', 'trial')
  and enabled_modules is not null
  and 'suppliers' = any(enabled_modules)
  and 'installation' = any(enabled_modules)
  and not ('accounting' = any(enabled_modules));

-- Solo firmalarda enabled_modules boşsa varsayılan Solo setini yaz
update companies
set enabled_modules = array['admin','measurements','orders','customers','appointments','suppliers','installation','catalogs','staff']
where package_code in ('solo', 'solo_perdeci')
  and (enabled_modules is null or array_length(enabled_modules, 1) is null);

-- ------------------------------------------------------------
-- 3) SONUC
-- ------------------------------------------------------------

select 'SONUC: yeni constraint' as section,
       pg_get_constraintdef(oid) as tanim
from pg_constraint
where conrelid = 'public.companies'::regclass
  and conname = 'companies_subscription_plan_chk';

select 'SONUC: paket dagilimi' as section, package_code, subscription_plan, count(*)
from companies
group by package_code, subscription_plan
order by count(*) desc;

notify pgrst, 'reload schema';
