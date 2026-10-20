import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  createGitHubSupervisorStore,
  migrateSupervisorStore,
  supervisorSnapshotSha256,
} from "../../scripts/automation/supervisor-store.mjs";

const REPOSITORY = "mikevazquez/Demeter";
const REF = "refs/heads/governance2/supervisor-proof-store-test";
const API = `repos/${REPOSITORY}`;
const sha1 = (value) => createHash("sha1").update(value).digest("hex");
const clone = (value) => JSON.parse(JSON.stringify(value));
const blobSha = (bytes) =>
  createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const httpError = (httpStatus) => Object.assign(new Error(`HTTP ${httpStatus}`), { httpStatus });
const legacyFixture = () => ({
  schema: "governance2-registry-authority-v1",
  repository: REPOSITORY,
  sequence: 7,
  previous: "a".repeat(40),
  historySha256: supervisorSnapshotSha256([
    { id: "already-consumed", closure: { kind: "published" } },
  ]),
  history: [{ id: "already-consumed", closure: { kind: "published" } }],
  active: null,
  entries: [
    {
      task: { id: "completed-task" },
      closure: { kind: "published", url: "https://github.com/mikevazquez/Demeter/pull/334" },
    },
  ],
});

// This fake models immutable Git objects, references and fast-forward semantics;
// these are storage tests, not evidence of a remote Git or worker execution.
function fakeGitHub({ legacy = legacyFixture(), ref = REF, initialStatus } = {}) {
  const blobs = new Map();
  const trees = new Map();
  const commits = new Map();
  const refs = new Map();
  const calls = [];
  let hook;
  let patchFailure = null;
  let refReadFailure = false;

  function addBlob(bytes) {
    const data = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
    const sha = blobSha(data);
    blobs.set(sha, Buffer.from(data));
    return sha;
  }
  function addTree(entries) {
    const tree = Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)));
    const sha = sha1(JSON.stringify(tree));
    trees.set(sha, clone(tree));
    return sha;
  }
  function addCommit(tree, parent, message = "commit") {
    const sha = sha1(JSON.stringify({ tree, parent, message }));
    commits.set(sha, { sha, tree: { sha: tree }, parents: [{ sha: parent }] });
    return sha;
  }
  const legacyEntries = {
    "registry.json": { mode: "100644", type: "blob", sha: addBlob(JSON.stringify(legacy) + "\n") },
    "retained-evidence.txt": { mode: "100644", type: "blob", sha: addBlob("keep unchanged\n") },
  };
  if (initialStatus !== undefined) {
    legacyEntries["status.md"] = {
      mode: "100644",
      type: "blob",
      sha: addBlob(initialStatus),
    };
  }
  const legacyTree = addTree(legacyEntries);
  const anchorSha = addCommit(legacyTree, "1".repeat(40), "legacy anchor");
  refs.set(ref, anchorSha);

  function distance(base, head) {
    let current = head;
    for (let count = 0; count < 1000; count++) {
      if (current === base) return count;
      const commit = commits.get(current);
      if (!commit || commit.parents.length !== 1) return null;
      current = commit.parents[0].sha;
    }
    throw new Error("Unexpected fake history length");
  }

  async function request(method, endpoint, body) {
    calls.push({ method, endpoint, ...(body === undefined ? {} : { body: clone(body) }) });
    assert.ok(endpoint.startsWith(API + "/"), "Requests stay in the allowed repository");
    const path = endpoint.slice(API.length + 1);
    if (method === "GET" && path.startsWith("git/ref/")) {
      if (refReadFailure) {
        refReadFailure = false;
        throw httpError(503);
      }
      const name = "refs/" + path.slice("git/ref/".length);
      if (!refs.has(name)) throw httpError(404);
      return { ref: name, object: { type: "commit", sha: refs.get(name) } };
    }
    if (method === "GET" && path.startsWith("git/commits/")) {
      const value = commits.get(path.slice("git/commits/".length));
      if (!value) throw httpError(404);
      return clone(value);
    }
    if (method === "GET" && path.startsWith("git/trees/")) {
      const sha = path.slice("git/trees/".length);
      const value = trees.get(sha);
      if (!value) throw httpError(404);
      return {
        sha,
        truncated: false,
        tree: Object.entries(value).map(([path, entry]) => ({ path, ...entry })),
      };
    }
    if (method === "GET" && path.startsWith("git/blobs/")) {
      const sha = path.slice("git/blobs/".length);
      const bytes = blobs.get(sha);
      if (!bytes) throw httpError(404);
      return { sha, content: bytes.toString("base64"), encoding: "base64", size: bytes.length };
    }
    if (method === "GET" && path.startsWith("compare/")) {
      const [base, head] = path.slice("compare/".length).split("?")[0].split("...");
      const ahead = distance(base, head);
      return ahead === null
        ? {
            status: "diverged",
            ahead_by: 1,
            behind_by: 1,
            merge_base_commit: { sha: "2".repeat(40) },
          }
        : {
            status: ahead ? "ahead" : "identical",
            ahead_by: ahead,
            behind_by: 0,
            merge_base_commit: { sha: base },
          };
    }
    if (method === "POST" && path === "git/blobs") {
      assert.equal(body.encoding, "base64");
      return { sha: addBlob(Buffer.from(body.content, "base64")) };
    }
    if (method === "POST" && path === "git/trees") {
      assert.ok(trees.has(body.base_tree), "Every write preserves an existing tree");
      const entries = clone(trees.get(body.base_tree));
      for (const entry of body.tree) {
        assert.ok(entry.sha, "No deletion is permitted");
        entries[entry.path] = { mode: entry.mode, type: entry.type, sha: entry.sha };
      }
      return { sha: addTree(entries) };
    }
    if (method === "POST" && path === "git/commits") {
      assert.equal(body.parents.length, 1);
      return { sha: addCommit(body.tree, body.parents[0], body.message) };
    }
    if (method === "PATCH" && path.startsWith("git/refs/")) {
      assert.equal(body.force, false, "No reference may be force updated");
      if (hook) await hook();
      if (patchFailure === "before") {
        patchFailure = null;
        throw httpError(503);
      }
      const name = "refs/" + path.slice("git/refs/".length);
      assert.ok(refs.has(name), "CAS must not create a missing reference");
      if (distance(refs.get(name), body.sha) === null) throw httpError(422);
      refs.set(name, body.sha);
      if (patchFailure === "after") {
        patchFailure = null;
        throw httpError(503);
      }
      if (patchFailure === "readback") {
        patchFailure = null;
        refReadFailure = true;
      }
      return { ref: name, object: { sha: body.sha, type: "commit" } };
    }
    throw new Error(`Unexpected request ${method} ${path}`);
  }
  const config = {
    repository: REPOSITORY,
    ref,
    anchorSha,
    legacySha256: supervisorSnapshotSha256(legacy),
    request,
  };
  return {
    config,
    calls,
    refs,
    blobs,
    trees,
    commits,
    anchorSha,
    legacy: clone(legacy),
    snapshot: { head_sha: anchorSha, sha256: config.legacySha256, state: clone(legacy) },
    setPatchFailure(value) {
      patchFailure = value;
    },
    setPatchHook(value) {
      hook = value;
    },
    treeAt(version = refs.get(ref)) {
      return clone(trees.get(commits.get(version).tree.sha));
    },
    stateAt(version = refs.get(ref)) {
      const tree = trees.get(commits.get(version).tree.sha);
      return JSON.parse(blobs.get(tree["registry.json"].sha).toString("utf8"));
    },
    injectState(state, parent = refs.get(ref)) {
      const entries = clone(trees.get(commits.get(parent).tree.sha));
      entries["registry.json"].sha = addBlob(JSON.stringify(state) + "\n");
      const version = addCommit(addTree(entries), parent, "untrusted injected transition");
      refs.set(ref, version);
      return version;
    },
  };
}

