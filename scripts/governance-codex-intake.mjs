import { createHash } from "node:crypto";

const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const ROOT = "tests/automation/fixtures/";
const validPath = (path) =>
  typeof path === "string" &&
  path.startsWith(ROOT) &&
  !path.includes("..") &&
  !path.includes("\\") &&
  !path.includes("//") &&
  !path.startsWith("/") &&
  !path.endsWith("/");

export function admitCodexRequest(request, policy, existing = []) {
  if (!policy || policy.approved !== true || !policy.version || policy.expired === true)
    return { state: "blocked", reason: "policy" };
  if (!request || !request.id || !request.product || !request.owner || !request.baseSha ||
      !Array.isArray(request.allowedPaths) || request.allowedPaths.length === 0)
    return { state: "blocked", reason: "contract" };
  if (request.product !== policy.product)
    return { state: "blocked", reason: "product-boundary" };
  if (request.allowedPaths.some((path) => !validPath(path)))
    return { state: "blocked", reason: "scope" };
  if (request.productionAuthorized === true || request.externalEffects === true)
    return { state: "blocked", reason: "external-effects" };
  const fingerprint = hash({
    id: request.id, product: request.product, owner: request.owner,
    baseSha: request.baseSha, allowedPaths: [...request.allowedPaths].sort(),
    policyVersion: policy.version,
  });
  const prior = existing.find((item) => item.id === request.id);
  if (prior) return prior.fingerprint === fingerprint
    ? { state: "existing", pr: prior.pr, sha: prior.sha, fingerprint }
    : { state: "blocked", reason: "id-conflict" };
  return {
    state: "admitted",
    id: request.id,
    product: request.product,
    owner: request.owner,
    baseSha: request.baseSha,
    allowedPaths: [...request.allowedPaths],
    fingerprint,
    execution: "synthetic-only",
    publication: "draft-only",
  };
}

export function certifyCodexCandidate(contract, candidate) {
  if (contract?.state !== "admitted" || !candidate || !candidate.sha ||
      candidate.fingerprint !== contract.fingerprint)
    return { state: "rejected", reason: "provenance" };
  if (!Array.isArray(candidate.changedPaths) || candidate.changedPaths.length === 0 ||
      candidate.changedPaths.some((path) => !contract.allowedPaths.includes(path)))
    return { state: "rejected", reason: "scope" };
  if (candidate.testsPassed !== true || candidate.independentVerification !== true)
    return { state: "rejected", reason: "tests" };
  return { state: "certified", sha: candidate.sha, fingerprint: contract.fingerprint };
}

export function proposeCodexDraft(contract, certified, existing = []) {
  if (contract?.state !== "admitted" || certified?.state !== "certified" ||
      certified.fingerprint !== contract.fingerprint)
    return { state: "blocked", reason: "certification" };
  const prior = existing.find((item) => item.id === contract.id);
  if (prior) return prior.fingerprint === contract.fingerprint
    ? { state: "existing", pr: prior.pr }
    : { state: "blocked", reason: "id-conflict" };
  return {
    state: "draft-proposed",
    taskId: contract.id,
    branch: "automation/codex/" + contract.id,
    sha: certified.sha,
    mergeAuthorized: false,
    productionAuthorized: false,
  };
}
