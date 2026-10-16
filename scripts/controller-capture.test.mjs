import assert from "node:assert/strict";
import test from "node:test";
import {
  captureAttestation,
  captureProject,
  connectionEnvironment,
} from "./capture-schema-attestation.mjs";
import { REQUIRED_SCHEMA_KINDS } from "./certify-schema-parity.mjs";
import {
  SCHEMA_PRODUCTION_REF as PROD,
  SCHEMA_CANDIDATE_REF as CAND,
} from "./verify-schema-attestation.mjs";

const host = "aws-0-us-east-1.pooler.supabase.com";
const session = (ref) =>
  `postgresql://sf_gov_schema_reader.${ref}:fake-password@${host}:5432/postgres`;
const direct = (ref) =>
  `postgresql://sf_gov_schema_reader:fake-password@db.${ref}.supabase.co:5432/postgres`;
const rows = REQUIRED_SCHEMA_KINDS.map((kind) => ({
  kind,
  object_count: 0,
  fingerprint: "a".repeat(32),
}));
const role = {
  role: "sf_gov_schema_reader",
  safe: true,
  memberships: 0,
  data_access: 0,
  definer_access: 0,
  readonly: "on",
  database: "postgres",
};
const response = (identity = role, data = rows) => ({
  status: 0,
  stdout: JSON.stringify(identity) + "\n" + JSON.stringify(data) + "\n",
});
const config = {
  candidateSha: "a".repeat(40),
  productionConnection: session(PROD),
  candidateConnection: session(CAND),
  key: "fake-signing-key-".repeat(4),
};

test("both projects accept only their fixed Session identity with TLS hostname verification", () => {
  for (const ref of [PROD, CAND]) {
    const env = connectionEnvironment(session(ref), ref);
    assert.equal(env.PGHOST, host);
    assert.equal(env.PGPORT, "5432");
    assert.equal(env.PGUSER, `sf_gov_schema_reader.${ref}`);
    assert.equal(env.PGSSLMODE, "verify-full");
    assert.equal(env.PGSSLROOTCERT, "system");
    assert.match(env.PGOPTIONS, /default_transaction_read_only=on/);
  }
});

test("direct dedicated-reader endpoints retain their existing contract", () => {
  for (const ref of [PROD, CAND]) {
    assert.equal(
      connectionEnvironment(direct(ref), ref).PGUSER,
      "sf_gov_schema_reader",
    );
  }
});

test("cross-project identities, privileged roles, transaction poolers and connection injection are denied before either connection", () => {
  const invalid = [
    session(PROD),
    session(CAND).replace(CAND, "unknownproject"),
    session(CAND).replace(`sf_gov_schema_reader.${CAND}`, "postgres"),
    session(CAND).replace("sf_gov_schema_reader", "postgres"),
    session(CAND).replace(`.${CAND}:`, ":"),
    session(CAND).replace("5432", "6543"),
    session(CAND).replace("aws-0-us-east-1", "aws-0-us-west-1"),
    session(CAND).replace(host, host + ".attacker.invalid"),
    session(CAND).replace("postgresql:", "http:"),
    session(CAND).replace("/postgres", "/other"),
    session(CAND).replace("fake-password", ""),
    session(CAND) + "?sslmode=disable",
    session(CAND) + "#ignored",
    direct(CAND).replace(
      "sf_gov_schema_reader",
      `sf_gov_schema_reader.${CAND}`,
    ),
  ];
  for (const candidateConnection of invalid) {
    assert.throws(() =>
      captureAttestation({ ...config, candidateConnection }, () =>
        assert.fail("must not connect"),
      ),
    );
  }
  assert.throws(() => connectionEnvironment(session(CAND), "unknownproject"));
});

test("Session routing keeps database current_user unqualified and child environment isolated", () => {
  let calls = 0;
  captureAttestation(config, (exe, args, options) => {
    assert.equal(exe, "/usr/bin/psql");
    assert.equal(
      options.env.PGUSER,
      `sf_gov_schema_reader.${[PROD, CAND][calls++]}`,
    );
    assert.equal(options.env.SF_GOV_SCHEMA_ATTESTATION_KEY, undefined);
    assert.equal(options.env.PGSERVICE, undefined);
    assert.equal(options.env.HOME, undefined);
    assert.equal(args.join(" ").includes("fake-password"), false);
    assert.match(options.input, /REPEATABLE READ READ ONLY/);
    return response();
  });
  assert.equal(calls, 2);
});

test("pooler does not bypass the database reader privilege checks", () => {
  for (const unsafe of [
    { role: "postgres" },
    { role: `sf_gov_schema_reader.${CAND}` },
    { safe: false },
    { memberships: 1 },
    { data_access: 1 },
    { definer_access: 1 },
    { readonly: "off" },
    { database: "other" },
  ]) {
    assert.throws(
      () =>
        captureProject(session(CAND), CAND, () =>
          response({ ...role, ...unsafe }),
        ),
      /identity or privilege/,
    );
  }
});

test("schema drift, missing categories and client failure still refuse certification without leaking credentials", () => {
  let calls = 0;
  assert.throws(
    () =>
      captureAttestation(config, () =>
        response(
          role,
          calls++
            ? rows.map((row, i) => (i ? row : { ...row, object_count: 1 }))
            : rows,
        ),
      ),
    /parity denied/,
  );
  assert.throws(
    () =>
      captureProject(session(CAND), CAND, () => response(role, rows.slice(1))),
    /categories/,
  );
  assert.throws(
    () =>
      captureProject(session(CAND), CAND, () => ({
        status: 1,
        stderr: "fake-password",
      })),
    { message: "Read-only schema capture failed" },
  );
});
