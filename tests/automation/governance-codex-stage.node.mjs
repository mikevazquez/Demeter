import test from "node:test";
import assert from "node:assert/strict";
import { previewCoordinatorAdmission } from "../../scripts/governance-codex-bridge.mjs";
import { stageCoordinatorTask } from "../../scripts/governance-codex-stage.mjs";

const policy = { approved: true, version: "synthetic-v1", product: "Studio Flow", expired: false };
const request = { id: "synthetic-bridge-001", product: "Studio Flow", owner: "codex-1", baseSha: "base-sha", allowedPaths: ["tests/automation/fixtures/demo.mjs"] };
const fingerprint = previewCoordinatorAdmission(request, policy).fingerprint;
const evidence = {
  issueNumber: 1001,
  issueBodySha256: "a".repeat(64),
  issueUpdatedAt: "2026-10-15T00:00:00Z",
  issueApproved: true,
  policyVersion: policy.version,
  requestFingerprint: fingerprint,
  issueTaskId: request.id,
  checks: [["node", "--test", "tests/automation/fixtures/demo.mjs"]],
  requiredText: ["SYNTHETIC-ONLY"],
};

test("issue-bound synthetic task stages without execution or queue mutation", () => {
  const result = stageCoordinatorTask(request, policy, evidence);
  assert.equal(result.state, "staged");
  assert.equal(result.task.status, "pending-review");
  assert.equal(result.task.issueNumber, 1001);
  assert.equal(result.codexExecutionTriggered, false);
  assert.equal(result.productionAuthorized, false);
  assert.equal(result.requiresQueueReview, true);
});

test("rejects unapproved, stale, conflicting or unverifiable issue evidence", () => {
  assert.equal(stageCoordinatorTask(request, policy, { ...evidence, issueApproved: false }).reason, "issue-evidence");
  assert.equal(stageCoordinatorTask(request, policy, { ...evidence, issueBodySha256: "wrong" }).reason, "issue-evidence");
  assert.equal(stageCoordinatorTask(request, policy, { ...evidence, requestFingerprint: "tampered" }).reason, "evidence-mismatch");
  assert.equal(stageCoordinatorTask(request, policy, { ...evidence, checks: [] }).reason, "checks");
  assert.equal(stageCoordinatorTask(request, policy, { ...evidence, existingCoordinatorTask: true }).reason, "already-admitted");
  assert.equal(stageCoordinatorTask(request, { ...policy, expired: true }, evidence).reason, "policy");
});
