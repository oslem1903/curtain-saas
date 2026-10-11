-- ============================================================================
-- Migration 024 ON KONTROL — SALT OKUNUR (hicbir veriyi degistirmez)
-- Supabase SQL Editor'da calistirin; sonuclari migration'dan ONCE inceleyin.
-- ============================================================================

-- A) Gerekli yardimci fonksiyonlar mevcut mu? (hepsi true olmali)
SELECT
  to_regprocedure('public.is_super_admin()') IS NOT NULL            AS is_super_admin_var,
  to_regprocedure('public.is_company_member(uuid)') IS NOT NULL     AS is_company_member_var,
  to_regprocedure('public.is_company_writable(uuid)') IS NOT NULL   AS is_company_writable_var,
  to_regprocedure('public.accept_invite_code_for_current_user(text,text,text)') IS NOT NULL AS davet_kod_rpc_var,
  to_regclass('public.user_invites') IS NOT NULL                    AS user_invites_var;

-- B) auth.users ve company_members uzerindeki tetikleyiciler
--    'trg_company_members_tenant_write' VARSA: su anki davet kabulu yeni
--    kullanicilar icin hata veriyor olabilir; migration bunu duzeltir.
SELECT c.relnamespace::regnamespace AS sema, c.relname AS tablo, t.tgname AS tetikleyici,
       p.proname AS fonksiyon, t.tgenabled AS durum
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE NOT t.tgisinternal
  AND ((c.relnamespace = 'auth'::regnamespace AND c.relname = 'users')
       OR (c.relnamespace = 'public'::regnamespace AND c.relname = 'company_members'))
ORDER BY 1, 2, 3;

-- C) GUVENLIK: super_admin profilleri. Tanimadiginiz bir e-posta varsa
--    (eski handle_new_user metadata rolune guveniyordu) rolunu duzeltin.
SELECT p.user_id, p.email, p.role, u.created_at AS hesap_olusturma, u.raw_user_meta_data->>'role' AS kayit_metadata_rolu
FROM public.profiles p
LEFT JOIN auth.users u ON u.id = p.user_id
WHERE lower(coalesce(p.role, '')) = 'super_admin'
ORDER BY u.created_at;

-- D) Sunucu tarafli yazma korumasinin SALT OKUNUR sayacagi firmalar.
--    Bunlar uygulamada zaten salt okunur gorunur (isTrialExpired ile ayni kural).
--    Listede yazmaya devam etmesi gereken bir firma varsa migration'dan once
--    plan_status/trial_ends_at/license_expires_at/is_pilot degerini duzeltin.
SELECT c.id, c.name, c.plan_status, c.subscription_plan, c.trial_ends_at, c.license_expires_at,
       c.is_pilot, c.is_active, c.read_only,
       (SELECT count(*) FROM public.company_members m WHERE m.company_id = c.id AND coalesce(m.is_active, true)) AS aktif_uye
FROM public.companies c
WHERE NOT (
  coalesce(c.is_active, true)
  AND NOT coalesce(c.read_only, false)
  AND lower(coalesce(c.plan_status, '')) <> 'suspended'
  AND (
    coalesce(c.is_pilot, false)
    OR CASE lower(coalesce(c.plan_status, ''))
         WHEN 'expired'  THEN false
         WHEN 'lifetime' THEN true
         WHEN 'active'   THEN (c.license_expires_at IS NULL OR c.license_expires_at >= now())
         ELSE (c.trial_ends_at IS NOT NULL AND c.trial_ends_at >= now())
       END
  )
)
ORDER BY c.name;

-- E) Deneme hakki "kullanilmis" sayilacak mevcut yonetici sayisi (backfill)
SELECT count(DISTINCT cm.user_id) AS backfill_edilecek_yonetici
FROM public.company_members cm
JOIN auth.users u ON u.id = cm.user_id
WHERE cm.role IN ('admin', 'owner') AND nullif(u.email, '') IS NOT NULL;

-- F) Firmasi olmayan kullanicilar (yeni akista "Hesap kurulumu" ekranini gorur)
SELECT u.id, u.email, p.role, u.created_at
FROM auth.users u
LEFT JOIN public.profiles p ON p.user_id = u.id
WHERE NOT EXISTS (SELECT 1 FROM public.company_members cm WHERE cm.user_id = u.id)
  AND lower(coalesce(p.role, '')) <> 'super_admin'
ORDER BY u.created_at DESC
LIMIT 100;

-- G) Korunacak is tablolari ve company_id kolonu
SELECT t.table_name,
       EXISTS (SELECT 1 FROM information_schema.columns c
               WHERE c.table_schema = 'public' AND c.table_name = t.table_name AND c.column_name = 'company_id') AS company_id_var
FROM information_schema.tables t
WHERE t.table_schema = 'public'
  AND t.table_name = ANY (ARRAY[
    'customers','customer_rooms','appointments','measurements','orders','order_items','order_payment_plans',
    'order_installments','quotes','quote_items','products','catalogs','catalog_series','catalog_variants',
    'catalog_code_photos','suppliers','supplier_transactions','supplier_payments','supplier_product_prices',
    'installation_jobs','installer_transactions','installer_earnings','employees','employee_transactions','staff',
    'payments','customer_collections','income','expenses','transactions','invoices','invoice_items',
    'visual_previews','field_info','branches','vehicles','warehouse_items'])
ORDER BY 1;
