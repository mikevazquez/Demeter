// Trusted supervisor metadata only. Never restores a lock, starts Codex or publishes a PR.
import { createHash } from "node:crypto";
import { githubRequest, verifyExecutionOwner } from "./execution-claim.mjs";

const API = "repos/mikevazquez/Demeter/git";
const AUTHORIZATION = "https://github.com/mikevazquez/Demeter/issues/318";
const SCHEMA = "governance2-execution-checkpoint-v1";
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function validateTask(task, contractSha256) {
  assert(/^[a-z0-9][a-z0-9-]{2,79}$/.test(task?.id ?? ""), "Invalid checkpoint ID");
  assert(/^[a-f0-9]{40}$/.test(task.baseSha ?? ""), "Immutable checkpoint base required");
  assert(/^[a-f0-9]{64}$/.test(contractSha256 ?? ""), "Checkpoint contract hash required");
  assert(task.authorization === AUTHORIZATION, "Checkpoint authorization required");
  assert(hash(task) === contractSha256, "Checkpoint contract changed");
  const keys = ["id", "goal", "authorization", "baseSha", "allowedPaths", "checks", "continuity"];
  assert(
    Object.keys(task).every((key) => keys.includes(key)),
    "Unexpected checkpoint task field",
  );
  assert(typeof task.goal === "string" && task.goal.trim(), "Checkpoint goal required");
  assert(
    Array.isArray(task.allowedPaths) &&
      task.allowedPaths.length > 0 &&
      new Set(task.allowedPaths).size === task.allowedPaths.length &&
      task.allowedPaths.every(
        (p) =>
          typeof p === "string" &&
          /^[A-Za-z0-9_./-]+$/.test(p) &&
          !p.startsWith("/") &&
          !p.split("/").some((part) => ["", ".", "..", ".git"].includes(part)),
      ),
    "Unsafe checkpoint paths",
  );
  assert(
    Array.isArray(task.checks) &&
      task.checks.length > 0 &&
      task.checks.every(
        (argv) =>
          Array.isArray(argv) &&
          argv.length > 0 &&
          argv.every((value) => typeof value === "string"),
      ),
    "Reviewed checkpoint checks required",
  );
  return { id: task.id, baseSha: task.baseSha, contractSha256, authorization: AUTHORIZATION };
}
function validateIntent(intent, task) {
  if (intent === null) return;
  assert(
    intent?.id === task.id &&
      intent.baseSha === task.baseSha &&
      intent.contractSha256 === task.contractSha256 &&
      intent.mode === "supervised-cli" &&
      typeof intent.startedAt === "string" &&
      Number.isFinite(Date.parse(intent.startedAt)),
    "Invalid checkpoint execution intent",
  );
}

// Immutable pre-spawn snapshot. A recorded intent does not prove that Codex started or finished.
export function writeExecutionCheckpoint(
  { task, contractSha256 },
  owner,
  intent = null,
  { request = githubRequest } = {},
) {
  const identity = validateTask(task, contractSha256);
  validateIntent(intent, identity);
  const verified = verifyExecutionOwner(identity, owner, { request });
  const record = {
    schema: SCHEMA,
    ...identity,
    task,
    owner: { status: "acquired", ...verified, ref: owner.ref, objectSha: owner.objectSha },
    intent:
      intent === null
        ? null
        : {
            id: intent.id,
            contractSha256,
            baseSha: intent.baseSha,
            startedAt: intent.startedAt,
            mode: intent.mode,
          },
  };
  const message = JSON.stringify(record);
  assert(Buffer.byteLength(message) <= 32768, "Checkpoint metadata exceeds limit");
  const name = `tags/vianelis/execution-checkpoints/${task.id}`;
  let priorRef;
  try {
    priorRef = request("GET", `${API}/ref/${name}`);
  } catch (error) {
    if (error.httpStatus !== 404) throw error;
  }
  if (priorRef !== undefined) {
    const prior = readExecutionCheckpoint(task.id, identity, { request });
    assert(
      priorRef.object?.sha === prior.objectSha && JSON.stringify(prior.checkpoint) === message,
      "Existing checkpoint differs; do not replace",
    );
    return { status: "recorded", ref: `refs/${name}`, objectSha: prior.objectSha };
  }
  const tag = request("POST", `${API}/tags`, {
    tag: `governance2-checkpoint-${task.id}`,
    message,
    object: task.baseSha,
    type: "commit",
  });
  assert(/^[a-f0-9]{40}$/.test(tag?.sha ?? ""), "Invalid checkpoint object");
  // Recheck owner before publishing the immutable reference. Never move or delete it.
  verifyExecutionOwner(identity, owner, { request });
  try {
    const ref = request("POST", `${API}/refs`, { ref: `refs/${name}`, sha: tag.sha });
    assert(
      ref?.ref === `refs/${name}` && ref.object?.sha === tag.sha,
      "Checkpoint not acknowledged",
    );
  } catch (error) {
    throw new Error("Checkpoint creation uncertain; inspect remotely, never regenerate", {
      cause: error,
    });
  }
  const observed = readExecutionCheckpoint(task.id, identity, { request });
  assert(
    observed.objectSha === tag.sha && JSON.stringify(observed.checkpoint) === message,
    "Checkpoint readback changed; do not execute",
  );
  return { status: "recorded", ref: `refs/${name}`, objectSha: tag.sha };
}

// GET-only inspection needs no local reservation, checkout, authentication store or active.json.
export function readExecutionCheckpoint(id, expected, { request = githubRequest } = {}) {
  assert(/^[a-z0-9][a-z0-9-]{2,79}$/.test(id ?? ""), "Invalid checkpoint ID");
  assert(
    /^[a-f0-9]{40}$/.test(expected?.baseSha ?? "") &&
      /^[a-f0-9]{64}$/.test(expected?.contractSha256 ?? ""),
    "Expected immutable identity required",
  );
  const name = `tags/vianelis/execution-checkpoints/${id}`;
  const ref = request("GET", `${API}/ref/${name}`);
  assert(
    ref?.ref === `refs/${name}` &&
      ref.object?.type === "tag" &&
      /^[a-f0-9]{40}$/.test(ref.object?.sha ?? ""),
    "Invalid checkpoint reference",
  );
  const tag = request("GET", `${API}/tags/${ref.object.sha}`);
  assert(
    tag?.sha === ref.object.sha &&
      tag.object?.type === "commit" &&
      tag.object.sha === expected.baseSha &&
      typeof tag.message === "string" &&
      Buffer.byteLength(tag.message) <= 32768,
    "Invalid checkpoint base or metadata",
  );
  const record = JSON.parse(tag.message);
  assert(
    record.schema === SCHEMA &&
      record.id === id &&
      record.baseSha === expected.baseSha &&
      record.contractSha256 === expected.contractSha256 &&
      record.authorization === AUTHORIZATION,
    "Checkpoint identity mismatch",
  );
  const identity = validateTask(record.task, record.contractSha256);
  assert(identity.id === id && identity.baseSha === expected.baseSha, "Checkpoint task mismatch");
  validateIntent(record.intent, identity);
  verifyExecutionOwner(identity, record.owner, { request });
  return {
    id,
    status: record.intent === null ? "reserved" : "uncertain",
    action: "inspect-original-only",
    generationAllowed: false,
    registryRestored: false,
    objectSha: tag.sha,
    checkpoint: record,
  };
}
