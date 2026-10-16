import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { captureReleaseGate } from "./capture-release-gate.mjs";

import {
  CAPTURE_SQL,
  captureAttestation,
  captureProject,
  connectionEnvironment,
} from "./capture-schema-attestation.mjs";
import {
  SCHEMA_PRODUCTION_REF as PROD,
  SCHEMA_CANDIDATE_REF as CAND,
  verifySchemaAttestation,
} from "./verify-schema-attestation.mjs";

const rows = JSON.parse(
  readFileSync(
    new URL("../docs/sf-gov-001/schema-audit/2026-10-13-production.json", import.meta.url),
  ),
);
const drift = JSON.parse(
  readFileSync(
    new URL("../docs/sf-gov-001/schema-audit/2026-10-13-candidate.json", import.meta.url),
  ),
);
const connection = (ref) =>
  `postgresql://sf_gov_schema_reader:fake-test-password@db.${ref}.supabase.co:5432/postgres`;
const config = {
  candidateSha: "a".repeat(40),
  productionConnection: connection(PROD),
  candidateConnection: connection(CAND),
  key: "fake-test-signing-key-".repeat(3),
};
const role = {
  role: "sf_gov_schema_reader",
  safe: true,
  memberships: 0,
  data_access: 0,
  definer_access: 0,
  readonly: "on",
  database: "postgres",
};
const response = (data = rows, identity = role) => ({
  status: 0,
  stdout: JSON.stringify(identity) + "\n" + JSON.stringify(data) + "\n",
});

test("capture signs direct results with exact SHA; child never receives signing key or ambient environment", () => {
  const calls = [];
  const evidence = captureAttestation(config, (exe, args, options) => {
    calls.push(options.env.PGHOST);
    assert.equal(exe, "/usr/bin/psql");
    assert.ok(args.includes("ON_ERROR_STOP=1"));
    assert.ok(args.includes("-X"));
    assert.equal(options.input, CAPTURE_SQL);
    assert.equal(options.env.PGSSLMODE, "verify-full");
    assert.equal(options.env.SF_GOV_SCHEMA_ATTESTATION_KEY, undefined);
    assert.equal(options.env.PGSERVICE, undefined);
    assert.equal(args.join(" ").includes("fake-test-password"), false);
    return response();
  });
  assert.deepEqual(calls, [`db.${PROD}.supabase.co`, `db.${CAND}.supabase.co`]);
  assert.deepEqual(
    verifySchemaAttestation(evidence, { key: config.key, checkedOutSha: config.candidateSha }),
    [],
  );
});

test("capture rejects wrong endpoints, privileged user, injected options and invalid SHA before connection", () => {
  const invalid = [
    connection(PROD),
    connection(CAND).replace("sf_gov_schema_reader", "postgres"),
    connection(CAND) + "?sslmode=disable",
    connection(CAND).replace("5432", "6543"),
    connection(CAND).replace("supabase.co", "supabase.co.attacker.invalid"),
  ];
  for (const candidateConnection of invalid) {
    assert.throws(() =>
      captureAttestation({ ...config, candidateConnection }, () => assert.fail("must not connect")),
    );
  }
  assert.throws(() =>
    captureAttestation({ ...config, candidateSha: "main" }, () => assert.fail("must not connect")),
  );
  assert.throws(() =>
    captureAttestation({ ...config, key: "short" }, () => assert.fail("must not connect")),
  );
});

test("capture refuses real seven-category drift without issuing a signature", () => {
  let count = 0;
  assert.throws(
    () => captureAttestation(config, () => response(count++ === 0 ? rows : drift)),
    /parity denied/,
  );
});

test("capture refuses unsafe role, inherited membership, writable transaction and malformed or missing metadata", () => {
  for (const identity of [
    { ...role, safe: false },
    { ...role, memberships: 1 },
    { ...role, data_access: 1 },
    { ...role, definer_access: 1 },
    { ...role, readonly: "off" },
    { ...role, role: "postgres" },
    null,
  ]) {
    assert.throws(
      () => captureProject(connection(PROD), PROD, () => response(rows, identity)),
      /identity or privilege/,
    );
  }
  assert.throws(
    () => captureProject(connection(PROD), PROD, () => response(rows.slice(1))),
    /categories/,
  );
  assert.throws(
    () => captureProject(connection(PROD), PROD, () => ({ status: 0, stdout: "bad-json" })),
    /Invalid schema capture/,
  );
});

