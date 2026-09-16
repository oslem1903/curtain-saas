begin;
-- Firma adları görünen etikettir; aynı isimli birden fazla müşteri hesabına izin ver.
do $$
declare r record;
begin
  for r in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public' and t.relname = 'companies' and c.contype = 'u'
      and (select count(*) from unnest(c.conkey) k where k = (select attnum from pg_attribute where attrelid=t.oid and attname='name')) = 1
  loop
    execute format('alter table public.companies drop constraint if exists %I', r.conname);
  end loop;
end $$;
do $$
declare r record;
begin
  for r in
    select i.indexrelid::regclass as index_name
    from pg_index i
    join pg_class t on t.oid=i.indrelid
    join pg_namespace n on n.oid=t.relnamespace
    where n.nspname='public' and t.relname='companies' and i.indisunique
      and i.indnatts=1 and i.indkey[0]=(select attnum from pg_attribute where attrelid=t.oid and attname='name')
  loop
    execute format('drop index if exists %s', r.index_name);
  end loop;
end $$;
commit;
