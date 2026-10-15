import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { initialState } from "../../scripts/governance-evaluator.mjs";
import {
  REPOSITORY,
  BRANCH,
  JOURNAL,
  QUEUE,
  POLICY,
  WORKFLOW,
  SharedLedger,
  SharedConflict,
  githubClient,
  sealState,
  runShared,
  pages,
  admitSelected,
} from "../../scripts/governance-shared.mjs";

const P = `/repos/${REPOSITORY}`;
const S = "a".repeat(40);
const utc = (h) => `2026-10-15T${String(h).padStart(2, "0")}:00:00.000Z`;
const hash = (s) => createHash("sha256").update(s).digest("hex");
const blob = (s) =>
  createHash("sha1")
    .update(`blob ${Buffer.byteLength(s)}\0`)
    .update(s)
    .digest("hex");
const ctx = (runId = 10, h = 18) => ({ sourceSha: S, runId, attempt: 1, at: utc(h) });
function profile() {
  return {
    version: 1,
    repository: REPOSITORY,
    controlBranch: BRANCH,
    maxTasksPerRun: 3,
    source: {
      pageId: "b".repeat(32),
      lastEditedAt: utc(14),
      capturedAt: utc(15),
      expiresAt: "2026-10-17T15:00:00.000Z",
      snapshotPath: POLICY,
      sha256: hash("policy"),
    },
    hostedController: {
      mode: "chatgpt-hosted",
      notionCheckedAt: utc(15),
      notionLastEditedAt: utc(14),
    },
    tasks: [
      {
        id: "accepted-v1",
        owner: "codex-1",
        status: "ready",
        issueNumber: 1,
        issueBodySha256: hash("task"),
        issueUpdatedAt: utc(14),
      },
    ],
  };
}
function fixture() {
  const p = profile();
  let seq = 1;
  const f = {
    profile: p,
    calls: [],
    current: S,
    files: new Map(),
    trees: new Map(),
    commits: new Map(),
    prs: true,
    active: [],
    missing: false,
    race: false,
    lost: false,
    codeChanged: false,
  };
  const first = {
    [QUEUE]: JSON.stringify(p),
    [POLICY]: "policy",
    [JOURNAL]: JSON.stringify(sealState(initialState(p))),
  };
  f.files.set(S, first);
  f.commits.set(S, { sha: S, tree: { sha: "b".repeat(40) } });
  f.trees.set("b".repeat(40), first);
  f.raw = async (method, route, body) => {
    f.calls.push({ method, route, body });
    if (method === "GET" && route === `${P}/git/ref/heads/${BRANCH}`)
      return { ref: `refs/heads/${BRANCH}`, object: { type: "commit", sha: f.current } };
    if (method === "GET" && route.startsWith(`${P}/contents/`)) {
      const url = new URL(`https://api.github.com${route}`);
      const path = url.pathname.slice(`${P}/contents/`.length);
      if (f.missing && path === JOURNAL) throw Object.assign(new Error("404"), { status: 404 });
      const text = f.files.get(url.searchParams.get("ref"))[path];
      return {
        type: "file",
        path,
        sha: blob(text),
        size: Buffer.byteLength(text),
        encoding: "base64",
        content: Buffer.from(text).toString("base64"),
      };
    }
    if (method === "GET" && route.startsWith(`${P}/compare/`))
      return {
        status: "ahead",
        behind_by: 0,
        merge_base_commit: { sha: S },
        files: [{ filename: f.codeChanged ? "app/page.tsx" : JOURNAL, status: "modified" }],
      };
    if (method === "GET" && route === `${P}/issues/1`)
      return { number: 1, state: "open", body: f.issueBody ?? "task", updated_at: utc(14) };
    if (method === "GET" && route.startsWith(`${P}/pulls?`))
      return f.prs
        ? [
            {
              number: 20,
              state: "open",
              head: {
                ref: "automation/codex/accepted-v1",
                repo: { full_name: f.foreign ? "foreign/repo" : REPOSITORY },
              },
            },
          ]
        : [];
    if (method === "GET" && /\/actions\/runs\/\d+$/.test(route))
      return {
        id: Number(route.split("/").at(-1)),
        head_sha: f.badRun ? "e".repeat(40) : S,
        head_branch: BRANCH,
        path: WORKFLOW,
        run_attempt: 1,
      };
    if (method === "GET" && route.startsWith(`${P}/actions/runs?`)) {
      const status = new URL(`https://api.github.com${route}`).searchParams.get("status");
      const runs = f.active.filter((r) => r.status === status);
      return { total_count: runs.length, workflow_runs: runs };
    }
    if (method === "GET" && route.startsWith(`${P}/git/commits/`))
      return f.commits.get(route.split("/").at(-1));
    if (method === "POST" && route === `${P}/git/trees`) {
      const sha = String(++seq).padStart(40, "0");
      f.trees.set(sha, { ...f.trees.get(body.base_tree), [JOURNAL]: body.tree[0].content });
      return { sha };
    }
    if (method === "POST" && route === `${P}/git/commits`) {
      const sha = String(++seq).padStart(40, "0");
      f.commits.set(sha, { sha, tree: { sha: body.tree }, parents: body.parents });
      f.files.set(sha, f.trees.get(body.tree));
      return { sha };
    }
    if (method === "PATCH") {
      if (f.race) {
        f.race = false;
        f.current = "f".repeat(40);
        f.files.set(f.current, first);
        throw Object.assign(new Error("conflict"), { status: 422 });
      }
      f.current = body.sha;
      if (f.lost) {
        f.lost = false;
        throw new Error("lost response");
      }
      return {};
    }
    throw new Error(`Unexpected mock API ${method} ${route}`);
  };
  f.api = async (...args) => f.raw(...args);
  f.writes = () => f.calls.filter((c) => c.method !== "GET");
  f.changeProfile = () => {
    first[QUEUE] = JSON.stringify(p);
  };
  return f;
}

