import test from "node:test";
import assert from "node:assert/strict";
import { buildReviewedIntake } from "../../scripts/governance-codex-queue-adapter.mjs";
import { validateConfig } from "../../scripts/codex-coordinator.mjs";
import { previewCoordinatorAdmission } from "../../scripts/governance-codex-bridge.mjs";

const policy = { approved: true, version: "synthetic-v1", product: "Studio Flow", expired: false };
const request = {
  id: "synthetic-codex-queue-001", product: "Studio Flow", owner: "codex-1",
  baseSha: "immutable-sha", allowedPaths: ["tests/automation/fixtures/demo.mjs"],
};
const fingerprint = previewCoordinatorAdmission(request, policy).fingerprint;
const evidence = {
  issueNumber: 1001, issueBodySha256: "a".repeat(64),
  issueUpdatedAt: "2026-10-15T00:00:00Z", issueApproved: true,
  policyVersion: policy.version, requestFingerprint: fingerprint,
  issueTaskId: request.id, checks: [["node", "--test", "tests/automation/fixtures/demo.mjs"]],
  requiredText: ["SYNTHETIC-CODEX-QUEUE"],
};
const source = {
  pageId: "3fad78f7146381e9a97fc3c454e6516a",
  capturedAt: "2026-10-15T12:00:00Z",
  expiresAt: "2026-10-17T12:00:00Z",
};
const now = Date.parse("2026-10-16T00:00:00Z");
const base = {
  version: 1, repository: "mikevazquez/Demeter",
  controlBranch: "chore/governance-autonomous-coordinator-20261015",
  maxTasksPerRun: 1, source,
};

test("reviewed intake matches existing coordinator queue validation", () => {
  const staged = buildReviewedIntake(request, policy, evidence);
  assert.equal(staged.state, "review-required");
  assert.equal(staged.enqueuePerformed, false);
  assert.equal(staged.dispatchPerformed, false);
  const task = staged.manifest.tasks[0].task;
  assert.equal(validateConfig({ ...base, tasks: [task], intake: staged.manifest }, now).tasks[0].id, request.id);
});

test("coordinator rejects manifest missing matching queue task", () => {
  const staged = buildReviewedIntake(request, policy, evidence);
  assert.throws(() => validateConfig({ ...base, tasks: [], intake: staged.manifest }, now), /not bound/);
});

test("coordinator rejects unapproved intake and changed issue digest", () => {
  const staged = buildReviewedIntake(request, policy, evidence);
  const task = staged.manifest.tasks[0].task;
  const rejected = structuredClone(staged.manifest);
  rejected.tasks[0].state = "pending";
  assert.throws(() => validateConfig({ ...base, tasks: [task], intake: rejected }, now), /Unapproved/);
  assert.throws(() => validateConfig({
    ...base, tasks: [{ ...task, issueBodySha256: "b".repeat(64) }], intake: staged.manifest,
  }, now), /not bound/);
});
