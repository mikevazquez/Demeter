import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "coordinator-test-"));
const snapshot = path.join(temporary, "notion.txt");
fs.writeFileSync(snapshot, "approved policy fixture");
const issueBody = "Admitted work order fixture";
const task = {
  id: "test-v1",
  issueNumber: 1,
  issueBodySha256: sha(issueBody),
  issueUpdatedAt: "2026-10-15T09:00:00Z",
  owner: "codex-1",
  status: "ready",
  kind: "documentation",
  allowedPaths: ["docs/automation/test.md"],
  requiredText: ["TEST-MARKER"],
  checks: [],
};
const config = {
  version: 1,
  repository: "mikevazquez/Demeter",
  controlBranch: "chore/governance-autonomous-coordinator-20261015",
  maxTasksPerRun: 2,
  source: {
    pageId: "3fad78f7146381e9a97fc3c454e6516a",
    capturedAt: new Date(Date.now() - 60000).toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    snapshotPath: snapshot,
    sha256: sha("approved policy fixture"),
    lastEditedAt: "2026-10-15T07:49:26.240Z",
  },
  tasks: [task],
};
const configFile = path.join(temporary, "queue.json");
fs.writeFileSync(configFile, JSON.stringify(config));
process.env.COORDINATOR_CONFIG = configFile;
process.env.CONTROL_SHA = "a".repeat(40);
process.env.GITHUB_RUN_ID = "test-run";
process.env.GITHUB_OUTPUT = path.join(temporary, "outputs");
process.env.GITHUB_STEP_SUMMARY = path.join(temporary, "summary");
const { validateConfig, validateFiles, assertIssue, main, branchFor } =
  await import("../../scripts/codex-coordinator.mjs");
const clone = () => structuredClone(config);
const issue = () => ({ state: "open", body: issueBody, updated_at: task.issueUpdatedAt });
const files = () => [
  {
    path: task.allowedPaths[0],
    mode: "100644",
    deleted: false,
    content:
      "# TEST-MARKER\nA complete deterministic validation fixture with useful documentation.",
  },
];

test("admits bounded development task with fresh Notion evidence", () =>
  assert.equal(validateConfig(clone()).tasks.length, 1));
test("blocks stale Notion context", () => {
  const c = clone();
  c.source.expiresAt = new Date(Date.now() - 1).toISOString();
  assert.throws(() => validateConfig(c), /expired/);
});
test("blocks an unbounded freshness window", () => {
  const c = clone();
  c.source.expiresAt = new Date(Date.now() + 72 * 3600000).toISOString();
  assert.throws(() => validateConfig(c), /48 hours/);
});
test("blocks duplicate task identities", () => {
  const c = clone();
  c.tasks.push(structuredClone(c.tasks[0]));
  assert.throws(() => validateConfig(c), /duplicate/);
});
test("blocks overlapping task file scopes", () => {
  const c = clone();
  c.tasks.push({ ...c.tasks[0], id: "test-v2" });
  assert.throws(() => validateConfig(c), /overlap/);
});
for (const name of [
  "../README.md",
  "docs/automation/../README.md",
  ".github/workflows/prod.yml",
  "supabase/migrations/prod.sql",
  "docs/automation/AGENTS.md",
])
  test(`rejects protected/traversal path ${name}`, () => {
    const c = clone();
    c.tasks[0].allowedPaths = [name];
    assert.throws(() => validateConfig(c));
  });
test("code task requires independent checks", () => {
  const c = clone();
  c.tasks[0].kind = "code";
  c.tasks[0].allowedPaths = ["lib/example.ts"];
  assert.throws(() => validateConfig(c), /require checks/);
});
test("rejects arbitrary shell admission", () => {
  const c = clone();
  c.tasks[0].checks = [["bash", "-c", "echo bad"]];
  assert.throws(() => validateConfig(c), /check command/);
});
test("issue edits invalidate admission", () =>
  assert.throws(() => assertIssue(task, { ...issue(), body: "changed" }), /changed/));
test("closed issue invalidates admission", () =>
  assert.throws(() => assertIssue(task, { ...issue(), state: "closed" }), /open issue/));
