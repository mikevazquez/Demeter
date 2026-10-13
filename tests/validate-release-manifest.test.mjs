import assert from "node:assert/strict";
import { test } from "node:test";

import { validateReleaseManifest } from "../scripts/validate-release-manifest.mjs";

const baseline = "0".repeat(40);
const candidate = "1".repeat(40);

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
...[truncated]