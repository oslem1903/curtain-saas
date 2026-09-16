-- READ ONLY: run in Supabase SQL Editor, share the single JSON result.
select jsonb_build_object(
 'functions', (select jsonb_agg(jsonb_build_object('name', x.name, 'exists', to_regprocedure(x.signature) is not null))
 from (values
 ('company_delete','public.super_admin_delete_company(uuid,text)'),
 ('error_reporting','public.report_client_error(text,text,text,text)'),
 ('intervention','public.super_admin_apply_intervention(uuid,text,uuid,jsonb,text,uuid)'),
 ('revert','public.super_admin_revert_intervention(uuid)'),
 ('observability','public.get_super_admin_observability()'),
 ('activity','public.record_login()')
 ) as x(name,signature)),
 'error_columns',(select jsonb_agg(column_name) from information_schema.columns where table_schema='public' and table_name='error_logs'),
 'company_delete_policies',(select coalesce(jsonb_agg(jsonb_build_object('policy',policyname,'command',cmd,'roles',roles,'using',qual)), '[]'::jsonb) from pg_policies where schemaname='public' and tablename='companies' and cmd in ('DELETE','ALL')),
 'company_foreign_keys',(select jsonb_agg(jsonb_build_object('table',conrelid::regclass::text,'definition',pg_get_constraintdef(oid))) from pg_constraint where contype='f' and confrelid='public.companies'::regclass),
 'intervention_revert_conflict_guard',coalesce((select position('IS DISTINCT FROM' in pg_get_functiondef(oid))>0 from pg_proc where oid=to_regprocedure('public.super_admin_revert_intervention(uuid)')),false)
) as verification;