async function migrated(fake = fakeGitHub()) {
  const initial = await migrateSupervisorStore({ ...fake.config, legacySnapshot: fake.snapshot });
  return { fake, initial, store: createGitHubSupervisorStore(fake.config) };
}

function transition(current, fields = {}) {
  return {
    ...clone(current.state),
    ...fields,
    sequence: current.state.sequence + 1,
    previous: current.version,
  };
}

test("explicit migration preserves legacy bytes and unrelated files on the same reference", async () => {
  const fake = fakeGitHub();
  const originalTree = fake.treeAt();
  const originalBlob = originalTree["registry.json"].sha;
  const { initial, store } = await migrated(fake);
  assert.equal(initial.state.sequence, 0);
  assert.equal(initial.state.previous, fake.anchorSha);
  assert.deepEqual(initial.state.legacy, fake.snapshot);
  assert.deepEqual(initial.state.tasks, []);
  assert.equal(initial.state.active_task_id, null);
  assert.equal(
    fake.treeAt()["retained-evidence.txt"].sha,
    originalTree["retained-evidence.txt"].sha,
  );
  assert.equal(fake.treeAt(fake.anchorSha)["registry.json"].sha, originalBlob);
  assert.deepEqual(await store.read(), initial);
  assert.ok(
    Object.keys(fake.treeAt()).some((path) =>
      /^events\/000000000000-[a-f0-9]{64}\.json$/.test(path),
    ),
  );
  assert.equal(fake.calls.filter((call) => call.method === "PATCH").length, 1);
});

