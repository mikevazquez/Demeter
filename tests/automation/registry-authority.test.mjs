// Explicit in-memory REST fixture. No real model, GitHub writes or canonical registry.
import fs from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import {
  verifySharedRegistryProof,
  observeCanonicalRegistry,
} from "../../scripts/automation/verify-registry-authority-ci.mjs";
import { fixture } from "./fixtures/result-authority.mjs";
import { claimExecution } from "../../scripts/automation/execution-claim.mjs";
import { writeExecutionCheckpoint } from "../../scripts/automation/execution-checkpoint.mjs";
import {
  captureExecutionResult,
  writeExecutionResult,
} from "../../scripts/automation/execution-result.mjs";
import { taskIdForWork } from "../../scripts/automation/task-admission.mjs";
import {
  initializeRegistryAuthority,
  readRegistryAuthority,
  acquireRegistryTask,
  verifyRegistryTask,
  settleRegistryTask,
} from "../../scripts/automation/registry-authority.mjs";
const hash = (v) => createHash("sha256").update(JSON.stringify(v)).digest("hex");
const fixtures = [];
afterEach(() => {
  for (const s of fixtures.splice(0)) fs.rmSync(s.root, { recursive: true, force: true });
});
function setup() {
  const s = fixture();
  fixtures.push(s);
  s.config = initializeRegistryAuthority(
    {
      ref: "refs/heads/governance2/registry-318-v1",
      baseSha: s.task.baseSha,
      history: [],
      historySha256: hash([]),
    },
    { request: s.request },
  );
  s.admitted = (workKey = "distinct-work", goal = workKey) => {
    const task = {
      id: taskIdForWork(workKey),
      goal,
      authorization: s.task.authorization,
      baseSha: s.task.baseSha,
      allowedPaths: ["proof.mjs"],
      checks: [["node", "checks/verify.mjs"]],
    };
    task.admission = {
      schema: "governance2-task-admission-v1",
      catalogSha256: "a".repeat(64),
      workKey,
      taskSha256: hash(task),
      startBefore: "2030-01-01T00:00:00.000Z",
      baseBranch: "review/base",
      limits: {
        provider: "codex-cli-chatgpt",
        maxModelInvocations: 1,
        timeoutMs: 1000,
        maxFiles: 1,
        maxTotalBytes: 1024,
      },
      independentChecks: [{ argv: task.checks[0], sourceSha256: "c".repeat(64) }],
    };
    return task;
  };
  s.acquire = (task, overrides = {}) =>
    acquireRegistryTask(task, s.config, { request: s.request, nonce: "test-owner", ...overrides });
  s.close = (task, overrides = {}) =>
    settleRegistryTask(task, s.config, s.closure(task), { request: s.request, ...overrides });
  s.closure = (task) => ({
    kind: "published",
    url: "https://github.com/mikevazquez/Demeter/pull/999",
    commitSha: "d".repeat(40),
    branch: `studio-flow/minimal/${task.id}`,
    draft: true,
  });
  s.publish = (task) => {
    const c = s.closure(task);
    const state = { task, contractSha256: hash(task), reservedAt: new Date().toISOString() };
    const owner = claimExecution(
      {
        id: task.id,
        baseSha: task.baseSha,
        contractSha256: state.contractSha256,
        authorization: task.authorization,
      },
      { request: s.request, nonce: "execution-fixture-owner" },
    );
    const intent = {
      ...s.intent,
      id: task.id,
      baseSha: task.baseSha,
      contractSha256: state.contractSha256,
    };
    delete intent.continuity;
    writeExecutionCheckpoint(state, owner, intent, { request: s.request });
    const result = { ...s.result, id: task.id, contractSha256: state.contractSha256 };
    const bundle = captureExecutionResult(s.repo, state, intent, result);
    writeExecutionResult(bundle, { request: s.request });
    const entries = bundle.files.map((f) => {
      const blob = s.request("POST", "repos/mikevazquez/Demeter/git/blobs", {
        content: f.contentBase64,
        encoding: "base64",
      });
      return { path: f.path, mode: f.mode, type: "blob", sha: blob.sha };
    });
    const treeSha = "e".repeat(40);
    s.trees.set(treeSha, { sha: treeSha, truncated: false, tree: entries });
    s.commits.set(c.commitSha, {
      sha: c.commitSha,
      tree: { sha: treeSha },
      parents: [{ sha: task.baseSha }],
    });
    const original = s.request;
    s.request = (m, p, b) =>
      m === "GET" && p.includes("/compare/")
        ? { files: bundle.files.map((f) => ({ filename: f.path })) }
        : original(m, p, b);
    s.setPrs([
      {
        html_url: c.url,
        state: "open",
        draft: true,
        head: { sha: c.commitSha, ref: c.branch, repo: { full_name: "mikevazquez/Demeter" } },
      },
    ]);
  };
  return s;
}
it("one global slot rejects a different host/work and keeps immutable consumption after close", () => {
  const s = setup(),
    a = s.admitted("first-work"),
    b = s.admitted("other-work");
  const owner = s.acquire(a);
  expect(verifyRegistryTask(a, s.config, { request: s.request, owner }).entry.task).toEqual(a);
  const before = s.calls.length;
  expect(() => s.acquire(b)).toThrow("busy");
  expect(s.calls.slice(before).every((c) => c.method === "GET")).toBe(true);
  s.publish(a);
  expect(s.close(a).replay).toBe(false);
  expect(s.close(a).replay).toBe(true);
  expect(() => s.acquire(a)).toThrow("already consumed");
  const renamed = s.admitted("renamed-work", a.goal);
  expect(() => s.acquire(renamed)).toThrow("already consumed");
  s.acquire(b);
  expect(s.close(a).replay).toBe(true);
  expect(readRegistryAuthority(s.config, { request: s.request }).state.active).toBe(b.id);
});
it("CAS siblings admit only one owner, even after both saw an idle head", () => {
  const s = setup(),
    a = s.admitted("first-work"),
    b = s.admitted("other-work");
  let raced = false;
  const request = (m, p, body) => {
    if (m === "PATCH" && !raced) {
      raced = true;
      s.acquire(b, { nonce: "other-host" });
    }
    return s.request(m, p, body);
  };
  expect(() => s.acquire(a, { request })).toThrow("uncertain");
  const state = readRegistryAuthority(s.config, { request: s.request }).state;
  expect(state.active).toBe(b.id);
  expect(state.entries).toHaveLength(1);
  expect(state.entries[0].ownerNonce).toBe("other-host");
});
it("lost accepted acquisition response retains consumption; readback never adopts or reacquires", () => {
  const s = setup(),
    task = s.admitted();
  const request = (m, p, body) => {
    const r = s.request(m, p, body);
    if (m === "PATCH") throw s.error(504);
    return r;
  };
  expect(() => s.acquire(task, { request })).toThrow("uncertain");
  const before = s.calls.length;
  expect(verifyRegistryTask(task, s.config, { request: s.request }).entry.task).toEqual(task);
  expect(() => s.acquire(task)).toThrow("busy");
  expect(s.calls.slice(before).every((c) => c.method === "GET")).toBe(true);
});
it("lost closure response reconciles by GET only and never opens another slot twice", () => {
  const s = setup(),
    task = s.admitted();
  s.acquire(task);
  s.publish(task);
  const request = (m, p, body) => {
    const r = s.request(m, p, body);
    if (m === "PATCH") throw s.error(504);
    return r;
  };
  expect(() => s.close(task, { request })).toThrow("uncertain");
  const before = s.calls.length;
  expect(s.close(task).replay).toBe(true);
  expect(s.calls.slice(before).every((c) => c.method === "GET")).toBe(true);
  expect(() => s.acquire(task)).toThrow("already consumed");
});
it("closure without real matching remote receipt fails closed", () => {
  const s = setup(),
    task = s.admitted();
  s.acquire(task);
  expect(() => s.close(task)).toThrow();
  s.publish(task);
  const wrong = { ...s.closure(task), commitSha: "e".repeat(40) };
  expect(() => settleRegistryTask(task, s.config, wrong, { request: s.request })).toThrow(
    "matching open Draft",
  );
  expect(readRegistryAuthority(s.config, { request: s.request }).state.active).toBe(task.id);
});
it.each([401, 403, 404, 429, 500, 504])(
  "remote HTTP %s is never an empty registry or permission to initialize",
  (status) => {
    const s = setup(),
      task = s.admitted(),
      before = s.calls.length;
    const request = () => {
      throw s.error(status);
    };
    expect(() => s.acquire(task, { request })).toThrow();
    expect(s.calls).toHaveLength(before);
  },
);
it("missing config and unknown genesis cannot start or adopt a ledger", () => {
  const s = setup(),
    task = s.admitted();
  expect(() => acquireRegistryTask(task, undefined, { request: s.request })).toThrow("genesis");
  expect(() =>
    readRegistryAuthority({ ...s.config, genesisSha: "f".repeat(40) }, { request: s.request }),
  ).toThrow("pinned genesis");
  expect(() => verifyRegistryTask(task, s.config, { request: s.request })).toThrow(
    "missing or different",
  );
});
it("owner, contract and stale-head mismatches reject without writes", () => {
  const s = setup(),
    task = s.admitted(),
    owner = s.acquire(task),
    before = s.calls.length;
  expect(() =>
    verifyRegistryTask(task, s.config, {
      request: s.request,
      owner: { ...owner, ownerNonce: "wrong-owner" },
    }),
  ).toThrow("Different registry owner");
  const changed = structuredClone(task);
  changed.admission.startBefore = "2031-01-01T00:00:00.000Z";
  expect(() => verifyRegistryTask(changed, s.config, { request: s.request })).toThrow("different");
  expect(() => s.acquire(s.admitted("other-work"), { expectedHead: s.config.genesisSha })).toThrow(
    "head changed",
  );
  expect(s.calls.slice(before).every((c) => c.method === "GET")).toBe(true);
});
it("first initialization is explicit and not repeated on an existing or uncertain reference", () => {
  const s = setup();
  const args = { ref: s.config.ref, baseSha: s.task.baseSha, history: [], historySha256: hash([]) };
  expect(() => initializeRegistryAuthority(args, { request: s.request })).toThrow("already exists");
  expect(() =>
    initializeRegistryAuthority({ ...args, historySha256: "c".repeat(64) }, { request: s.request }),
  ).toThrow("snapshot");
  const before = s.calls.length;
  expect(() =>
    initializeRegistryAuthority({ ...args, ref: "refs/heads/main" }, { request: s.request }),
  ).toThrow("reference");
  expect(s.calls).toHaveLength(before);
});
it("validates blob bytes, exact tree and parent chain, not just pointer identity", () => {
  const s = setup();
  s.acquire(s.admitted());
  const current = s.refs.get(s.config.ref).object.sha;
  const tree = s.trees.get(s.commits.get(current).tree.sha);
  const blob = s.blobs.get(tree.tree[0].sha),
    original = blob.content;
  blob.content = Buffer.from("{}").toString("base64");
  expect(() => readRegistryAuthority(s.config, { request: s.request })).toThrow("bytes changed");
  blob.content = original;
  tree.tree.push({ path: "extra", mode: "100644", type: "blob", sha: tree.tree[0].sha });
  expect(() => readRegistryAuthority(s.config, { request: s.request })).toThrow(
    "Exact registry tree",
  );
  tree.tree.pop();
  s.commits.get(current).parents[0].sha = "e".repeat(40);
  expect(() => readRegistryAuthority(s.config, { request: s.request })).toThrow("pinned genesis");
});