test("accepts useful plain Markdown result", () =>
  assert.equal(validateFiles(task, files()), true));
test("rejects out-of-scope output", () =>
  assert.throws(() => validateFiles(task, [{ ...files()[0], path: "README.md" }]), /Scope/));
test("rejects symlink file mode", () =>
  assert.throws(() => validateFiles(task, [{ ...files()[0], mode: "120000" }]), /regular/));
test("rejects executable file mode", () =>
  assert.throws(() => validateFiles(task, [{ ...files()[0], mode: "100755" }]), /regular/));
test("rejects binary output", () =>
  assert.throws(
    () => validateFiles(task, [{ ...files()[0], content: "\0" + files()[0].content }]),
    /Binary/,
  ));
test("rejects deleted files", () =>
  assert.throws(() => validateFiles(task, [{ ...files()[0], deleted: true }]), /nondeleted/));
test("rejects missing acceptance marker", () =>
  assert.throws(
    () =>
      validateFiles(task, [
        { ...files()[0], content: "A fairly long document with no acceptance marker at all." },
      ]),
    /criterion/,
  ));
test("rejects empty changes", () => assert.throws(() => validateFiles(task, []), /No changes/));
test("task branch stable across retries", () =>
  assert.equal(branchFor(task), "automation/codex/test-v1"));

test("selection skips PRs in every state without generating again", async () => {
  const original = globalThis.fetch;
  try {
    for (const state of ["open", "closed", "merged"]) {
      globalThis.fetch = async (url) =>
        new Response(
          JSON.stringify(
            String(url).includes("/pulls?")
              ? [{ state, html_url: "https://github.com/example/pr" }]
              : { object: { sha: "b".repeat(40) } },
          ),
          { status: 200 },
        );
      await main("select");
      const result = JSON.parse(fs.readFileSync("/tmp/coordinator-selection.json"));
      assert.deepEqual(result.selected, []);
      assert.equal(result.skipped.length, 1);
    }
  } finally {
    globalThis.fetch = original;
  }
});

test("selection detects an orphan publication for automatic recovery", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (url) =>
      new Response(
        JSON.stringify(
          String(url).includes("/pulls?")
            ? []
            : String(url).includes("/issues/")
              ? issue()
              : { object: { sha: "b".repeat(40) } },
        ),
        { status: 200 },
      );
    await main("select");
    assert.deepEqual(JSON.parse(fs.readFileSync("/tmp/coordinator-selection.json")).selected, [
      { id: "test-v1", recovery: true },
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

test("live Notion change stops selection rather than silently using stale context", async () => {
  const original = globalThis.fetch;
  process.env.CODEX_NOTION_TOKEN = "fixture-only";
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ last_edited_time: "2026-10-16T00:00:00Z", archived: false }), {
        status: 200,
      });
    await assert.rejects(main("select"), /policy changed/);
  } finally {
    globalThis.fetch = original;
    delete process.env.CODEX_NOTION_TOKEN;
  }
});