test("read never migrates legacy state and never initializes a missing ref", async () => {
  const fake = fakeGitHub();
  const store = createGitHubSupervisorStore(fake.config);
  await assert.rejects(store.read(), { code: "MIGRATION_REQUIRED" });
  assert.equal(fake.calls.filter((call) => call.method !== "GET").length, 0);
  fake.refs.delete(REF);
  await assert.rejects(store.read(), { code: "STATE_NOT_FOUND" });
  await assert.rejects(migrateSupervisorStore({ ...fake.config, legacySnapshot: fake.snapshot }), {
    code: "STATE_NOT_FOUND",
  });
  assert.equal(fake.calls.filter((call) => call.method !== "GET").length, 0);
});

test("migration refuses an active legacy slot or changed snapshot", async () => {
  const legacy = legacyFixture();
  legacy.active = "still-running";
  const active = fakeGitHub({ legacy });
  await assert.rejects(
    migrateSupervisorStore({ ...active.config, legacySnapshot: active.snapshot }),
    /closed legacy authority/,
  );
  assert.equal(active.calls.filter((call) => call.method !== "GET").length, 0);
  const closed = fakeGitHub();
  const changed = clone(closed.snapshot);
  changed.state.history = [];
  await assert.rejects(
    migrateSupervisorStore({ ...closed.config, legacySnapshot: changed }),
    /snapshot content changed/,
  );
  assert.equal(closed.calls.length, 0);
});

test("migration is explicit once and requires the exact pinned head", async () => {
  const { fake, initial } = await migrated();
  const writes = fake.calls.filter((call) => call.method !== "GET").length;
  await assert.rejects(migrateSupervisorStore({ ...fake.config, legacySnapshot: fake.snapshot }), {
    code: "CAS_CONFLICT",
  });
  assert.equal(fake.refs.get(REF), initial.version);
  assert.equal(fake.calls.filter((call) => call.method !== "GET").length, writes);
});

