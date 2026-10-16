-- REVIEW PROPOSAL ONLY: one scoped production schema-ACL change, not applied.
-- Requires separate authorization. Does not revoke table/function ACLs globally.
-- Known callers already have explicit USAGE. Unknown clients remain an impact risk.
BEGIN;
DO $guard$
DECLARE name text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='sf_gov_schema_reader') THEN
    RAISE EXCEPTION 'Reader already exists; re-audit before changing shared ACL';
  END IF;
  -- An explicit USAGE grant is not ownership. A non-owner REVOKE may warn and
  -- leave another grantor's PUBLIC grant intact; reject before attempting it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace n
    WHERE n.nspname='net' AND pg_catalog.pg_has_role(current_user,n.nspowner,'USAGE')
  ) THEN
    RAISE EXCEPTION 'Net schema owner authority unavailable; no ACL change attempted';
  END IF;
  IF current_database() <> 'postgres' OR
     NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname='pg_net' AND extversion='0.20.4') THEN
    RAISE EXCEPTION 'Unexpected production database/extension; re-audit';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace n
    JOIN LATERAL pg_catalog.aclexplode(n.nspacl) a ON true
    WHERE n.nspname='net' AND pg_catalog.pg_get_userbyid(n.nspowner)='supabase_admin'
      AND a.grantee=0 AND a.privilege_type='USAGE'
  ) THEN
    RAISE EXCEPTION 'Unexpected net schema ACL; re-audit';
  END IF;
  FOREACH name IN ARRAY ARRAY['postgres','supabase_functions_admin','anon','authenticated','service_role'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_namespace n
      JOIN LATERAL pg_catalog.aclexplode(n.nspacl) a ON true
      JOIN pg_catalog.pg_roles r ON r.oid=a.grantee
      WHERE n.nspname='net' AND r.rolname=name AND a.privilege_type='USAGE'
    ) THEN
      RAISE EXCEPTION 'Required explicit net USAGE grant missing; no change';
    END IF;
  END LOOP;
END
$guard$;
REVOKE USAGE ON SCHEMA net FROM PUBLIC;
COMMIT;
