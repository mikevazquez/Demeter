import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

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
const report = ["column", "extension", "index", "policy", "routine", "table_rls", "trigger"].map(
  (kind, i) => ({
    kind,
    object_count: i + 1,
    fingerprint: String(i).repeat(32),
  }),
);

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
      candidate_sha: candidate,
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
      candidate_sha: candidate,
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
    {
      case_id: "GOV-UAT-01",
      result: "passed",
      evidence_url: m.references.pr,
      candidate_sha: candidate,
    },
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
    {
      case_id: "GOV-UAT-01",
      result: "passed",
      evidence_url: m.references.pr,
      candidate_sha: candidate,
    },
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

function twoStageManifest() {
  const m = draft();
  m.target = "production-staged";
  m.sandbox_candidate_run = "synthetic-candidate-run";
  m.uat_case_ids = ["GOV-UAT-01", "PIL-UAT-01", "DOC-UAT-01"];
  m.uat_evidence = [
    {
      case_id: "GOV-UAT-01",
      result: "passed",
      evidence_url: m.references.pr,
      candidate_sha: candidate,
    },
    ...["PIL-UAT-01", "DOC-UAT-01"].map((case_id) => ({
      case_id,
      result: "pending",
      phases: {
        predeployment: {
          result: "passed",
          evidence_url: m.references.pr,
          candidate_sha: candidate,
        },
        postdeployment: { result: "pending" },
      },
    })),
  ];
  return m;
}

function schemaOptions() {
  return {
    checkedOutSha: candidate,
    schemaAttestation: attestation(),
    schemaAttestationKey: schemaKey,
    now,
  };
}

test("GOV-COM-02 permits only prevalidated PIL/DOC to await closure without marking passed", () => {
  const m = twoStageManifest();
  assert.deepEqual(validateReleaseManifest(m, schemaOptions()), []);
  assert.deepEqual(
    m.uat_evidence.slice(1).map((item) => item.result),
    ["pending", "pending"],
  );
  assert.match(
    validateReleaseManifest(m, { ...schemaOptions(), uatPhase: "closure" }).join(";"),
    /closure requires/,
  );
});

test("GOV-COM-02 refuses missing, failed, blocked, stale-SHA or unlinked predeployment proof", () => {
  for (const patch of [
    undefined,
    { result: "pending" },
    { result: "failed" },
    { result: "blocked" },
    { result: "passed", evidence_url: "https://example.com/fake", candidate_sha: candidate },
    { result: "passed", evidence_url: draft().references.pr, candidate_sha: baseline },
  ]) {
    const m = twoStageManifest();
    m.uat_evidence[1].phases.predeployment = patch;
    assert.ok(validateReleaseManifest(m, schemaOptions()).length > 0);
  }
});

test("GOV-COM-02 does not exempt other cases or projects", () => {
  const m = twoStageManifest();
  m.uat_evidence[0].result = "pending";
  assert.ok(validateReleaseManifest(m, schemaOptions()).length > 0);
  const other = twoStageManifest();
  other.change_id = "SF-OTHER-001";
  assert.match(validateReleaseManifest(other, schemaOptions()).join(";"), /limited to/);
});

test("GOV-COM-02 refuses failed or blocked postdeployment and premature global approval", () => {
  for (const result of ["failed", "blocked", "passed"]) {
    const m = twoStageManifest();
    m.uat_evidence[1].phases.postdeployment.result = result;
    assert.ok(validateReleaseManifest(m, schemaOptions()).length > 0);
  }
  const m = twoStageManifest();
  m.uat_evidence[1].result = "passed";
  m.uat_evidence[1].evidence_url = m.references.pr;
  assert.match(validateReleaseManifest(m, schemaOptions()).join(";"), /both stages/);
});

test("GOV-COM-02 closure accepts both complete stages and refuses wrong postdeployment SHA", () => {
  const m = twoStageManifest();
  for (const item of m.uat_evidence.slice(1)) {
    item.result = "passed";
    item.evidence_url = m.references.pr;
    item.phases.postdeployment = { ...item.phases.predeployment };
  }
  assert.deepEqual(validateReleaseManifest(m, { ...schemaOptions(), uatPhase: "closure" }), []);
  m.uat_evidence[2].phases.postdeployment.candidate_sha = baseline;
  assert.match(
    validateReleaseManifest(m, { ...schemaOptions(), uatPhase: "closure" }).join(";"),
    /both stages/,
  );
});