it("imports an advanced historical PR as consumed without releasing a live task", () => {
  const s = setup(),
    task = s.admitted();
  s.publish(task);
  const closure = s.closure(task),
    original = s.request;
  const request = (m, p, b) => {
    const value = original(m, p, b);
    if (m === "GET" && p.endsWith("/pulls/999"))
      return {
        ...value,
        head: { ...value.head, sha: "f".repeat(40) },
        state: "closed",
        draft: false,
      };
    return value;
  };
  const history = [
    {
      id: task.id,
      baseSha: task.baseSha,
      contractSha256: hash(task),
      authorization: task.authorization,
      fingerprint: hash({
        goal: task.goal,
        authorization: task.authorization,
        baseSha: task.baseSha,
        allowedPaths: task.allowedPaths,
        checks: task.checks,
      }),
      closure,
    },
  ];
  const config = initializeRegistryAuthority(
    {
      ref: "refs/heads/governance2/coordination-proof-318-import",
      baseSha: task.baseSha,
      history,
      historySha256: hash(history),
    },
    { request },
  );
  expect(readRegistryAuthority(config, { request }).state.history).toEqual(history);
  expect(() => acquireRegistryTask(task, config, { request })).toThrow("already consumed");
  expect(() =>
    acquireRegistryTask(s.admitted("renamed-work", task.goal), config, { request }),
  ).toThrow("already consumed");
});
it("terminal closure binds original checkpoint and cannot be used for a different contract", () => {
  const s = setup(),
    task = s.admitted();
  s.acquire(task);
  const contractSha256 = hash(task),
    state = { task, contractSha256, reservedAt: new Date().toISOString() };
  const owner = claimExecution(
    { id: task.id, baseSha: task.baseSha, contractSha256, authorization: task.authorization },
    { request: s.request, nonce: "terminal-owner" },
  );
  const intent = {
    id: task.id,
    baseSha: task.baseSha,
    contractSha256,
    mode: "supervised-cli",
    startedAt: new Date().toISOString(),
  };
  const checkpoint = writeExecutionCheckpoint(state, owner, intent, { request: s.request });
  const record = {
    schema: "governance2-auth-terminal-v1",
    id: task.id,
    baseSha: task.baseSha,
    contractSha256,
    status: "blocked",
    reason: "authentication-required",
    ownerObjectSha: owner.objectSha,
    checkpointObjectSha: checkpoint.objectSha,
    resultSha256: "a".repeat(64),
    eventSha256: "b".repeat(64),
    sessionId: "explicit-terminal-fixture",
  };
  const tag = s.request("POST", "repos/mikevazquez/Demeter/git/tags", {
    object: task.baseSha,
    type: "commit",
    message: JSON.stringify(record),
  });
  s.request("POST", "repos/mikevazquez/Demeter/git/refs", {
    ref: `refs/tags/vianelis/terminal-attempts/${task.id}`,
    sha: tag.sha,
  });
  const closure = { kind: "auth-blocked", objectSha: tag.sha, record };
  expect(() =>
    settleRegistryTask(
      task,
      s.config,
      { ...closure, record: { ...record, contractSha256: "f".repeat(64) } },
      { request: s.request },
    ),
  ).toThrow("original contract changed");
  expect(settleRegistryTask(task, s.config, closure, { request: s.request }).status).toBe("closed");
  const before = s.calls.length;
  expect(settleRegistryTask(task, s.config, closure, { request: s.request }).replay).toBe(true);
  expect(s.calls.slice(before).every((c) => c.method === "GET")).toBe(true);
});
it.each(["sequence", "owner", "erase", "history"])(
  "rejects an acknowledged malformed %s transition instead of trusting the tip",
  (mode) => {
    const s = setup(),
      task = s.admitted();
    s.acquire(task);
    const current = readRegistryAuthority(s.config, { request: s.request }),
      state = structuredClone(current.state);
    state.sequence++;
    state.previous = current.headSha;
    if (mode === "sequence") state.sequence++;
    if (mode === "owner") state.entries[0].ownerNonce = "different-owner";
    if (mode === "erase") {
      state.entries = [];
      state.active = null;
    }
    if (mode === "history") state.historySha256 = "d".repeat(64);
    const bytes = Buffer.from(JSON.stringify(state) + "\n");
    const blob = s.request("POST", "repos/mikevazquez/Demeter/git/blobs", {
      encoding: "base64",
      content: bytes.toString("base64"),
    });
    const tree = s.request("POST", "repos/mikevazquez/Demeter/git/trees", {
      tree: [{ path: "registry.json", mode: "100644", type: "blob", sha: blob.sha }],
    });
    const commit = s.request("POST", "repos/mikevazquez/Demeter/git/commits", {
      tree: tree.sha,
      parents: [current.headSha],
    });
    s.request("PATCH", "repos/mikevazquez/Demeter/git/refs/" + s.config.ref.slice(5), {
      sha: commit.sha,
      force: false,
    });
    expect(() => readRegistryAuthority(s.config, { request: s.request })).toThrow();
  },
);

