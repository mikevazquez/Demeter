import test from "node:test";
import assert from "node:assert/strict";
import { admitCodexRequest, certifyCodexCandidate, proposeCodexDraft } from "../../scripts/governance-codex-intake.mjs";

const policy = { approved: true, version: "synthetic-v1", product: "Studio Flow", expired: false };
const request = {
  id: "synthetic-intake-001",
  product: "Studio Flow",
  owner: "codex-1",
  baseSha: "immutable-test-sha",
  allowedPaths: ["tests/automation/fixtures/synthetic.mjs"],
};

test("synthetic Codex intake admits scoped request and produces a draft-only proposal", () => {
  const contract = admitCodexRequest(request, policy);
  assert.equal(contract.state, "admitted");
  assert.equal(contract.execution, "synthetic-only");
  const candidate = {
    sha: "certified-sha",
    fingerprint: contract.fingerprint,
    changedPaths: [...contract.allowedPaths],
    testsPassed: true,
    independentVerification: true,
  };
  const certified = certifyCodexCandidate(contract, candidate);
  assert.equal(certified.state, "certified");
  const proposed = proposeCodexDraft(contract, certified);
  assert.equal(proposed.state, "draft-proposed");
  assert.equal(proposed.productionAuthorized, false);
  assert.equal(proposed.mergeAuthorized, false);
  assert.equal(proposeCodexDraft(contract, certified, [{
    id: contract.id, fingerprint: contract.fingerprint, pr: 123,
  }]).state, "existing");
});

test("stale authority, other product and external effects are rejected", () => {
  assert.equal(admitCodexRequest(request, { ...policy, expired: true }).reason, "policy");
  assert.equal(admitCodexRequest({ ...request, product: "Finance Core" }, policy).reason, "product-boundary");
  assert.equal(admitCodexRequest({ ...request, productionAuthorized: true }, policy).reason, "external-effects");
  assert.equal(admitCodexRequest({ ...request, externalEffects: true }, policy).reason, "external-effects");
});

test("path traversal, wrong artifact, missing independent verification and task conflicts are rejected", () => {
  assert.equal(admitCodexRequest({ ...request, allowedPaths: ["tests/automation/fixtures/../prod.mjs"] }, policy).reason, "scope");
  assert.equal(admitCodexRequest({ ...request, allowedPaths: ["src/prod.ts"] }, policy).reason, "scope");
  const contract = admitCodexRequest(request, policy);
  assert.equal(certifyCodexCandidate(contract, {
    sha: "sha", fingerprint: contract.fingerprint,
    changedPaths: ["src/prod.ts"], testsPassed: true, independentVerification: true,
  }).reason, "scope");
  assert.equal(certifyCodexCandidate(contract, {
    sha: "sha", fingerprint: contract.fingerprint,
    changedPaths: [...contract.allowedPaths], testsPassed: true, independentVerification: false,
  }).reason, "tests");
  assert.equal(admitCodexRequest({ ...request, owner: "different" }, policy, [{
    id: request.id, fingerprint: contract.fingerprint, pr: 123,
  }]).reason, "id-conflict");
});
