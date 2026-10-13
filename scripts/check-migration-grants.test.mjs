import assert from "node:assert/strict";
import { test } from "node:test";

import { inspectMigrationGrants } from "./check-migration-grants.mjs";

const unsafe = (sql) => inspectMigrationGrants(sql);

test("rejects TRUNCATE to anon", () => {
  assert.equal(unsafe("GRANT TRUNCATE ON TABLE public.students TO anon;").length, 1);
});

test("rejects dangerous privileges mixed with DML", () => {
  const issues = unsafe(
    "GRANT SELECT, TRIGGER, REFERENCES ON TABLE public.students TO authenticated;",
  );
  assert.deepEqual(issues[0].privileges, ["trigger", "references"]);
});

test("rejects ALL on all tables for client roles", () => {
  assert.equal(unsafe("GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon;").length, 1);
});

test("rejects dangerous ALTER DEFAULT PRIVILEGES", () => {
  assert.equal(
    unsafe(
      "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;",
    ).length,
    1,
  );
});

test("rejects PUBLIC and quoted role grants", () => {
  assert.equal(unsafe('GRANT MAINTAIN ON TABLE public.students TO PUBLIC, "anon";').length, 1);
});

test("rejects multiline grants and identifies line", () => {
  const issues = unsafe(
    "-- safe\n\nGRANT\n  TRUNCATE\n  ON TABLE public.students\n  TO authenticated;",
  );
  assert.equal(issues.length, 1);
  assert.equal(issues[0].line, 3);
});

test("allows normal DML with RLS", () => {
  assert.deepEqual(
    unsafe("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.students TO authenticated;"),
    [],
  );
});

test("allows privileged service_role grants", () => {
  assert.deepEqual(
    unsafe("GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;"),
    [],
  );
});

test("allows function grants, not table grants", () => {
  assert.deepEqual(unsafe("GRANT ALL ON FUNCTION public.fn() TO authenticated;"), []);
});

test("ignores commented-out dangerous grants", () => {
  assert.deepEqual(
    unsafe(
      "-- GRANT TRUNCATE ON TABLE public.students TO anon;\n/* GRANT ALL ON TABLE public.students TO anon; */",
    ),
    [],
  );
});

test("accepts read-only anon table grants", () => {
  assert.deepEqual(unsafe("GRANT SELECT ON TABLE public.disciplines TO anon;"), []);
});

test("rejects the original F14 historical ACL pattern if modified", () => {
  const issues = unsafe(
    "REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;\nGRANT REFERENCES, TRIGGER, TRUNCATE ON TABLE public.payments TO anon;",
  );
  assert.equal(issues.length, 1);
  assert.deepEqual(issues[0].privileges, ["references", "trigger", "truncate"]);
});
