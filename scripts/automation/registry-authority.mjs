// Trusted supervisor only. One GitHub-backed slot, not a queue, lease or publisher.
import { createHash, randomUUID } from "node:crypto";
import { githubRequest } from "./execution-claim.mjs";
import { readExecutionCheckpoint } from "./execution-checkpoint.mjs";
import { readExecutionResult } from "./execution-result.mjs";
import { validateAdmissionProof } from "./task-admission.mjs";
const REPOSITORY = "mikevazquez/Demeter";
const API = `repos/${REPOSITORY}`;
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
const digest = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const sha = (v) => /^[a-f0-9]{40}$/.test(v ?? "");
const hash = (v) => /^[a-f0-9]{64}$/.test(v ?? "");
const exact = (v, keys) =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).sort().join() === keys.slice().sort().join();
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const blobSha = (bytes) =>
  createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
function configOK(config) {
  assert(
    exact(config, ["ref", "genesisSha"]) && sha(config.genesisSha),
    "Pinned registry genesis required",
  );
  refOK(config.ref);
}
function refOK(ref) {
  assert(
    typeof ref === "string" &&
      /^refs\/heads\/governance2\/(registry-318-v1|coordination-proof-318-[a-z0-9-]{1,60})$/.test(
        ref,
      ),
    "Reviewed registry reference required",
  );
}
export function registryWorkFingerprint(task) {
  return digest({
    goal: task.goal,
    authorization: task.authorization,
    baseSha: task.baseSha,
    allowedPaths: task.allowedPaths.slice().sort(),
    checks: task.checks,
  });
}
function identity(task) {
  validateAdmissionProof(task);
  return { id: task.id, contractSha256: digest(task) };
}
function validateHistory(history) {
  assert(Array.isArray(history) && history.length <= 100, "Bounded reviewed import required");
  const ids = new Set();
  for (const item of history) {
    assert(
      exact(item, ["id", "baseSha", "contractSha256", "authorization", "fingerprint", "closure"]) &&
        /^[a-z0-9][a-z0-9-]{2,79}$/.test(item.id) &&
        sha(item.baseSha) &&
        hash(item.contractSha256) &&
        hash(item.fingerprint) &&
        item.authorization === `https://github.com/${REPOSITORY}/issues/318` &&
        !ids.has(item.id),
      "Invalid or duplicate consumed import",
    );
    ids.add(item.id);
    validateClosure(item.closure, item.id);
  }
}
function validateClosure(closure, id) {
  if (closure?.kind === "published") {
    assert(
      exact(closure, ["kind", "url", "commitSha", "branch", "draft"]) &&
        closure.draft === true &&
        sha(closure.commitSha) &&
        closure.branch === `studio-flow/minimal/${id}` &&
        /^https:\/\/github\.com\/mikevazquez\/Demeter\/pull\/[1-9][0-9]*$/.test(closure.url),
      "Exact published receipt required",
    );
  } else {
    assert(
      exact(closure, ["kind", "objectSha", "record"]) &&
        closure.kind === "auth-blocked" &&
        sha(closure.objectSha) &&
        exact(closure.record, [
          "schema",
          "id",
          "baseSha",
          "contractSha256",
          "status",
          "reason",
          "ownerObjectSha",
          "checkpointObjectSha",
          "resultSha256",
          "eventSha256",
          "sessionId",
        ]) &&
        closure.record.schema === "governance2-auth-terminal-v1" &&
        closure.record.id === id &&
        closure.record.reason === "authentication-required" &&
        closure.record.status === "blocked" &&
        hash(closure.record.resultSha256) &&
        hash(closure.record.eventSha256) &&
        typeof closure.record.sessionId === "string" &&
        closure.record.sessionId.length <= 200,
      "Verified terminal closure required",
    );
  }
}
function validateState(state) {
  assert(
    exact(state, [
      "schema",
      "repository",
      "sequence",
      "previous",
      "historySha256",
      "history",
      "active",
      "entries",
    ]) &&
      state.schema === "governance2-registry-authority-v1" &&
      state.repository === REPOSITORY &&
      Number.isSafeInteger(state.sequence) &&
      state.sequence >= 0 &&
      (state.previous === null || sha(state.previous)) &&
      hash(state.historySha256) &&
      Array.isArray(state.entries) &&
      state.entries.length <= 100,
    "Invalid global registry state",
  );
  validateHistory(state.history);
  assert(digest(state.history) === state.historySha256, "Consumed history digest changed");
  const ids = new Set(state.history.map((x) => x.id));
  const fingerprints = new Set(state.history.map((e) => e.fingerprint));
  for (const entry of state.entries) {
    assert(
      exact(entry, ["task", "contractSha256", "fingerprint", "ownerNonce", "closure"]) &&
        hash(entry.contractSha256) &&
        entry.contractSha256 === digest(entry.task) &&
        /^[a-zA-Z0-9-]{3,80}$/.test(entry.ownerNonce ?? "") &&
        !ids.has(entry.task.id),
      "Invalid global registry owner/contract",
    );
    identity(entry.task);
    assert(
      entry.fingerprint === registryWorkFingerprint(entry.task) &&
        !fingerprints.has(entry.fingerprint),
      "Duplicate global work fingerprint",
    );
    ids.add(entry.task.id);
    fingerprints.add(entry.fingerprint);
    if (entry.closure !== null) validateClosure(entry.closure, entry.task.id);
  }
  const pending = state.entries.filter((e) => e.closure === null);
  assert(
    pending.length <= 1 && state.active === (pending[0]?.task.id ?? null),
    "Global slot and consumed history disagree",
  );
}
function readCommit(objectSha, request) {
  const commit = request("GET", `${API}/git/commits/${objectSha}`);
  assert(
    commit?.sha === objectSha &&
      sha(commit.tree?.sha) &&
      commit.parents?.length === 1 &&
      sha(commit.parents[0].sha),
    "Invalid registry commit ancestry",
  );
  const tree = request("GET", `${API}/git/trees/${commit.tree.sha}`);
  assert(
    tree?.sha === commit.tree.sha &&
      tree.truncated === false &&
      tree.tree?.length === 1 &&
      tree.tree[0].path === "registry.json" &&
      tree.tree[0].mode === "100644" &&
      tree.tree[0].type === "blob" &&
      sha(tree.tree[0].sha),
    "Exact registry tree required",
  );
  const blob = request("GET", `${API}/git/blobs/${tree.tree[0].sha}`);
  assert(
    blob?.sha === tree.tree[0].sha &&
      blob.encoding === "base64" &&
      typeof blob.content === "string" &&
      Number.isSafeInteger(blob.size) &&
      blob.size <= 1024 * 1024,
    "Bounded registry blob required",
  );
  const bytes = Buffer.from(blob.content, "base64");
  assert(
    bytes.length === blob.size && blobSha(bytes) === tree.tree[0].sha,
    "Registry blob bytes changed",
  );
  const state = JSON.parse(bytes.toString("utf8"));
  validateState(state);
  return { headSha: objectSha, parent: commit.parents[0].sha, state };
}
function transition(before, after, parent) {
  assert(
    after.sequence === before.sequence + 1 &&
      after.previous === parent &&
      equal(after.history, before.history) &&
      after.historySha256 === before.historySha256,
    "Registry sequence/history rollback or fork",
  );
  if (after.entries.length === before.entries.length + 1) {
    assert(
      before.active === null &&
        equal(after.entries.slice(0, -1), before.entries) &&
        after.active === after.entries.at(-1).task.id &&
        after.entries.at(-1).closure === null,
      "Invalid slot acquisition transition",
    );
  } else {
    assert(
      before.active !== null &&
        after.active === null &&
        after.entries.length === before.entries.length,
      "Invalid slot closure transition",
    );
    const index = before.entries.findIndex((e) => e.task.id === before.active);
    const expected = structuredClone(before.entries);
    expected[index].closure = after.entries[index].closure;
    assert(
      expected[index].closure !== null && equal(expected, after.entries),
      "Owner or consumed entry changed on closure",
    );
  }
}
// Verify the entire bounded chain back to the externally pinned genesis, not just the tip.
export function readRegistryAuthority(config, { request = githubRequest } = {}) {
  configOK(config);
  const ref = request("GET", `${API}/git/ref/${config.ref.slice(5)}`);
  assert(
    ref?.ref === config.ref && ref.object?.type === "commit" && sha(ref.object.sha),
    "Registry reference missing or changed type",
  );
  const chain = [];
  let current = readCommit(ref.object.sha, request);
  const tip = current;
  for (;;) {
    chain.push(current);
    assert(
      chain.length <= 201,
      "Registry history bound exceeded; explicit reviewed migration required",
    );
    if (current.headSha === config.genesisSha) break;
    assert(
      current.state.sequence > 0 && current.state.previous === current.parent,
      "Registry is not descended from pinned genesis",
    );
    current = readCommit(current.parent, request);
  }
  assert(
    current.state.sequence === 0 &&
      current.state.previous === null &&
      current.state.entries.length === 0 &&
      current.state.active === null,
    "Invalid pinned genesis",
  );
  for (let i = chain.length - 1; i > 0; i--)
    transition(chain[i].state, chain[i - 1].state, chain[i].headSha);
  return { headSha: tip.headSha, state: tip.state };
}
function createCommit(state, parent, request) {
  const bytes = Buffer.from(JSON.stringify(state) + "\n");
  assert(bytes.length <= 1024 * 1024, "Registry capacity exceeded; never discard consumption");
  const blob = request("POST", `${API}/git/blobs`, {
    content: bytes.toString("base64"),
    encoding: "base64",
  });
  assert(blob?.sha === blobSha(bytes), "Registry blob write unacknowledged");
  const tree = request("POST", `${API}/git/trees`, {
    tree: [{ path: "registry.json", mode: "100644", type: "blob", sha: blob.sha }],
  });
  assert(sha(tree?.sha), "Registry tree write unacknowledged");
  const commit = request("POST", `${API}/git/commits`, {
    message: `Governance 2.0 registry transition ${state.sequence}`,
    tree: tree.sha,
    parents: [parent],
  });
  assert(sha(commit?.sha), "Registry commit write unacknowledged");
  return commit.sha;
}
function advance(config, current, state, request) {
  validateState(state);
  transition(current.state, state, current.headSha);
  const next = createCommit(state, current.headSha, request);
  try {
    const response = request("PATCH", `${API}/git/refs/${config.ref.slice(5)}`, {
      sha: next,
      force: false,
    });
    assert(
      response?.ref === config.ref && response.object?.sha === next,
      "Registry CAS not acknowledged",
    );
    const observed = request("GET", `${API}/git/ref/${config.ref.slice(5)}`);
    assert(
      observed?.ref === config.ref && observed.object?.sha === next,
      "Registry CAS readback changed",
    );
  } catch (cause) {
    throw new Error(
      "Registry transition consumed or uncertain; read original state, never retry acquisition or generation",
      { cause },
    );
  }
  return next;
}
// Explicit one-time initialization by trusted supervisor, never on a missing-ref fallback.
export function initializeRegistryAuthority(
  { ref, baseSha, history, historySha256 },
  { request = githubRequest } = {},
) {
  refOK(ref);
  validateHistory(history);
  assert(
    sha(baseSha) && digest(history) === historySha256,
    "Reviewed immutable migration snapshot required",
  );
  try {
    request("GET", `${API}/git/ref/${ref.slice(5)}`);
    throw new Error("Registry already exists; never initialize again");
  } catch (error) {
    if (error.httpStatus !== 404) throw error;
  }
  for (const item of history)
    verifyRegistryClosure(item, item.closure, { request, historical: true });
  const state = {
    schema: "governance2-registry-authority-v1",
    repository: REPOSITORY,
    sequence: 0,
    previous: null,
    historySha256,
    history: structuredClone(history),
    active: null,
    entries: [],
  };
  const genesisSha = createCommit(state, baseSha, request);
  try {
    const response = request("POST", `${API}/git/refs`, { ref, sha: genesisSha });
    assert(
      response?.ref === ref && response.object?.sha === genesisSha,
      "Registry initialization not acknowledged",
    );
  } catch (cause) {
    throw new Error(
      "Registry initialization uncertain; inspect existing reference, never initialize another",
      { cause },
    );
  }
  const config = { ref, genesisSha };
  assert(
    readRegistryAuthority(config, { request }).headSha === genesisSha,
    "Registry genesis readback changed",
  );
  return config;
}
export function acquireRegistryTask(
  task,
  config,
  { request = githubRequest, nonce = randomUUID(), expectedHead } = {},
) {
  const taskIdentity = identity(task);
  assert(/^[a-zA-Z0-9-]{3,80}$/.test(nonce), "Invalid registry owner nonce");
  const current = readRegistryAuthority(config, { request });
  if (expectedHead !== undefined)
    assert(current.headSha === expectedHead, "Registry head changed before acquisition; reconcile");
  assert(
    current.state.active === null,
    "Global registry busy; reconcile current task without expiry or takeover",
  );
  assert(
    !current.state.history.some(
      (e) => e.id === task.id || e.fingerprint === registryWorkFingerprint(task),
    ) &&
      !current.state.entries.some(
        (e) =>
          e.task.id === task.id ||
          e.task.admission.workKey === task.admission.workKey ||
          e.fingerprint === registryWorkFingerprint(task),
      ),
    "Global task/work already consumed",
  );
  const entry = {
    task: structuredClone(task),
    contractSha256: taskIdentity.contractSha256,
    fingerprint: registryWorkFingerprint(task),
    ownerNonce: nonce,
    closure: null,
  };
  const state = {
    ...current.state,
    sequence: current.state.sequence + 1,
    previous: current.headSha,
    active: task.id,
    entries: [...current.state.entries, entry],
  };
  const headSha = advance(config, current, state, request);
  return {
    id: task.id,
    contractSha256: entry.contractSha256,
    ownerNonce: nonce,
    acquiredHeadSha: headSha,
  };
}
export function verifyRegistryTask(
  task,
  config,
  { request = githubRequest, owner, allowClosed = false } = {},
) {
  const expected = identity(task);
  const current = readRegistryAuthority(config, { request });
  const entry = current.state.entries.find((e) => e.task.id === task.id);
  assert(
    entry && entry.contractSha256 === expected.contractSha256 && equal(entry.task, task),
    "Global reservation contract missing or different",
  );
  if (owner)
    assert(
      owner.id === task.id &&
        owner.contractSha256 === entry.contractSha256 &&
        owner.ownerNonce === entry.ownerNonce &&
        sha(owner.acquiredHeadSha),
      "Different registry owner; no takeover",
    );
  assert(
    (allowClosed && entry.closure !== null) ||
      (entry.closure === null && current.state.active === task.id),
    "Global reservation is closed or belongs to another task",
  );
  return { ...current, entry };
}
export function verifyRegistryClosure(
  task,
  closure,
  { request = githubRequest, historical = false } = {},
) {
  validateClosure(closure, task.id);
  if (closure.kind === "published") {
    const number = closure.url.split("/").at(-1);
    const pr = request("GET", `${API}/pulls/${number}`);
    assert(
      pr?.html_url === closure.url &&
        pr.head?.ref === closure.branch &&
        pr.head?.repo?.full_name === REPOSITORY,
      "Matching remote PR identity required",
    );
    if (historical) {
      // A later review may advance/close/promote an old PR. It still consumes the old ID.
      const original = request("GET", `${API}/git/commits/${closure.commitSha}`);
      assert(original?.sha === closure.commitSha, "Original historical receipt commit unavailable");
    } else
      assert(
        pr.head.sha === closure.commitSha && pr.draft === true && pr.state === "open",
        "Fresh matching open Draft required to close global slot",
      );
    if (task.admission) {
      const { bundle } = readExecutionResult(task.id, task, { request });
      const commit = request("GET", `${API}/git/commits/${closure.commitSha}`);
      assert(
        commit?.sha === closure.commitSha &&
          commit.parents?.length === 1 &&
          commit.parents[0].sha === task.baseSha,
        "Published parent differs from global contract",
      );
      const comparison = request("GET", `${API}/compare/${task.baseSha}...${closure.commitSha}`);
      assert(
        Array.isArray(comparison?.files) &&
          equal(
            comparison.files.map((f) => f.filename).sort(),
            bundle.files.map((f) => f.path).sort(),
          ),
        "Published paths differ from sealed result",
      );
      const tree = request("GET", `${API}/git/trees/${commit.tree.sha}?recursive=1`);
      assert(
        tree?.truncated === false && Array.isArray(tree.tree),
        "Complete published tree required",
      );
      for (const file of bundle.files) {
        const entry = tree.tree.find((e) => e.path === file.path);
        if (file.deleted) {
          assert(!entry, "Published deletion mismatch");
          continue;
        }
        assert(entry?.type === "blob" && entry.mode === file.mode, "Published mode mismatch");
        const blob = request("GET", `${API}/git/blobs/${entry.sha}`);
        assert(
          blob?.encoding === "base64" &&
            typeof blob.content === "string" &&
            createHash("sha256").update(Buffer.from(blob.content, "base64")).digest("hex") ===
              file.sha256,
          "Published bytes differ from sealed result",
        );
      }
    }
  } else {
    const name = `tags/vianelis/terminal-attempts/${task.id}`;
    const ref = request("GET", `${API}/git/ref/${name}`);
    assert(
      ref?.ref === `refs/${name}` &&
        ref.object?.type === "tag" &&
        ref.object.sha === closure.objectSha,
      "Terminal reference changed",
    );
    const tag = request("GET", `${API}/git/tags/${closure.objectSha}`);
    const record = closure.record;
    assert(
      tag?.sha === closure.objectSha &&
        tag.object?.type === "commit" &&
        tag.object.sha === task.baseSha &&
        equal(JSON.parse(tag.message), record) &&
        record.baseSha === task.baseSha &&
        record.contractSha256 === task.contractSha256 &&
        sha(record.ownerObjectSha) &&
        sha(record.checkpointObjectSha),
      "Terminal evidence or original contract changed",
    );
    const checkpoint = readExecutionCheckpoint(task.id, task, { request });
    assert(
      checkpoint.objectSha === record.checkpointObjectSha &&
        checkpoint.checkpoint.owner.objectSha === record.ownerObjectSha,
      "Terminal owner/checkpoint changed",
    );
  }
  return closure;
}
// Closure is retryable by readback; acquisition and model invocation are not.
export function settleRegistryTask(task, config, closure, { request = githubRequest } = {}) {
  const current = verifyRegistryTask(task, config, { request, allowClosed: true });
  if (current.entry.closure !== null) {
    assert(equal(current.entry.closure, closure), "Conflicting global receipt");
    verifyRegistryClosure({ ...task, contractSha256: digest(task) }, closure, { request });
    return { id: task.id, status: "closed", headSha: current.headSha, replay: true };
  }
  verifyRegistryClosure({ ...task, contractSha256: digest(task) }, closure, { request });
  const entries = current.state.entries.map((e) =>
    e.task.id === task.id ? { ...e, closure: structuredClone(closure) } : e,
  );
  const state = {
    ...current.state,
    sequence: current.state.sequence + 1,
    previous: current.headSha,
    active: null,
    entries,
  };
  const headSha = advance(config, current, state, request);
  return { id: task.id, status: "closed", headSha, replay: false };
}
