-- SF-GOV-001 / INV-UAT-01: read-only negative control for Candidate ONLY.
-- Injects a synthetic catalog row in the SELECT result. Never creates a DB object.
-- This tests the detector but does NOT replace a physical DDL/rollback UAT.
-- No tenant records, credentials, or source definitions are returned.
-- Save each result as a JSON array and compare with scripts/check-schema-drift.mjs.
-- Fingerprints are screening signals; inspect differences by object before release.
WITH objects AS (
  SELECT 'column'::text AS kind, c.relname || '.' || a.attname AS object_name,
    concat_ws('|', a.attnum, pg_catalog.format_type(a.atttypid, a.atttypmod),
      a.attnotnull, a.attidentity, a.attgenerated,
      coalesce(pg_get_expr(d.adbin, d.adrelid), '')) AS definition
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  UNION ALL
  SELECT 'table_rls', c.relname,
    concat_ws('|', c.relkind, c.relrowsecurity, c.relforcerowsecurity)
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  UNION ALL
  SELECT 'policy', tablename || '.' || policyname,
    concat_ws('|', permissive, roles::text, cmd, coalesce(qual, ''),
      coalesce(with_check, ''))
  FROM pg_policies WHERE schemaname = 'public'
  UNION ALL
  SELECT 'routine', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
    pg_get_functiondef(p.oid)
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'index', tablename || '.' || indexname, indexdef
  FROM pg_indexes WHERE schemaname = 'public'
  UNION ALL
  SELECT 'trigger', c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid)
  FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
  UNION ALL
  SELECT 'view', viewname, definition
  FROM pg_views WHERE schemaname = 'public'
  UNION ALL
  SELECT 'extension', extname, extversion FROM pg_extension
)
SELECT kind, count(*)::int AS object_count,
  md5(string_agg(object_name || chr(31) || md5(definition),
    chr(30) ORDER BY object_name)) AS fingerprint
FROM (
  SELECT * FROM objects
  UNION ALL
  SELECT 'column'::text, '__sf_gov_001_readonly_negative_probe'::text,
    'synthetic_definition_only'::text
) AS audited_objects GROUP BY kind ORDER BY kind;
