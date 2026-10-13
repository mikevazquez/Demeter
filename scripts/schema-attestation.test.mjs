import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  SCHEMA_CANDIDATE_REF,
  SCHEMA_PRODUCTION_REF,
  signSchemaPayload,
  verifySchemaAttestation,
} from "./verify-schema-attestation.mjs";

const fixture = (name) =>
  JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../docs/sf-gov-001/schema-audit/" + name, import.meta.url)),
      "utf8",
    ),
  );
const baseline = fixture("2026-10-13-production.json");
const candidate = fixture("2026-10-13-candidate.json");
const key = "test-only-not-a-real-secret-".repeat(3);
const sha = "a".repeat(40);
const now = new Date("2026-10-13T18:00:00.000Z");

function evidence(left = baseline, right = baseline) {
  const payload = {
    version: 1,
    source: "supabase-readonly",
    baseline_ref: SCHEMA_PRODUCTION_REF,
    candidate_ref: SCHEMA_CANDIDATE_REF,
    candidate_sha: sha,
    captured_at: "2026-10-13T17:50:00.000Z",
    baseline: structuredClone(left),
    candidate: structuredClone(right),
  };
  return { ...payload, signature: signSchemaPayload(payload, key) };
}

test("valid signed, fresh and equivalent evidence passes cryptographic gate", () => {
  assert.deepEqual(
    verifySchemaAttestation(evidence(), { key, checkedOutSha: sha, now }),
    [],
  );
});

test("real Candidate drift remains blocked even with a valid signature", () => {
  assert.match(
    verifySchemaAttestation(evidence(baseline, candidate), {
      key,
      checkedOutSha: sha,
      now,
    }).join("; "),
    /Schema parity denied/,
  );
});

test("rejects tampering after signing", () => {
  const attestation = evidence();
  attestation.candidate[0].fingerprint = "f".repeat(32);
  assert.match(
    verifySchemaAttestation(attestation, { key, checkedOutSha: sha, now }).join("; "),
    /signature verification failed/,
  );
});

test("rejects expired or future-dated evidence", () => {
  assert.match(
    verifySchemaAttestation(evidence(), {
      key,
      checkedOutSha: sha,
      now: new Date("2026-10-13T20:00:00.000Z"),
    }).join("; "),
    /stale/,
  );
  assert.match(
    verifySchemaAttestation(evidence(), {
      key,
      checkedOutSha: sha,
      now: new Date("2026-10-13T17:00:00.000Z"),
    }).join("; "),
    /future-dated/,
  );
});

test("rejects mismatched commit and project identity", () => {
  assert.match(
    verifySchemaAttestation(evidence(), { key, checkedOutSha: "b".repeat(40), now }).join(
      "; ",
    ),
    /candidate SHA/,
  );
  const changed = evidence();
  changed.candidate_ref = "incorrect-project";
  assert.match(
    verifySchemaAttestation(changed, { key, checkedOutSha: sha, now }).join("; "),
    /project reference/,
  );
});

test("rejects unsigned evidence and missing protected key", () => {
  const unsigned = evidence();
  delete unsigned.signature;
  assert.match(
    verifySchemaAttestation(unsigned, { key, checkedOutSha: sha, now }).join("; "),
    /signature/,
  );
  assert.match(
    verifySchemaAttestation(evidence(), { checkedOutSha: sha, now }).join("; "),
    /key is unavailable/,
  );
});

test("rejects incomplete categories even when the evidence is signed", () => {
  const attestation = evidence(baseline.slice(1), baseline.slice(1));
  assert.match(
    verifySchemaAttestation(attestation, { key, checkedOutSha: sha, now }).join("; "),
    /incomplete or invalid/,
  );
});

test("signatures are stable when object properties are reordered", () => {
  const a = evidence();
  const { signature, ...payload } = a;
  const reversed = Object.fromEntries(Object.entries(payload).reverse());
  assert.equal(signature, signSchemaPayload(reversed, key));
});
