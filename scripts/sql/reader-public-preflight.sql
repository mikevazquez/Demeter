-- SELECT-only forecast for a new role with no memberships or explicit grants.
-- Does not authenticate as the reader or replace post-creation verification.
WITH schema_acl AS (
 SELECT n.oid,n.nspname,coalesce(bool_or(a.privilege_type='USAGE') FILTER (WHERE a.grantee=0),false) AS public_usage,
 coalesce(bool_or(a.privilege_type='CREATE') FILTER (WHERE a.grantee=0),false) AS public_create
 FROM pg_catalog.pg_namespace n LEFT JOIN LATERAL pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a ON true
 WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
 GROUP BY n.oid,n.nspname
), accessible_relations AS (
 SELECT count(DISTINCT c.oid)::int AS count FROM pg_catalog.pg_class c JOIN schema_acl s ON s.oid=c.relnamespace AND s.public_usage
 JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) a ON a.grantee=0
 WHERE c.relkind IN ('r','p','v','m','f')
), accessible_definers AS (
 SELECT count(DISTINCT p.oid)::int AS count FROM pg_catalog.pg_proc p JOIN schema_acl s ON s.oid=p.pronamespace AND s.public_usage
 JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a ON a.grantee=0 AND a.privilege_type='EXECUTE'
 WHERE p.prosecdef
), db_acl AS (
 SELECT array_agg(a.privilege_type ORDER BY a.privilege_type) AS public_privileges
 FROM pg_catalog.pg_database d JOIN LATERAL pg_catalog.aclexplode(coalesce(d.datacl,pg_catalog.acldefault('d',d.datdba))) a ON a.grantee=0
 WHERE d.datname=current_database()
)
SELECT json_build_object('database',current_database(),'reader_exists',EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='sf_gov_schema_reader'),
 'public_relation_access',(SELECT count FROM accessible_relations),'public_definer_access',(SELECT count FROM accessible_definers),
 'public_schema_create',(SELECT coalesce(json_agg(nspname ORDER BY nspname) FILTER (WHERE public_create),'[]'::json) FROM schema_acl),
 'public_database_privileges',(SELECT public_privileges FROM db_acl)) AS reader_preflight;
