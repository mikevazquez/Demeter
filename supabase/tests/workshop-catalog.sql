-- Read-only, metadata-only signature for comparing historical replay with Sandbox.
with tables as (
  select c.oid, n.nspname as schema_name, c.relname, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname in ('public','private') and left(c.relname,9)='workshop_' and c.relkind='r'
)
select jsonb_build_object(
'tables',(select jsonb_agg(jsonb_build_object(
  'schema',t.schema_name,'name',t.relname,'rls',t.relrowsecurity,
  'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'required',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid)) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=t.oid and a.attnum>0 and not a.attisdropped),
  'constraints',(select jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(oid)) order by conname) from pg_constraint where conrelid=t.oid),
  'grants',(select jsonb_object_agg(r,jsonb_build_object('select',has_table_privilege(r,t.oid,'SELECT'),'insert',has_table_privilege(r,t.oid,'INSERT'),'update',has_table_privilege(r,t.oid,'UPDATE'),'delete',has_table_privilege(r,t.oid,'DELETE'))) from (values ('anon'),('authenticated'),('service_role')) roles(r))
) order by t.schema_name,t.relname) from tables t),
'indexes',(select jsonb_agg(jsonb_build_object('schema',schemaname,'name',indexname,'definition',indexdef) order by schemaname,indexname) from pg_indexes where schemaname in ('public','private') and left(tablename,9)='workshop_'),
'policies',(select coalesce(jsonb_agg(jsonb_build_object('schema',schemaname,'name',policyname,'command',cmd,'using',qual,'check',with_check) order by schemaname,tablename,policyname),'[]'::jsonb) from pg_policies where schemaname in ('public','private') and left(tablename,9)='workshop_'),
'triggers',(select jsonb_agg(pg_get_triggerdef(t.oid) order by t.tgname) from pg_trigger t where t.tgrelid in (select oid from tables) and not t.tgisinternal),
'functions',(select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,'arguments',pg_get_function_identity_arguments(p.oid),'body_md5',md5(p.prosrc),'definer',p.prosecdef,'settings',p.proconfig,'grants',(select jsonb_object_agg(r,has_function_privilege(r,p.oid,'EXECUTE')) from (values ('anon'),('authenticated'),('service_role')) roles(r))) order by n.nspname,p.proname) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and (left(p.proname,9)='workshop_' or p.proname in ('admin_confirm_workshop_payment','guard_workshop_payment_authorization')))
) as catalog;