it("independent observer verifies the pinned proof with GETs and no local registry", () => {
  const s = setup(),
    task = s.admitted();
  const owner = s.acquire(task),
    before = s.calls.length;
  const result = verifySharedRegistryProof({
    request: s.request,
    config: s.config,
    expectedHead: owner.acquiredHeadSha,
    expectedTask: task.id,
  });
  expect(result.remoteWrites).toBe(0);
  expect(result.modelCalls).toBe(0);
  expect(result.generationAllowed).toBe(false);
  expect(s.calls.slice(before).every((c) => c.method === "GET")).toBe(true);
  expect(() =>
    verifySharedRegistryProof({
      request: s.request,
      config: s.config,
      expectedHead: s.config.genesisSha,
      expectedTask: task.id,
    }),
  ).toThrow("proof changed");
});

it("canonical observer verifies the imported history without acquiring or clearing work", () => {
  const s = setup(),
    task = s.admitted();
  s.acquire(task);
  const before = s.calls.length;
  const report = observeCanonicalRegistry(s.config, hash([]), 0, { request: s.request });
  expect(report.active).toBe(task.id);
  expect(report.remoteWrites).toBe(0);
  expect(report.entries).toBe(1);
  expect(s.calls.slice(before).every((c) => c.method === "GET")).toBe(true);
  expect(() =>
    observeCanonicalRegistry(s.config, "f".repeat(64), 1, { request: s.request }),
  ).toThrow("import changed");
});
