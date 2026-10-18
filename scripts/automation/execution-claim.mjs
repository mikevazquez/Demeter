// Trusted supervisor only: persistent per-task consumption, never a queue or publisher.
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const REPOSITORY = "mikevazquez/Demeter";
const PREFIX = `repos/${REPOSITORY}/git`;
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
export function githubRequest(method, endpoint, body) {
  const args = ["api", "--method", method, endpoint];
  if (body !== undefined) args.push("--input", "-");
  const result = spawnSync("gh", args, {
    encoding: "utf8",
    input: body === undefined ? undefined : JSON.stringify(body),
    timeout: 30000,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const error = new Error("GitHub execution authority unavailable; do not generate");
    error.httpStatus = Number(result.stderr?.match(/HTTP (\d{3})/)?.[1]) || null;
    throw error;
  }
  return JSON.parse(result.stdout);
}

// A matching prior claim still consumes the attempt; it never authorizes regeneration.
export function claimExecution(task, { request = githubRequest, nonce = randomUUID() } = {}) {
  assert(/^[a-z0-9][a-z0-9-]{2,79}$/.test(task?.id ?? ""), "Invalid claim task ID");
  assert(/^[a-f0-9]{40}$/.test(task.baseSha ?? ""), "Immutable claim base required");
  assert(/^[a-f0-9]{64}$/.test(task.contractSha256 ?? ""), "Claim contract hash required");
  assert(
    task.authorization === `https://github.com/${REPOSITORY}/issues/318`,
    "Claim authorization required",
  );
  assert(/^[a-zA-Z0-9-]{3,80}$/.test(nonce), "Invalid claim owner nonce");
  const name = `tags/vianelis/execution-claims/${task.id}`;
  const ref = `refs/${name}`;
  try {
    const prior = request("GET", `${PREFIX}/ref/${name}`);
    assert(
      prior?.ref === ref && /^[a-f0-9]{40}$/.test(prior.object?.sha ?? ""),
      "Invalid existing execution claim",
    );
    return { status: "consumed", id: task.id, ref, objectSha: prior.object.sha };
  } catch (error) {
    // Only an explicit remote 404 establishes absence. No local fallback.
    if (error.httpStatus !== 404) throw error;
  }
  // Historical PRs also consume their IDs, even if closed or created before this guard.
  const head = encodeURIComponent(`mikevazquez:studio-flow/minimal/${task.id}`);
  const prs = request("GET", `repos/${REPOSITORY}/pulls?state=all&head=${head}&per_page=1`);
  assert(Array.isArray(prs), "Complete PR lookup required");
  if (prs.length) return { status: "consumed", id: task.id, ref, reason: "existing-pull-request" };
  const record = {
    schema: "vianelis-execution-claim-v1",
    id: task.id,
    baseSha: task.baseSha,
    contractSha256: task.contractSha256,
    authorization: task.authorization,
    ownerNonce: nonce,
  };
  // Creating an unreachable annotated tag does not acquire ownership. Ref creation is atomic.
  const tag = request("POST", `${PREFIX}/tags`, {
    tag: `vianelis-execution-${task.id}`,
    message: JSON.stringify(record),
    object: task.baseSha,
    type: "commit",
  });
  assert(/^[a-f0-9]{40}$/.test(tag?.sha ?? ""), "Invalid remote claim object");
  try {
    const created = request("POST", `${PREFIX}/refs`, { ref, sha: tag.sha });
    assert(
      created?.ref === ref && created.object?.sha === tag.sha,
      "Unacknowledged execution claim",
    );
  } catch (error) {
    // A conflict or lost response is consumed/uncertain, including our own accepted write.
    // Never adopt an existing owner or delete a ref to retry.
    throw new Error(
      "Remote execution claim not acknowledged; inspect existing owner, never regenerate",
      { cause: error },
    );
  }
  const observed = request("GET", `${PREFIX}/ref/${name}`);
  assert(
    observed?.ref === ref && observed.object?.sha === tag.sha,
    "Execution authority changed; do not generate",
  );
  return { status: "acquired", ...record, ref, objectSha: tag.sha };
}
