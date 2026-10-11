-- Migration 025 SONRASI DOGRULAMA — SALT OKUNUR. Tek hucre doner.
SELECT string_agg(satir, E'\n' ORDER BY sira, satir) AS sonuc FROM (
  SELECT 1 AS sira, 'toplam korunan tablo = ' || count(*) || '  [beklenen: 37]' AS satir
  FROM pg_trigger t WHERE t.tgname = 'trg_subscription_write_guard' AND NOT t.tgisinternal AND t.tgenabled <> 'D'
  UNION ALL
  SELECT 2, c.relname || ' -> ' || p.proname
         || ' | baglantilar=' || coalesce(nullif(rtrim(replace(encode(t.tgargs, 'escape'), '\000', ' '), ' '), ''), 'yalnizca company_id')
         || ' | I/U/D=' || ((t.tgtype & 4) = 4)::text || '/' || ((t.tgtype & 16) = 16)::text || '/' || ((t.tgtype & 8) = 8)::text
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_proc p ON p.oid = t.tgfoid
  WHERE t.tgname = 'trg_subscription_write_guard' AND NOT t.tgisinternal
    AND c.relname IN ('accounts','appointment_assignees','catalog_collections','catalog_items',
                      'expense_categories','income_categories','installer_payments','supplier_work_orders')
  UNION ALL
  SELECT 3, 'KORUMASIZ hedef tablo: ' || x.n
  FROM unnest(ARRAY['accounts','appointment_assignees','catalog_collections','catalog_items',
                    'expense_categories','income_categories','installer_payments','supplier_work_orders']) AS x(n)
  WHERE NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                    WHERE t.tgrelid = to_regclass('public.' || x.n) AND t.tgname = 'trg_subscription_write_guard'
                      AND p.proname = 'enforce_company_subscription_write_linked')
  UNION ALL
  SELECT 4, 'cozumleyici fonksiyon anon/authenticated tarafindan cagrilabilir mi = '
         || coalesce(has_function_privilege('anon', 'public.guard_resolve_row_company(text,jsonb,text[],boolean)', 'EXECUTE')::text, 'yok') || '/'
         || coalesce(has_function_privilege('authenticated', 'public.guard_resolve_row_company(text,jsonb,text[],boolean)', 'EXECUTE')::text, 'yok')
         || '  [beklenen: false/false]'
  UNION ALL
  SELECT 5, 'isletmesiz satir: installer_payments=' || (SELECT count(*) FROM public.installer_payments WHERE company_id IS NULL)
         || ' supplier_work_orders=' || (SELECT count(*) FROM public.supplier_work_orders WHERE company_id IS NULL) || '  [beklenen: 0/0]'
) s;
