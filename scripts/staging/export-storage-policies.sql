-- URETIMDE salt okunur calistirin; cikti, test projesinde Storage politikalarini kurmak icin CREATE POLICY ifadeleridir.
--   npx supabase db query --linked -f scripts\staging\export-storage-policies.sql
-- (Bucket tanimlari ve politikalar 'storage' semasindadir; pg_dump --schema=public bunlari kapsamaz.)
select format('create policy %I on storage.objects as %s for %s to %s %s %s;',
  policyname,
  case when permissive = 'PERMISSIVE' then 'permissive' else 'restrictive' end,
  cmd,
  array_to_string(roles, ', '),
  case when qual is not null then 'using (' || qual || ')' else '' end,
  case when with_check is not null then 'with check (' || with_check || ')' else '' end) as ddl
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;
