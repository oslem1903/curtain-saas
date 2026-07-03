-- ============================================================
-- PERDEPRO - Şema Keşfi (SALT OKUNUR — hiçbir şeyi değiştirmez)
-- Amaç: support/müdahale sisteminin gerçek tablo adlarına oturması için
-- bu veritabanında HANGİ tabloların var olduğunu görmek.
-- SQL Editor'da çalıştır, çıktının TAMAMINI paylaş.
-- ============================================================

-- 1) Tüm kullanıcı tabloları (hangi şemada, kaç kolon)
SELECT table_schema,
       table_name,
       (SELECT count(*) FROM information_schema.columns c
         WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name) AS kolon_sayisi
FROM information_schema.tables t
WHERE table_type = 'BASE TABLE'
  AND table_schema NOT IN ('pg_catalog', 'information_schema', 'auth', 'storage',
                           'extensions', 'graphql', 'graphql_public', 'realtime',
                           'supabase_functions', 'vault', 'net', 'pgsodium', 'pgsodium_masks')
ORDER BY table_schema, table_name;

-- 2) İş tablolarını anahtar kelimeyle filtrele (sipariş/müşteri/ödeme/tedarikçi/ölçü)
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_type = 'BASE TABLE'
  AND (
        table_name ILIKE '%order%'    OR table_name ILIKE '%siparis%'
     OR table_name ILIKE '%customer%' OR table_name ILIKE '%musteri%' OR table_name ILIKE '%client%'
     OR table_name ILIKE '%payment%'  OR table_name ILIKE '%tahsil%'  OR table_name ILIKE '%collection%'
     OR table_name ILIKE '%supplier%' OR table_name ILIKE '%tedarik%' OR table_name ILIKE '%cari%'
     OR table_name ILIKE '%appointment%' OR table_name ILIKE '%measure%' OR table_name ILIKE '%olcu%'
     OR table_name ILIKE '%quote%'    OR table_name ILIKE '%teklif%'   OR table_name ILIKE '%invoice%'
     OR table_name ILIKE '%install%'
  )
ORDER BY table_schema, table_name;

-- 3) Beklenen tablo adları gerçekten var mı? (support/müdahale bunları kullanıyor)
SELECT adlar.t AS beklenen_tablo,
       to_regclass('public.' || adlar.t) IS NOT NULL AS var_mi,
       EXISTS (
           SELECT 1 FROM information_schema.columns c
           WHERE c.table_schema = 'public' AND c.table_name = adlar.t AND c.column_name = 'company_id'
       ) AS company_id_var_mi
FROM (VALUES
        ('orders'), ('appointments'), ('customers'),
        ('payments'), ('supplier_transactions'), ('supplier_payments'),
        ('companies'), ('profiles'), ('company_members'),
        ('support_tickets'), ('audit_logs')
     ) AS adlar(t)
ORDER BY 1;

-- 4) (İsteğe bağlı) Var olan iş tablolarının kolonlarını gör —
--    müdahale formundaki alan adlarını doğrulamak için.
--    İlgilendiğin tablo adını yazıp tek tek çalıştırabilirsin:
-- SELECT column_name, data_type
-- FROM information_schema.columns
-- WHERE table_schema = 'public' AND table_name = 'orders'   -- <-- tablo adını değiştir
-- ORDER BY ordinal_position;