test("client errors are sanitized and never expose the password", () => {
  assert.throws(
    () =>
      captureProject(connection(PROD), PROD, () => ({
        status: 1,
        stderr: "fake-test-password",
        error: new Error("fake-test-password"),
      })),
    { message: "Read-only schema capture failed" },
  );
  assert.throws(() => connectionEnvironment("bad connection secret", PROD), {
    message: "Invalid capture connection configuration",
  });
});

test("release preflight requires captured parity, passing UAT and the exact candidate SHA", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../docs/sf-gov-001/release-manifest.example.json", import.meta.url)),
  );
  manifest.target = "production-staged";
  manifest.candidate_sha = config.candidateSha;
  manifest.sandbox_candidate_run = "isolated-test-only";
  assert.throws(
    () => captureReleaseGate(manifest, config, () => response()),
    /Release gate denied/,
  );
  manifest.uat_evidence[0] = {
    case_id: "GOV-UAT-01",
    result: "passed",
    evidence_url: "https://github.com/mikevazquez/Demeter/actions/runs/1",
    candidate_sha: config.candidateSha,
  };
  assert.equal(
    captureReleaseGate(manifest, config, () => response()).candidate_sha,
    config.candidateSha,
  );
  assert.throws(
    () =>
      captureReleaseGate({ ...manifest, candidate_sha: "b".repeat(40) }, config, () =>
        assert.fail("must not connect"),
      ),
    /SHA mismatch/,
  );
  assert.throws(
    () =>
      captureReleaseGate({ ...manifest, target: "sandbox-candidate" }, config, () =>
        assert.fail("must not connect"),
      ),
    /production-staged/,
  );
  let count = 0;
  assert.throws(
    () => captureReleaseGate(manifest, config, () => response(count++ === 0 ? rows : drift)),
    /parity denied/,
  );
});

test("fixed capture SQL executes catalog-only in isolated PostgreSQL and rolls back", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  try {
    const result = await db.exec(CAPTURE_SQL);
    const sets = result.filter((r) => r.rows.length);
    assert.equal(sets.length, 2);
    assert.equal(sets[0].rows[0].json_build_object.readonly, "on");
    assert.equal(sets[0].rows[0].json_build_object.safe, false); // local superuser is not an approved reader
    const state = await db.query("SHOW transaction_read_only");
    assert.equal(state.rows[0].transaction_read_only, "off");
  } finally {
    await db.close();
  }
});

test("catalog audit detects PUBLIC definer execution and explicit table access for a real isolated reader role", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  try {
    await db.exec(`CREATE ROLE sf_gov_schema_reader NOLOGIN NOSUPERUSER NOBYPASSRLS;
      CREATE TABLE public.capture_acl_probe(id int);
      CREATE FUNCTION public.capture_acl_function() RETURNS int LANGUAGE sql SECURITY DEFINER AS 'SELECT 1';
      GRANT USAGE ON SCHEMA public TO sf_gov_schema_reader;
      SET ROLE sf_gov_schema_reader;`);
    let results = await db.exec(CAPTURE_SQL);
    let identity = results.find((r) => r.rows[0]?.json_build_object)?.rows[0].json_build_object;
    assert.equal(identity.safe, true);
    assert.equal(identity.data_access, 0);
    assert.equal(identity.definer_access, 1);
    await db.exec(`RESET ROLE;
      REVOKE EXECUTE ON FUNCTION public.capture_acl_function() FROM PUBLIC;
      GRANT SELECT ON public.capture_acl_probe TO sf_gov_schema_reader;
      SET ROLE sf_gov_schema_reader;`);
    results = await db.exec(CAPTURE_SQL);
    identity = results.find((r) => r.rows[0]?.json_build_object)?.rows[0].json_build_object;
    assert.equal(identity.data_access, 1);
    assert.equal(identity.definer_access, 0);
  } finally {
    await db.close();
  }
});
