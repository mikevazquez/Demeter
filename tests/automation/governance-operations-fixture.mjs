// Synthetic GitHub transport used only by the operations tests; no external calls.
import { createHash } from "node:crypto";
import { initialState } from "../../scripts/governance-evaluator.mjs";
import {
  REPOSITORY,
  BRANCH,
  JOURNAL,
  QUEUE,
  POLICY,
  WORKFLOW,
  sealState,
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
export const ctx = (runId = 10, h = 18) => ({ sourceSha: S, runId, attempt: 1, at: utc(h) });
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
export function fixture() {
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
        run_attempt: f.runAttempt || 1,
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