test("GOV-COM-02 preserves schema attestation and SHA gates", () => {
  const m = twoStageManifest();
  assert.match(
    validateReleaseManifest(m, { checkedOutSha: candidate }).join(";"),
    /schema_attestation/,
  );
  assert.match(
    validateReleaseManifest(m, { ...schemaOptions(), checkedOutSha: baseline }).join(";"),
    /SHA/,
  );
  assert.match(
    validateReleaseManifest(m, { ...schemaOptions(), uatPhase: "skip" }).join(";"),
    /Unknown UAT phase/,
  );
});

test("malformed UAT evidence is rejected without crashing the gate", () => {
  const m = twoStageManifest();
  m.uat_evidence = [null];
  assert.ok(validateReleaseManifest(m, schemaOptions()).length > 0);
  m.uat_evidence = {};
  assert.ok(validateReleaseManifest(m, schemaOptions()).length > 0);
});

test("passed ordinary UAT refuses missing, malformed and stale candidate SHA in both phases", () => {
  for (const candidate_sha of [undefined, null, "main", "1".repeat(39), "f".repeat(40)]) {
    for (const target of ["sandbox-candidate", "production-staged"]) {
      for (const uatPhase of ["predeployment", "closure"]) {
        const m = draft();
        m.target = target;
        m.sandbox_candidate_run = "synthetic-candidate-run";
        m.uat_evidence = [
          { case_id: "GOV-UAT-01", result: "passed", evidence_url: m.references.pr, candidate_sha },
        ];
        assert.match(
          validateReleaseManifest(m, { ...schemaOptions(), uatPhase }).join(";"),
          /GOV-UAT-01 passed UAT evidence must match manifest candidate_sha/,
        );
      }
    }
  }
});

test("every ordinary passed case must bind its own evidence to the candidate", () => {
  const m = twoStageManifest();
  m.uat_case_ids.push("REL-UAT-02");
  m.uat_evidence.push({
    case_id: "REL-UAT-02",
    result: "passed",
    evidence_url: m.references.pr,
    candidate_sha: baseline,
  });
  assert.match(
    validateReleaseManifest(m, schemaOptions()).join(";"),
    /REL-UAT-02 passed UAT evidence/,
  );
  m.uat_evidence.at(-1).candidate_sha = candidate;
  assert.deepEqual(validateReleaseManifest(m, schemaOptions()), []);
});

test("evidence SHA comparison accepts hex case without weakening immutable SHA validation", () => {
  const m = draft();
  m.candidate_sha = "a".repeat(40);
  m.uat_evidence = [
    {
      case_id: "GOV-UAT-01",
      result: "passed",
      evidence_url: m.references.pr,
      candidate_sha: "A".repeat(40),
    },
  ];
  assert.deepEqual(validateReleaseManifest(m, { checkedOutSha: m.candidate_sha }), []);
});

test("CLI fails stale or absent evidence SHA and accepts a matching Sandbox declaration", () => {
  const dir = mkdtempSync(join(tmpdir(), "sf-gov-evidence-"));
  try {
    const file = join(dir, "manifest.json");
    const m = draft();
    m.uat_evidence = [{ case_id: "GOV-UAT-01", result: "passed", evidence_url: m.references.pr }];
    for (const candidate_sha of [undefined, baseline, candidate]) {
      m.uat_evidence[0].candidate_sha = candidate_sha;
      writeFileSync(file, JSON.stringify(m));
      const result = spawnSync(
        process.execPath,
        [new URL("./validate-release-manifest.mjs", import.meta.url).pathname, file, candidate],
        { encoding: "utf8", env: {} },
      );
      assert.equal(result.status, candidate_sha === candidate ? 0 : 1);
      if (candidate_sha === candidate) assert.match(result.stdout, /release approval not implied/);
      else assert.match(result.stderr, /passed UAT evidence must match manifest candidate_sha/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
