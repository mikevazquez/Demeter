import assert from "node:assert/strict";
import { test } from "node:test";

import { validateReleaseManifest } from "./validate-release-manifest.mjs";
import {
  SCHEMA_CANDIDATE_REF,
  SCHEMA_PRODUCTION_REF,
  signSchemaPayload,
} from "./verify-schema-attestation.mjs";

const baseline = "0".repeat(40);
const candidate = "1".repeat(40);
const schemaKey = "test-only-schema-key-".repeat(3);
const now = new Date("2026-10-13T18:00:00.000Z");
const report = [
  "column",
  "extension",
  "index",
  "policy",
  "routine",
  "table_rls",
  "trigger",
].map((kind, i) => ({
  kind,
  object_count: i + 1,
  fingerprint: String(i).repeat(32),
}));

function attestation() {
  const payload = {
    version: 1,
    source: "supabase-readonly",
    baseline_ref: SCHEMA_PRODUCTION_REF,
    candidate_ref: SCHEMA_CANDIDATE_REF,
    candidate_sha: candidate,
    captured_at: "2026-10-13T17:50:00.000Z",
    baseline: structuredClone(report),
    candidate: structuredClone(report),
  };
  return { ...payload, signature: signSchemaPayload(payload, schemaKey) };
}


function draft() {
  return {
    change_id: "SF-GOV-001",
    baseline_sha: baseline,
    candidate_sha: candidate,
    target: "sandbox-candidate",
    modules: ["governance"],
    uat_case_ids: ["GOV-UAT-01"],
    migrations: [],
    edge_functions: [],
    impact: "Docs and CI only",
    rollback_plan: "Drop the unpublished branch",
    references: {
      pr: "https://github.com/mikevazquez/Demeter/pull/276",
      notion: "https://app.notion.com/p/3f8d78f7146381e49f16cc31a235f575",
    },
    uat_evidence: [{ case_id: "GOV-UAT-01", result: "pending" }],
  };
}

test("accepts pending UAT for a Sandbox draft", () => {
  assert.deepEqual(validateReleaseManifest(draft()), []);
});

test("rejects missing UAT cases and rollback plan", () => {
  const m = draft();
  m.uat_case_ids = [];
  m.rollback_plan = "";
  assert.ok(validateReleaseManifest(m).length >= 2);
});

test("rejects duplicate UAT cases", () => {
  const m = draft();
  m.uat_case_ids.push("GOV-UAT-01");
  assert.match(validateReleaseManifest(m).join(";"), /uat_case_ids/);
});

test("blocks production staging with pending UAT", () => {
  const m = draft();
  m.target = "production-staged";
  m.sandbox_candidate_run = "candidate #45";
  assert.match(validateReleaseManifest(m).join(";"), /passing evidence/);
});

test("blocks wrong candidate commit", () => {
  assert.match(
    validateReleaseManifest(draft(), { checkedOutSha: baseline }).join(";"),
    /checked-out SHA/,
  );
});

test("validates a complete candidate without granting release approval", () => {
  const m = draft();
  m.target = "production-staged";
  m.sandbox_candidate_run = "candidate #45";
  m.uat_evidence = [
    {
      case_id: "GOV-UAT-01",
      result: "passed",
      evidence_url: m.references.pr,
    },
  ];
  assert.deepEqual(
    validateReleaseManifest(m, {
      checkedOutSha: candidate,
      schemaAttestation: attestation(),
      schemaAttestationKey: schemaKey,
      now,
    }),
    [],
  );
});

test("rejects secret property names", () => {
  const m = draft();
  m.payment_api_token = "DO-NOT-STORE";
  assert.match(validateReleaseManifest(m).join(";"), /secrets/);
});

test("rejects untrusted evidence URLs", () => {
  const m = draft();
  m.target = "production-staged";
  m.sandbox_candidate_run = "candidate #45";
  m.uat_evidence = [
    {
      case_id: "GOV-UAT-01",
      result: "passed",
      evidence_url: "https://example.com/fake",
    },
  ];
  assert.match(validateReleaseManifest(m).join(";"), /uat_evidence/);
});

test("requires migration checksums", () => {
  const m = draft();
  m.migrations = [{ path: "supabase/migrations/20261012120000_add.sql" }];
  assert.match(validateReleaseManifest(m).join(";"), /migrations/);
});

test("rejects nonimmutable commit references", () => {
  const m = draft();
  m.candidate_sha = "main";
  assert.match(validateReleaseManifest(m).join(";"), /candidate_sha/);
});

test("rejects evidence for unlisted cases", () => {
  const m = draft();
  m.uat_evidence.push({ case_id: "UNLISTED-UAT", result: "pending" });
  assert.match(validateReleaseManifest(m).join(";"), /unlisted/);
});

test("rejects missing manifest", () => {
  assert.deepEqual(validateReleaseManifest(null), ["Expected a manifest JSON object"]);
});

test("blocks production staging without protected schema attestation", () => {
  const m = draft();
  m.target = "production-staged";
  m.sandbox_candidate_run = "candidate #45";
  m.uat_evidence = [
    { case_id: "GOV-UAT-01", result: "passed", evidence_url: m.references.pr },
  ];
  assert.match(
    validateReleaseManifest(m, { checkedOutSha: candidate }).join("; "),
    /schema_attestation/,
  );
});

test("blocks production staging with tampered signed schema evidence", () => {
  const m = draft();
  m.target = "production-staged";
  m.sandbox_candidate_run = "candidate #45";
  m.uat_evidence = [
    { case_id: "GOV-UAT-01", result: "passed", evidence_url: m.references.pr },
  ];
  const forged = attestation();
  forged.candidate[0].fingerprint = "f".repeat(32);
  assert.match(
    validateReleaseManifest(m, {
      checkedOutSha: candidate,
      schemaAttestation: forged,
      schemaAttestationKey: schemaKey,
      now,
    }).join("; "),
    /signature verification failed/,
  );
});