test("a CAS writes one sequence, journals its event and preserves all previous tree entries", async () => {
  const { fake, initial, store } = await migrated();
  const before = fake.treeAt();
  const next = transition(initial, { tasks: [{ task_id: "task-1", phase: "queued" }] });
  const updated = await store.compareAndSwap(initial.version, next, {
    type: "task_admitted",
    task_id: "task-1",
  });
  assert.deepEqual(updated.state, next);
  assert.equal(fake.commits.get(updated.version).parents[0].sha, initial.version);
  assert.deepEqual(updated.state.legacy, initial.state.legacy);
  for (const [path, entry] of Object.entries(before)) {
    if (path !== "registry.json") assert.deepEqual(fake.treeAt()[path], entry);
  }
  const eventFiles = Object.keys(fake.treeAt()).filter((path) => path.startsWith("events/"));
  assert.equal(eventFiles.length, 2);
  const eventFile = eventFiles.find((path) => path.startsWith("events/000000000001-"));
  const record = JSON.parse(fake.blobs.get(fake.treeAt()[eventFile].sha).toString());
  assert.equal(record.previous, initial.version);
  assert.equal(record.state_sha256, supervisorSnapshotSha256(next));
  assert.equal(record.event.type, "task_admitted");
  assert.deepEqual(await store.read(), updated);
});

test("a stale version cannot create blobs, commits or duplicate an event", async () => {
  const { fake, initial, store } = await migrated();
  const next = transition(initial);
  await store.compareAndSwap(initial.version, next, { type: "tick" });
  const writes = fake.calls.filter((call) => call.method !== "GET").length;
  await assert.rejects(store.compareAndSwap(initial.version, next, { type: "tick" }), {
    code: "CAS_CONFLICT",
  });
  assert.equal(fake.calls.filter((call) => call.method !== "GET").length, writes);
});