test("SHARED-01 gate reads existing publication and never writes", async () => {
  const f = fixture();
  const r = await runShared(f.api, ctx(), "gate");
  assert.equal(r.allowed, true);
  assert.deepEqual(r.eligibleTaskIds, []);
  assert.deepEqual(r.delivered, ["accepted-v1"]);
  assert.equal(f.writes().length, 0);
});
test("SHARED-02 only unchanged ready issue is eligible", async () => {
  const f = fixture();
  f.prs = false;
  assert.deepEqual((await runShared(f.api, ctx(), "gate")).eligibleTaskIds, ["accepted-v1"]);
  f.issueBody = "changed";
  assert.deepEqual((await runShared(f.api, ctx(), "gate")).eligibleTaskIds, []);
});
test("SHARED-03 real store boundary records then fresh client recovers revision", async () => {
  const f = fixture();
  const r = await runShared(f.api, ctx(), "record");
  assert.equal(r.changed, true);
  assert.equal(r.sequence, 1);
  assert.equal(f.writes().length, 3);
  const fresh = async (...args) => f.raw(...args);
  const back = await runShared(fresh, ctx(11, 19), "recover", r.revision);
  assert.equal(back.recovered, true);
  assert.equal(back.changed, false);
  assert.equal(back.revision, r.revision);
});
test("SHARED-04 repeated idle cycle does not create commits", async () => {
  const f = fixture();
  const first = await runShared(f.api, ctx(), "record");
  const count = f.writes().length;
  const second = await runShared(f.api, ctx(11, 19), "record");
  assert.equal(second.changed, false);
  assert.equal(second.revision, first.revision);
  assert.equal(f.writes().length, count);
});
test("SHARED-05 interrupted record recovers without repeating PATCH", async () => {
  const f = fixture();
  f.lost = true;
  const r = await runShared(f.api, ctx(), "record");
  assert.equal(r.recovered, true);
  assert.equal(f.calls.filter((c) => c.method === "PATCH").length, 1);
  const again = await runShared(f.api, ctx(), "record");
  assert.equal(again.recovered, true);
  assert.equal(f.calls.filter((c) => c.method === "PATCH").length, 1);
});
test("SHARED-06 404 is not permission to initialize history", async () => {
  const f = fixture();
  f.missing = true;
  await assert.rejects(runShared(f.api, ctx(), "record"), /404/);
  assert.equal(f.writes().length, 0);
});
test("SHARED-07 corrupt journal refuses all writes", async () => {
  const f = fixture();
  const value = JSON.parse(f.files.get(S)[JOURNAL]);
  value.sha256 = "f".repeat(64);
  f.files.get(S)[JOURNAL] = JSON.stringify(value);
  await assert.rejects(runShared(f.api, ctx(), "record"), /journal digest/);
  assert.equal(f.writes().length, 0);
});
test("SHARED-08 stale base is rejected before Git object creation", async () => {
  const f = fixture();
  const l = new SharedLedger(f.api);
  const stale = await l.read();
  await runShared(f.api, ctx(), "record");
  const next = (await l.read()).record.state;
  const count = f.writes().length;
  await assert.rejects(l.commit(stale, next, "c".repeat(64)), SharedConflict);
  assert.equal(f.writes().length, count);
});
test("SHARED-09 race at ref update stops without force or retry", async () => {
  const f = fixture();
  f.race = true;
  await assert.rejects(runShared(f.api, ctx(), "record"), SharedConflict);
  const patches = f.calls.filter((c) => c.method === "PATCH");
  assert.equal(patches.length, 1);
  assert.equal(patches[0].body.force, false);
});
test("SHARED-10 append-only store rejects history deletion and rewrite", async () => {
  const f = fixture();
  await runShared(f.api, ctx(), "record");
  const l = new SharedLedger(f.api);
  const s = await l.read();
  await assert.rejects(l.commit(s, initialState(f.profile), "c".repeat(64)), /history deletion/);
  const modified = structuredClone(s.record.state);
  modified.events[0].data.outcome = "forged";
  await assert.rejects(l.commit(s, modified, "c".repeat(64)), /history rewrite/);
});
test("SHARED-11 expired or unbound policy blocks execution", async () => {
  for (const mode of ["expiry", "hash", "marker", "version"]) {
    const f = fixture();
    if (mode === "expiry") f.profile.source.expiresAt = utc(17);
    if (mode === "hash") f.profile.source.sha256 = "f".repeat(64);
    if (mode === "marker") delete f.profile.hostedController;
    if (mode === "version") f.profile.hostedController.notionLastEditedAt = utc(13);
    f.changeProfile();
    assert.equal((await runShared(f.api, ctx(), "gate")).allowed, false);
    assert.equal(f.writes().length, 0);
  }
});
test("SHARED-12 every other active coordinator state blocks execution", async () => {
  for (const status of ["queued", "pending", "waiting", "requested", "in_progress"]) {
    const f = fixture();
    f.active = [
      {
        id: 999,
        status,
        path: WORKFLOW,
        repository: { full_name: REPOSITORY },
        head_branch: BRANCH,
      },
    ];
    assert.equal((await runShared(f.api, ctx(), "gate")).allowed, false);
  }
});
test("SHARED-13 current run is not a self-deadlock", async () => {
  const f = fixture();
  f.active = [
    {
      id: 10,
      status: "in_progress",
      path: WORKFLOW,
      repository: { full_name: REPOSITORY },
      head_branch: BRANCH,
    },
  ];
  assert.equal((await runShared(f.api, ctx(), "gate")).allowed, true);
});
test("SHARED-14 code drift invalidates old worker", async () => {
  const f = fixture();
  await runShared(f.api, ctx(), "record");
  f.codeChanged = true;
  await assert.rejects(runShared(f.api, ctx(11), "gate"), /control code changed/);
});
test("SHARED-15 wrong origin and foreign PR are rejected", async () => {
  for (const flag of ["badRun", "foreign"]) {
    const f = fixture();
    f[flag] = true;
    await assert.rejects(runShared(f.api, ctx(), "record"), /identity/);
    assert.equal(f.writes().length, 0);
  }
});
test("SHARED-16 partial pagination cannot certify absence", async () => {
  await assert.rejects(
    pages(async () => ({ total_count: 2, jobs: [] }), `${P}/jobs`, "jobs"),
    /incomplete pagination/,
  );
});
test("SHARED-17 pagination counts must remain consistent", async () => {
  let n = 0;
  await assert.rejects(
    pages(
      async () => ({ total_count: ++n === 1 ? 101 : 102, jobs: Array(n === 1 ? 100 : 2).fill({}) }),
      `${P}/jobs`,
      "jobs",
    ),
    /pagination drift/,
  );
});
test("SHARED-18 selector cannot enlarge admitted task set", () => {
  assert.deepEqual(
    admitSelected([{ id: "one" }, { id: "foreign" }], { allowed: true, eligibleTaskIds: ["one"] }),
    [{ id: "one" }],
  );
  assert.throws(() => admitSelected([], { allowed: false, eligibleTaskIds: [] }), /blocked gate/);
});
test("SHARED-19 exact expected revision required for recovery", async () => {
  const f = fixture();
  await assert.rejects(
    runShared(f.api, ctx(), "recover", "e".repeat(64)),
    /expected shared revision/,
  );
  assert.equal(f.writes().length, 0);
});
test("SHARED-20 HTTP writer rejects main, force, arbitrary files and repository", async () => {
  let calls = 0;
  const api = githubClient("test-token", async () => {
    calls++;
    return new Response("{}");
  });
  for (const args of [
    ["PATCH", `${P}/git/refs/heads/main`, { sha: S, force: false }],
    ["PATCH", `${P}/git/refs/heads/${BRANCH}`, { sha: S, force: true }],
    [
      "POST",
      `${P}/git/trees`,
      {
        base_tree: S,
        tree: [{ path: "app/page.tsx", mode: "100644", type: "blob", content: "bad" }],
      },
    ],
    ["GET", "/repos/other/repo/contents/x"],
  ])
    await assert.rejects(api(...args));
  assert.equal(calls, 0);
});
test("SHARED-21 HTTP errors and transport never disclose secret", async () => {
  const token = "test-secret-do-not-print";
  for (const fetcher of [
    async () => {
      throw new Error(token);
    },
    async () => new Response(token, { status: 401 }),
  ]) {
    await assert.rejects(
      githubClient(token, fetcher)("GET", `${P}/issues/1`),
      (err) => !err.message.includes(token),
    );
  }
});
test("SHARED-22 compare endpoint accepted without allowing parent traversal", async () => {
  let calls = 0;
  const api = githubClient("test-token", async () => {
    calls++;
    return new Response("{}");
  });
  await api("GET", `${P}/compare/${S}...${"f".repeat(40)}`);
  await assert.rejects(api("GET", `${P}/contents/../secrets`));
  assert.equal(calls, 1);
});
test("SHARED-23 response bound rejects declared oversized data", async () => {
  const api = githubClient(
    "test-token",
    async () => new Response("{}", { headers: { "content-length": "999999999" } }),
  );
  await assert.rejects(api("GET", `${P}/issues/1`), /response size/);
});
test("SHARED-24 HTTP writer calls only fixed journal path with no force", async () => {
  const f = fixture();
  const api = githubClient(
    "test-token",
    async (url, options) =>
      new Response(
        JSON.stringify(
          await f.raw(
            options.method,
            url.replace("https://api.github.com", ""),
            options.body ? JSON.parse(options.body) : undefined,
          ),
        ),
      ),
  );
  const r = await runShared(api, ctx(), "record");
  assert.equal(r.changed, true);
  const writes = f.writes();
  assert.deepEqual(
    writes.map((c) => c.method),
    ["POST", "POST", "PATCH"],
  );
  assert.equal(writes[0].body.tree[0].path, JOURNAL);
  assert.equal(writes[2].route, `${P}/git/refs/heads/${BRANCH}`);
});
test("SHARED-25 persisted state is informational, never UAT or production approval", async () => {
  const f = fixture();
  const r = await runShared(f.api, ctx(), "record");
  assert.equal(r.productionAuthorized, false);
  assert.equal(r.runtimeUat, false);
  assert.equal(r.noticesSent, false);
  assert.equal(r.policyMode, "hosted-dated-snapshot");
  assert.ok(!JSON.stringify((await new SharedLedger(f.api).read()).record).includes('"body"'));
});
