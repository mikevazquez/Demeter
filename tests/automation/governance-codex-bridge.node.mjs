import test from "node:test";
import assert from "node:assert/strict";
import { previewCoordinatorAdmission } from "../../scripts/governance-codex-bridge.mjs";

const policy = { approved: true, version: "synthetic-v1", product: "Studio Flow", expired: false };
const request = {
  id: "synthetic-codex-bridge-001",
  product: "Studio Flow",
  owner: "codex-1",
  baseSha: "immutable-test-sha",
  allowedPaths: ["tests/automation/fixtures/synthetic.mjs"],
};

test("bridge maps admitted synthetic request to pending coordinator queue contract without dispatch", () => {
  const result = previewCoordinatorAdmission(request, policy);
  assert.equal(result.state, "preview");
  assert.equal(result.task.status, "pending-admission");
  assert.equal(result.task.kind, "code");
  assert.equal(result.task.issueNumber, null);
  assert.equal(result.requiresExplicitQueueAdmission, true);
  assert.equal(result.codexExecutionTriggered, false);
  assert.equal(result.productionAuthorized, false);
});

test("bridge does not bypass policy, product boundary or duplicate work", () => {
  assert.equal(previewCoordinatorAdmission(request, { ...policy, expired: true }).reason, "policy");
  assert.equal(previewCoordinatorAdmission({ ...request, product: "Finance Core" }, policy).reason, "product-boundary");
  const admitted = previewCoordinatorAdmission(request, policy);
  const prior = [{ id: request.id, fingerprint: admitted.fingerprint, pr: 555, sha: "known" }];
  assert.equal(previewCoordinatorAdmission(request, policy, prior).state, "existing");
  assert.equal(previewCoordinatorAdmission({ ...request, owner: "another" }, policy, prior).reason, "id-conflict");
});