test("concurrent same-parent CAS attempts have exactly one winner even for identical state/events", async () => {
  const { fake, initial, store } = await migrated();
  let arrivals = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  fake.setPatchHook(async () => {
    arrivals++;
    if (arrivals === 2) release();
    await gate;
  });
  const other = createGitHubSupervisorStore(fake.config);
  const results = await Promise.allSettled([
    store.compareAndSwap(initial.version, transition(initial), { type: "same-event" }),
    other.compareAndSwap(initial.version, transition(initial), { type: "same-event" }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.find((result) => result.status === "rejected").reason.code, "CAS_CONFLICT");
  assert.equal(fake.stateAt().sequence, 1);
  const patches = fake.calls.filter((call) => call.method === "PATCH").slice(-2);
  assert.notEqual(patches[0].body.sha, patches[1].body.sha);
  assert.equal(Object.keys(fake.treeAt()).filter((path) => path.startsWith("events/")).length, 2);
});

test("lost PATCH response is reconciled by readback with no repeated write", async () => {
  const { fake, initial, store } = await migrated();
  fake.setPatchFailure("after");
  const before = fake.calls.filter((call) => call.method === "PATCH").length;
  const updated = await store.compareAndSwap(initial.version, transition(initial), {
    type: "lost-ack",
  });
  assert.equal(updated.version, fake.refs.get(REF));
  assert.equal(updated.state.sequence, 1);
  assert.equal(fake.calls.filter((call) => call.method === "PATCH").length, before + 1);
});

test("an unacknowledged PATCH that did not write returns uncertainty and does not retry", async () => {
  const { fake, initial, store } = await migrated();
  fake.setPatchFailure("before");
  const before = fake.calls.filter((call) => call.method === "PATCH").length;
  await assert.rejects(
    store.compareAndSwap(initial.version, transition(initial), { type: "uncertain" }),
    { code: "WRITE_UNCERTAIN" },
  );
  assert.equal(fake.refs.get(REF), initial.version);
  assert.equal(fake.calls.filter((call) => call.method === "PATCH").length, before + 1);
});

test("failed readback reports uncertainty; a new observer recovers the committed state", async () => {
  const { fake, initial, store } = await migrated();
  fake.setPatchFailure("readback");
  await assert.rejects(
    store.compareAndSwap(initial.version, transition(initial), { type: "readback-failure" }),
    { code: "WRITE_UNCERTAIN" },
  );
  const recovered = await createGitHubSupervisorStore(fake.config).read();
  assert.equal(recovered.state.sequence, 1);
  assert.equal(recovered.state.previous, initial.version);
});

test("verification failure after successful ref readback is still a write uncertainty", async () => {
  const { fake, initial } = await migrated();
  let wrote = false;
  const request = async (method, path, body) => {
    const result = await fake.config.request(method, path, body);
    if (method === "PATCH") wrote = true;
    if (wrote && path.includes("/compare/")) throw httpError(503);
    return result;
  };
  const store = createGitHubSupervisorStore({ ...fake.config, request });
  await assert.rejects(
    store.compareAndSwap(initial.version, transition(initial), { type: "verification-failure" }),
    { code: "WRITE_UNCERTAIN" },
  );
  assert.equal(fake.stateAt().sequence, 1);
  assert.equal((await createGitHubSupervisorStore(fake.config).read()).state.sequence, 1);
});

test("unacknowledged object creation cannot mutate the authority or retry automatically", async () => {
  const { fake, initial } = await migrated();
  let failedPosts = 0;
  const request = async (method, path, body) => {
    const result = await fake.config.request(method, path, body);
    if (method === "POST" && path.endsWith("/blobs")) {
      failedPosts++;
      throw httpError(503);
    }
    return result;
  };
  const store = createGitHubSupervisorStore({ ...fake.config, request });
  await assert.rejects(
    store.compareAndSwap(initial.version, transition(initial), { type: "lost-blob-response" }),
    { code: "WRITE_UNCERTAIN" },
  );
  assert.equal(failedPosts, 1);
  assert.equal(fake.refs.get(REF), initial.version);
});

test("wrong previous, skipped sequence and modified legacy are rejected without writes", async () => {
  const { fake, initial, store } = await migrated();
  const writes = fake.calls.filter((call) => call.method !== "GET").length;
  for (const mutate of [
    (state) => {
      state.previous = fake.anchorSha;
    },
    (state) => {
      state.sequence += 1;
    },
    (state) => {
      state.legacy.state.entries = [];
    },
    (state) => {
      state.legacy.head_sha = "a".repeat(40);
    },
  ]) {
    const next = transition(initial);
    mutate(next);
    await assert.rejects(store.compareAndSwap(initial.version, next, { type: "invalid" }));
  }
  assert.equal(fake.calls.filter((call) => call.method !== "GET").length, writes);
});

test("read rejects modified preserved legacy, wrong ancestry and sequence rollback", async () => {
  for (const alter of [
    (state) => {
      state.legacy.state.history = [];
    },
    (state) => {
      state.previous = "c".repeat(40);
    },
    (state) => {
      state.sequence = 100;
    },
  ]) {
    const { fake, initial } = await migrated();
    const state = transition(initial);
    alter(state);
    fake.injectState(state);
    await assert.rejects(createGitHubSupervisorStore(fake.config).read());
  }
});

test("read rejects histories that claim an unrelated pinned ancestor", async () => {
  const { fake, initial } = await migrated();
  const request = async (method, path, body) => {
    const result = await fake.config.request(method, path, body);
    return path.includes("/compare/")
      ? { ...result, merge_base_commit: { sha: "d".repeat(40) } }
      : result;
  };
  await assert.rejects(
    createGitHubSupervisorStore({ ...fake.config, request }).read(),
    /pinned anchor/,
  );
  assert.equal(fake.refs.get(REF), initial.version);
});

test("repository and ref allowlists reject product branches, lookalikes and path tricks", () => {
  const fake = fakeGitHub();
  for (const ref of [
    "refs/heads/main",
    "refs/heads/governance/worker-receipts",
    "refs/heads/governance2/registry-318-v2",
    "refs/heads/governance2/supervisor-proof-",
    "refs/heads/governance2/supervisor-proof-../main",
    "refs/tags/governance2/supervisor-proof-example",
    "refs/heads/governance2/supervisor-proof-test\n",
  ])
    assert.throws(() => createGitHubSupervisorStore({ ...fake.config, ref }));
  assert.throws(() =>
    createGitHubSupervisorStore({ ...fake.config, repository: "someone/Demeter" }),
  );
  assert.doesNotThrow(() =>
    createGitHubSupervisorStore({ ...fake.config, ref: "refs/heads/governance2/registry-318-v1" }),
  );
  assert.equal(fake.calls.length, 0);
});

test("non-JSON, oversized and malformed state cannot be persisted", async () => {
  const { fake, initial, store } = await migrated();
  const writes = fake.calls.filter((call) => call.method !== "GET").length;
  for (const bad of [
    undefined,
    NaN,
    Infinity,
    1n,
    () => 1,
    new Date(),
    "x".repeat(3 * 1024 * 1024),
  ]) {
    const state = transition(initial, { bad });
    await assert.rejects(store.compareAndSwap(initial.version, state, { type: "invalid-json" }));
  }
  const sparse = transition(initial, { bad: Array(2) });
  await assert.rejects(store.compareAndSwap(initial.version, sparse, { type: "sparse" }));
  const array = [];
  array.toJSON = () => {
    throw new Error("A toJSON hook must never execute");
  };
  await assert.rejects(
    store.compareAndSwap(initial.version, transition(initial, { bad: array }), {
      type: "array-hook",
    }),
    /Plain dense JSON arrays/,
  );
  assert.equal(fake.calls.filter((call) => call.method !== "GET").length, writes);
});

test("returned state is detached from caller mutations and pinned store configuration", async () => {
  const { fake, store } = await migrated();
  const first = await store.read();
  first.state.legacy.state.entries = [];
  first.state.tasks.push({ task_id: "not-committed" });
  const again = await store.read();
  assert.deepEqual(again.state.legacy.state, fake.legacy);
  assert.deepEqual(again.state.tasks, []);
});

test("status projection is committed atomically with the authority and event on the same ref", async () => {
  const fake = fakeGitHub();
  const renderStatus = (state) =>
    `# Governance\nSequence: ${state.sequence}\nTasks: ${state.tasks.length}\n`;
  const config = { ...fake.config, renderStatus };
  const initial = await migrateSupervisorStore({ ...config, legacySnapshot: fake.snapshot });
  assert.equal(
    fake.blobs.get(fake.treeAt()["status.md"].sha).toString("utf8"),
    renderStatus(initial.state),
  );
  const store = createGitHubSupervisorStore(config);
  const next = transition(initial, { tasks: [{ task_id: "one-task" }] });
  const updated = await store.compareAndSwap(initial.version, next, { type: "admitted" });
  const tree = fake.treeAt(updated.version);
  assert.equal(fake.blobs.get(tree["status.md"].sha).toString("utf8"), renderStatus(updated.state));
  assert.deepEqual(fake.stateAt(updated.version), updated.state);
  assert.equal(Object.keys(tree).filter((path) => path.startsWith("events/")).length, 2);
  const treeWrites = fake.calls.filter(
    (call) => call.method === "POST" && call.endpoint.endsWith("/trees"),
  );
  assert.ok(treeWrites.every((call) => call.body.tree.some((entry) => entry.path === "status.md")));
  assert.equal(fake.calls.filter((call) => call.method === "PATCH").length, 2);
  assert.deepEqual([...fake.refs.keys()], [REF]);
  assert.deepEqual(await store.read(), updated);
});

test("a status renderer cannot mutate the authoritative state and status is never read as authority", async () => {
  const fake = fakeGitHub();
  const renderStatus = (state) => {
    state.tasks.push({ task_id: "rendered-only" });
    state.legacy.state.history = [];
    return "Projection text may never authorize a task.\n";
  };
  const initial = await migrateSupervisorStore({
    ...fake.config,
    renderStatus,
    legacySnapshot: fake.snapshot,
  });
  assert.deepEqual(initial.state.tasks, []);
  assert.deepEqual(initial.state.legacy, fake.snapshot);
  const store = createGitHubSupervisorStore(fake.config);
  fake.calls.length = 0;
  const readback = await store.read();
  assert.deepEqual(readback, initial);
  const statusSha = fake.treeAt()["status.md"].sha;
  assert.equal(
    fake.calls.filter((call) => call.endpoint.endsWith(`/blobs/${statusSha}`)).length,
    0,
  );
});

test("renderer failures and invalid output stop before any remote mutation", async () => {
  const renderers = [
    () => {
      throw new Error("renderer failed");
    },
    () => ({ markdown: "not a string" }),
    () => Promise.resolve("not synchronous"),
    () => "🟢".repeat(70_000),
  ];
  for (const renderStatus of renderers) {
    const { fake, initial } = await migrated();
    const writes = fake.calls.filter((call) => call.method !== "GET").length;
    const store = createGitHubSupervisorStore({ ...fake.config, renderStatus });
    await assert.rejects(
      store.compareAndSwap(initial.version, transition(initial), { type: "tick" }),
      { code: "RENDER_FAILED" },
    );
    assert.equal(fake.calls.filter((call) => call.method !== "GET").length, writes);
    assert.equal(fake.refs.get(REF), initial.version);
  }
  const fake = fakeGitHub();
  await assert.rejects(
    migrateSupervisorStore({
      ...fake.config,
      legacySnapshot: fake.snapshot,
      renderStatus: () => {
        throw new Error("migration renderer failed");
      },
    }),
    { code: "RENDER_FAILED" },
  );
  assert.equal(fake.calls.filter((call) => call.method !== "GET").length, 0);
});

test("an existing status projection is preserved when no renderer is configured", async () => {
  const fake = fakeGitHub({ initialStatus: "# Existing status\nPreserve this view.\n" });
  const originalStatus = fake.treeAt()["status.md"];
  const { initial, store } = await migrated(fake);
  assert.deepEqual(fake.treeAt()["status.md"], originalStatus);
  await store.compareAndSwap(initial.version, transition(initial), { type: "tick" });
  assert.deepEqual(fake.treeAt()["status.md"], originalStatus);
  const treeWrites = fake.calls.filter(
    (call) => call.method === "POST" && call.endpoint.endsWith("/trees"),
  );
  assert.ok(
    treeWrites.every((call) => !call.body.tree.some((entry) => entry.path === "status.md")),
  );
});

test("malformed Git reference objects, symlink registries and truncated trees are rejected", async () => {
  for (const corrupt of [
    (path, value) =>
      path.includes("/git/ref/") ? { ...value, object: { ...value.object, type: "tag" } } : value,
    (path, value) => (path.includes("/git/trees/") ? { ...value, truncated: true } : value),
    (path, value) =>
      path.includes("/git/trees/")
        ? {
            ...value,
            tree: value.tree.map((entry) =>
              entry.path === "registry.json" ? { ...entry, mode: "120000" } : entry,
            ),
          }
        : value,
    (path, value) =>
      path.includes("/git/commits/")
        ? { ...value, parents: [...value.parents, { sha: "f".repeat(40) }] }
        : value,
  ]) {
    const { fake } = await migrated();
    const request = async (method, path, body) =>
      corrupt(path, await fake.config.request(method, path, body));
    await assert.rejects(createGitHubSupervisorStore({ ...fake.config, request }).read());
  }
});

test("a same-anchor state with a forged low sequence cannot hide additional Git transitions", async () => {
  const { fake, initial, store } = await migrated();
  const first = await store.compareAndSwap(initial.version, transition(initial), { type: "one" });
  const forgedParent = clone(first.state);
  forgedParent.sequence = 1;
  forgedParent.previous = first.version;
  const parentVersion = fake.injectState(forgedParent, first.version);
  const forgedTip = clone(first.state);
  forgedTip.sequence = 2;
  forgedTip.previous = parentVersion;
  fake.injectState(forgedTip, parentVersion);
  await assert.rejects(createGitHubSupervisorStore(fake.config).read(), /pinned anchor/);
});
