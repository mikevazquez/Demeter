import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function admit(request, policy, existing = []) {
  if (!policy?.approved || !policy.version || policy.expired)
    return { state: "blocked", reason: "policy" };
  if (
    !request?.id ||
    !request.product ||
    !request.owner ||
    !request.baseSha ||
    !request.allowedPaths?.length
  )
    return { state: "blocked", reason: "contract" };
  if (request.product !== policy.product) return { state: "blocked", reason: "product-boundary" };
  if (
    request.allowedPaths.some(
      (p) => !p.startsWith("tests/automation/fixtures/") || p.includes(".."),
    )
  )
    return { state: "blocked", reason: "scope" };
  const previous = existing.find((x) => x.id === request.id);
  if (previous) return { state: "existing", pr: previous.pr, sha: previous.sha };
  return {
    state: "admitted",
    id: request.id,
    fingerprint: digest({
      id: request.id,
      product: request.product,
      baseSha: request.baseSha,
      allowedPaths: request.allowedPaths,
    }),
  };
}

function execute(contract, attempts) {
  if (contract.state !== "admitted") return { state: "blocked" };
  const journal = [];
  for (const result of attempts.slice(0, 2)) {
    journal.push({ attempt: journal.length + 1, pass: result.pass, paths: result.paths });
    if (result.paths.some((p) => !p.startsWith("tests/automation/fixtures/")))
      return { state: "blocked", reason: "scope", journal };
    if (result.pass) return { state: "candidate", sha: digest(result), journal };
  }
  return { state: "failed", journal };
}

function certify(candidate, independentSha) {
  return candidate.state === "candidate" && candidate.sha === independentSha
    ? { state: "certified", sha: candidate.sha }
    : { state: "rejected" };
}

function publish(certified, existing, taskId) {
  if (certified.state !== "certified") return { state: "blocked" };
  const prior = existing.find((x) => x.id === taskId);
  return prior
    ? { state: "existing", pr: prior.pr }
    : { state: "draft-proposed", id: taskId, sha: certified.sha };
}

const policy = { approved: true, version: "synthetic-v1", product: "Studio Flow", expired: false };
const request = {
  id: "synthetic-001",
  product: "Studio Flow",
  owner: "codex-1",
  baseSha: "test-sha",
  allowedPaths: ["tests/automation/fixtures/demo.mjs"],
};

test("synthetic end-to-end: admission, failed first attempt, repair, independent certification and draft proposal", () => {
  const admitted = admit(request, policy);
  assert.equal(admitted.state, "admitted");
  const result = execute(admitted, [
    { pass: false, paths: request.allowedPaths },
    { pass: true, paths: request.allowedPaths },
  ]);
  assert.equal(result.state, "candidate");
  assert.deepEqual(
    result.journal.map((x) => x.pass),
    [false, true],
  );
  const certified = certify(result, result.sha);
  assert.equal(certified.state, "certified");
  assert.equal(publish(certified, [], request.id).state, "draft-proposed");
  assert.equal(
    publish(certified, [{ id: request.id, pr: 999, sha: result.sha }], request.id).state,
    "existing",
  );
});

test("reject stale policy, cross-product access and expanded scope", () => {
  assert.equal(admit(request, { ...policy, expired: true }).state, "blocked");
  assert.equal(admit({ ...request, product: "Finance Core" }, policy).reason, "product-boundary");
  assert.equal(admit({ ...request, allowedPaths: ["src/payment.ts"] }, policy).reason, "scope");
});

test("fail closed on scope escalation and certification mismatch", () => {
  const admitted = admit(request, policy);
  assert.equal(execute(admitted, [{ pass: true, paths: ["src/production.ts"] }]).state, "blocked");
  const candidate = execute(admitted, [{ pass: true, paths: request.allowedPaths }]);
  assert.equal(certify(candidate, "tampered").state, "rejected");
  assert.equal(publish({ state: "rejected" }, [], request.id).state, "blocked");
});

test("resume with existing task does not regenerate or republish", () => {
  const previous = [{ id: request.id, pr: 999, sha: "existing-sha" }];
  const resumed = admit(request, policy, previous);
  assert.equal(resumed.state, "existing");
  assert.equal(resumed.pr, 999);
  assert.equal(execute(resumed, []).state, "blocked");
});
