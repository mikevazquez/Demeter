-- REVIEW PROPOSAL ONLY. Not wired into workflows; not applied remotely.
-- Requires separate authorization and verified project/connection identity.
-- No password, login capability, business grants, memberships or destructive SQL.
BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'postgres' THEN
    RAISE EXCEPTION 'Reader proposal requires the verified postgres database';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'sf_gov_schema_reader') THEN
    RAISE EXCEPTION 'Reader already exists; inspect instead of altering or adopting it';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace n
    JOIN LATERAL pg_catalog.aclexplode(coalesce(n.nspacl,pg_catalog.acldefault('n',n.nspowner))) a ON true
    WHERE n.nspname NOT IN ('pg_catalog','information_schema')
      AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
      AND a.grantee=0 AND (a.privilege_type='CREATE' OR
        (a.privilege_type='USAGE' AND (
          EXISTS (SELECT 1 FROM pg_catalog.pg_class c
            JOIN LATERAL pg_catalog.aclexplode(coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))) ca ON true
            WHERE c.relnamespace=n.oid AND c.relkind IN ('r','p','v','m','f') AND ca.grantee=0)
          OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
            JOIN LATERAL pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) pa ON true
            WHERE p.pronamespace=n.oid AND p.prosecdef AND pa.grantee=0 AND pa.privilege_type='EXECUTE')
        )))
  ) THEN
    RAISE EXCEPTION 'PUBLIC grants exceed reader contract; no role created';
  END IF;
END
$guard$;
CREATE ROLE sf_gov_schema_reader NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS NOINHERIT CONNECTION LIMIT 2;
ALTER ROLE sf_gov_schema_reader SET default_transaction_read_only = on;
ALTER ROLE sf_gov_schema_reader SET statement_timeout = '15s';
ALTER ROLE sf_gov_schema_reader SET search_path = pg_catalog;
GRANT CONNECT ON DATABASE postgres TO sf_gov_schema_reader;
COMMIT;