test("publisher rejects forged artifact provenance before repository mutation", async () => {
  const folder = path.join(temporary, "forged");
  fs.mkdirSync(path.join(folder, "task"), { recursive: true });
  fs.writeFileSync(
    path.join(folder, "task", "coordinator-result.json"),
    JSON.stringify({
      id: task.id,
      certified: true,
      validated: true,
      sourceSha: "wrong",
      runId: "test-run",
    }),
  );
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      throw new Error("Unexpected network mutation");
    };
    await assert.rejects(main("publish", folder), /provenance/);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

test("publisher makes one draft PR and safely deduplicates a second run", async () => {
  const folder = path.join(temporary, "valid");
  fs.mkdirSync(path.join(folder, "task"), { recursive: true });
  const result = {
    id: task.id,
    certified: true,
    validated: true,
    sourceSha: process.env.CONTROL_SHA,
    runId: "test-run",
    contractHash: sha(JSON.stringify(task)),
    files: files(),
    filesHash: sha(JSON.stringify(files())),
    attempt: 1,
  };
  fs.writeFileSync(path.join(folder, "task", "coordinator-result.json"), JSON.stringify(result));
  const original = globalThis.fetch;
  let published = false;
  let mutations = 0;
  let pulls = 0;
  try {
    globalThis.fetch = async (url, options = {}) => {
      const endpoint = new URL(url).pathname.replace("/repos/mikevazquez/Demeter/", "");
      const method = options.method || "GET";
      let data;
      if (method === "POST") {
        mutations++;
        const body = JSON.parse(options.body);
        if (endpoint === "pulls") {
          assert.equal(body.draft, true);
          assert.equal(body.base, config.controlBranch);
          pulls++;
          published = true;
          data = { html_url: "https://github.com/mikevazquez/Demeter/pull/999" };
        } else if (endpoint === "git/trees") {
          assert.deepEqual(
            body.tree.map((x) => x.path),
            task.allowedPaths,
          );
          data = { sha: "tree" };
        } else data = { sha: "result" };
      } else if (endpoint === "pulls")
        data = published ? [{ html_url: "https://github.com/mikevazquez/Demeter/pull/999" }] : [];
      else if (endpoint.startsWith("issues/")) data = issue();
      else if (endpoint.startsWith("git/ref/")) return new Response("", { status: 404 });
      else if (endpoint.startsWith("git/commits/")) data = { tree: { sha: "base-tree" } };
      else throw new Error(`Unexpected endpoint ${endpoint}`);
      return new Response(JSON.stringify(data), { status: 200 });
    };
    await main("publish", folder);
    const first = mutations;
    await main("publish", folder);
    assert.equal(pulls, 1);
    assert.equal(mutations, first);
  } finally {
    globalThis.fetch = original;
  }
});

test("real verifier retry accepts a repaired result and rejects later scope expansion", () => {
  const workspace = path.join(temporary, "workspace");
  fs.mkdirSync(workspace);
  const run = (...args) =>
    execFileSync("git", args, { cwd: workspace, encoding: "utf8", stdio: "pipe" });
  run("init");
  run(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--allow-empty",
    "-m",
    "fixture",
  );
  const controlSha = run("rev-parse", "HEAD").trim();
  fs.writeFileSync(
    "/tmp/coordinator-task.json",
    JSON.stringify({
      task,
      contractHash: sha(JSON.stringify(task)),
      sourceSha: controlSha,
      runId: "test-run",
      source: config.source,
    }),
  );
  const script = fileURLToPath(new URL("../../scripts/codex-coordinator.mjs", import.meta.url));
  const out = path.join(temporary, "retry-output");
  const invoke = (attempt) =>
    execFileSync(process.execPath, [script, "verify", task.id, String(attempt)], {
      cwd: workspace,
      env: { ...process.env, CONTROL_SHA: controlSha, GITHUB_OUTPUT: out },
      encoding: "utf8",
    });
  fs.writeFileSync("/tmp/coordinator-prompt.txt", "Admitted fixture prompt");
  fs.mkdirSync(path.join(workspace, "docs/automation"), { recursive: true });
  fs.writeFileSync(
    path.join(workspace, task.allowedPaths[0]),
    "A long enough initial document that misses the required marker.",
  );
  invoke(1);
  assert.equal(fs.existsSync("/tmp/coordinator-result.json"), false);
  assert.equal(JSON.parse(fs.readFileSync("/tmp/coordinator-failure.json")).retryable, true);
  fs.writeFileSync(path.join(workspace, task.allowedPaths[0]), files()[0].content);
  invoke(2);
  assert.equal(JSON.parse(fs.readFileSync("/tmp/coordinator-result.json")).attempt, 2);
  fs.writeFileSync(path.join(workspace, "unapproved.txt"), "scope expansion");
  invoke(3);
  assert.equal(fs.existsSync("/tmp/coordinator-result.json"), false);
  assert.equal(JSON.parse(fs.readFileSync("/tmp/coordinator-failure.json")).retryable, false);
});

test.after(() => {
  fs.rmSync(temporary, { recursive: true, force: true });
});
