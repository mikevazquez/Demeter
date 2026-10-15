/** Shared journal bridge. Fixed repository, branch and data path; no generated code executes here. */
import { createHash } from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import {
  canonical,
  digest,
  evaluateGovernance,
  initialState,
  invariant,
  validateState,
} from "./governance-evaluator.mjs";

export const REPOSITORY = "mikevazquez/Demeter";
export const BRANCH = "chore/governance-autonomous-coordinator-20261015";
export const JOURNAL = "docs/automation/governance-state.json";
export const QUEUE = ".github/codex-coordinator/queue.json";
export const POLICY = ".github/codex-coordinator/notion-policy.txt";
export const WORKFLOW = ".github/workflows/governance-codex-coordinator.yml";
const PREFIX = `/repos/${REPOSITORY}`;
const REF = `heads/${BRANCH}`;
const MAX_BYTES = 4 * 1024 * 1024;
const hash = (text) => createHash("sha256").update(text).digest("hex");
const isSha = (value) => typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
const activeStates = ["queued", "pending", "waiting", "requested", "in_progress"];

export class SharedConflict extends Error {
  constructor() {
    super("Shared Governance changed; reconcile before a new write");
    this.code = "CONFLICT";
  }
}

/** Fixed origin, no redirects, bounded JSON and sanitized errors. This is not a token-scope sandbox. */
export function githubClient(token, fetcher = globalThis.fetch) {
  invariant(typeof token === "string" && token.length > 0, "GitHub connection");
  return async (method, route, body) => {
    invariant(
      route.startsWith(`${PREFIX}/`) &&
        !/[\\\r\n#]/.test(route) &&
        (!route.includes("..") ||
          new RegExp(`^${PREFIX}/compare/[a-f0-9]{40}\\.\\.\\.[a-f0-9]{40}$`).test(route)),
      "GitHub route",
    );
    const writable =
      (method === "POST" && [`${PREFIX}/git/trees`, `${PREFIX}/git/commits`].includes(route)) ||
      (method === "PATCH" && route === `${PREFIX}/git/refs/${REF}` && body?.force === false);
    invariant(method === "GET" || writable, "denied GitHub action");
    if (method === "POST" && route.endsWith("/git/trees")) {
      invariant(
        isSha(body?.base_tree) &&
          body.tree?.length === 1 &&
          body.tree[0].path === JOURNAL &&
          body.tree[0].mode === "100644" &&
          body.tree[0].type === "blob" &&
          typeof body.tree[0].content === "string",
        "journal-only tree",
      );
      openState(body.tree[0].content);
    }
    if (method === "POST" && route.endsWith("/git/commits")) {
      invariant(
        isSha(body?.tree) &&
          body.parents?.length === 1 &&
          isSha(body.parents[0]) &&
          body.message === "chore(governance): persist scoped controller observation",
        "journal-only commit",
      );
    }
    if (method === "PATCH") invariant(isSha(body?.sha), "journal ref SHA");
    let response;
    try {
      response = await fetcher(`https://api.github.com${route}`, {
        method,
        redirect: "error",
        signal: AbortSignal.timeout(20000),
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    } catch {
      const error = new Error("GitHub transport outcome unknown; read before retrying");
      error.code = "TRANSPORT_UNKNOWN";
      throw error;
    }
    if (!response.ok) {
      const error = new Error(`GitHub request failed with HTTP ${response.status}`);
      error.status = response.status;
      error.code =
        response.status === 401
          ? "CREDENTIAL"
          : response.status === 403
            ? "PERMISSION_OR_RATE_LIMIT"
            : "HTTP";
      throw error;
    }
    invariant(
      Number(response.headers.get("content-length") || 0) <= MAX_BYTES,
      "GitHub response size",
    );
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        invariant(size <= MAX_BYTES, "GitHub response size");
        chunks.push(Buffer.from(value));
      }
    } finally {
      await reader.cancel();
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  };
}

async function head(api) {
  const ref = await api("GET", `${PREFIX}/git/ref/${REF}`);
  invariant(
    ref.ref === `refs/${REF}` && ref.object?.type === "commit" && isSha(ref.object.sha),
    "control ref identity",
  );
  return ref.object.sha;
}

export async function readFileAt(api, path, ref) {
  invariant([QUEUE, JOURNAL, POLICY].includes(path) && isSha(ref), "fixed file/ref");
  const file = await api("GET", `${PREFIX}/contents/${path}?ref=${ref}`);
  invariant(
    file.type === "file" && file.path === path && file.encoding === "base64" && isSha(file.sha),
    "file identity",
  );
  invariant(
    typeof file.content === "string" && file.content.length <= MAX_BYTES * 1.5,
    "encoded file size",
  );
  const bytes = Buffer.from(file.content, "base64");
  invariant(bytes.length === file.size && bytes.length <= MAX_BYTES, "file bytes");
  invariant(
    createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex") === file.sha,
    "blob integrity",
  );
  return { text: bytes.toString("utf8"), sha: file.sha };
}

function successor(previous, next) {
  validateState(next);
  invariant(next.repository === REPOSITORY && next.controlBranch === BRANCH, "journal scope");
  invariant(next.events.length >= previous.events.length, "history deletion");
  invariant(
    canonical(next.events.slice(0, previous.events.length)) === canonical(previous.events),
    "history rewrite",
  );
}

export function sealState(state, sequence = 0, parent = null, signature = null) {
  validateState(state);
  const data = { version: 1, sequence, parent, signature, state };
  return { ...data, sha256: digest(data) };
}

export function openState(text) {
  invariant(Buffer.byteLength(text) <= MAX_BYTES, "journal capacity");
  const record = JSON.parse(text);
  const { sha256, ...data } = record;
  invariant(
    canonical(Object.keys(record).sort()) ===
      canonical(["version", "sequence", "parent", "signature", "state", "sha256"].sort()),
    "journal fields",
  );
  invariant(sha256 === digest(data), "journal digest");
  invariant(
    data.version === 1 && Number.isSafeInteger(data.sequence) && data.sequence >= 0,
    "journal sequence",
  );
  invariant(
    data.sequence === 0
      ? data.parent === null && data.state.events.length === 0
      : typeof data.parent === "string" && /^[a-f0-9]{64}$/.test(data.parent),
    "journal parent",
  );
  invariant(
    data.signature === null ||
      (typeof data.signature === "string" && /^[a-f0-9]{64}$/.test(data.signature)),
    "journal signature",
  );
  validateState(data.state);
  invariant(
    data.state.repository === REPOSITORY && data.state.controlBranch === BRANCH,
    "journal scope",
  );
  return record;
}

/** Git history is the shared backing store; missing state never silently reinitializes. */
export class SharedLedger {
  constructor(api) {
    this.api = api;
  }
  async read() {
    const controlHead = await head(this.api);
    const file = await readFileAt(this.api, JOURNAL, controlHead);
    return { head: controlHead, blob: file.sha, record: openState(file.text) };
  }
  async commit(current, state, signature) {
    successor(current.record.state, state);
    if (canonical(current.record.state) === canonical(state)) return { ...current, changed: false };
    if ((await head(this.api)) !== current.head) throw new SharedConflict();
    const commit = await this.api("GET", `${PREFIX}/git/commits/${current.head}`);
    invariant(commit.sha === current.head && isSha(commit.tree?.sha), "commit identity");
    const record = sealState(state, current.record.sequence + 1, current.record.sha256, signature);
    const content = `${JSON.stringify(record, null, 2)}\n`;
    invariant(Buffer.byteLength(content) <= MAX_BYTES, "journal capacity");
    const tree = await this.api("POST", `${PREFIX}/git/trees`, {
      base_tree: commit.tree.sha,
      tree: [{ path: JOURNAL, mode: "100644", type: "blob", content }],
    });
    invariant(isSha(tree.sha), "tree SHA");
    const next = await this.api("POST", `${PREFIX}/git/commits`, {
      message: "chore(governance): persist scoped controller observation",
      tree: tree.sha,
      parents: [current.head],
    });
    invariant(isSha(next.sha), "commit SHA");
    try {
      await this.api("PATCH", `${PREFIX}/git/refs/${REF}`, { sha: next.sha, force: false });
    } catch (error) {
      const actual = await this.read();
      if (actual.record.sha256 === record.sha256)
        return { ...actual, changed: true, recovered: true };
      if (error.status === 409 || error.status === 422 || actual.head !== current.head)
        throw new SharedConflict();
      throw error;
    }
    const actual = await this.read();
    invariant(actual.record.sha256 === record.sha256, "published journal read-back");
    return { ...actual, changed: true, recovered: false };
  }
}

/** A partial page is not an empty set. Bound exhaustion and changing totals fail closed. */
export async function pages(api, route, key = null) {
  const output = [];
  let total = null;
  for (let page = 1; page <= 10; page += 1) {
    const data = await api(
      "GET",
      `${route}${route.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
    );
    const items = key === null ? data : data[key];
    invariant(Array.isArray(items) && items.length <= 100, "page shape");
    if (key !== null) {
      invariant(Number.isSafeInteger(data.total_count) && data.total_count >= 0, "page total");
      total ??= data.total_count;
      invariant(total === data.total_count, "pagination drift");
    }
    output.push(...items);
    if (items.length < 100 || (total !== null && output.length >= total)) {
      invariant(total === null || output.length === total, "incomplete pagination");
      return output;
    }
  }
  throw new Error("Incomplete Governance pagination; no absence presumed");
}

export async function verifyCodeIdentity(api, sourceSha, currentHead) {
  invariant(isSha(sourceSha) && isSha(currentHead), "source SHA");
  if (sourceSha === currentHead) return;
  const diff = await api("GET", `${PREFIX}/compare/${sourceSha}...${currentHead}`);
  invariant(
    diff.status === "ahead" &&
      diff.behind_by === 0 &&
      diff.merge_base_commit?.sha === sourceSha &&
      Array.isArray(diff.files) &&
      diff.files.length === 1 &&
      diff.files[0].filename === JOURNAL &&
      diff.files[0].status === "modified",
    "concurrent control code changed",
  );
}

/** Complete typed observations only. No issue body or customer data is retained. */
export async function observeShared(api, context, current) {
  await verifyCodeIdentity(api, context.sourceSha, current.head);
  const queue = await readFileAt(api, QUEUE, current.head);
  const profile = JSON.parse(queue.text);
  invariant(
    profile.repository === REPOSITORY &&
      profile.controlBranch === BRANCH &&
      profile.source.snapshotPath === POLICY,
    "admitted profile scope",
  );
  initialState(profile);
  const snapshot = await readFileAt(api, POLICY, current.head);
  const fresh =
    Date.parse(profile.source.capturedAt) <= Date.parse(context.at) &&
    Date.parse(profile.source.expiresAt) > Date.parse(context.at);
  const hosted = profile.hostedController;
  const policyComplete =
    fresh &&
    hash(snapshot.text) === profile.source.sha256 &&
    hosted?.mode === "chatgpt-hosted" &&
    hosted.notionLastEditedAt === profile.source.lastEditedAt &&
    hosted.notionCheckedAt === profile.source.capturedAt;
  const issues = [];
  const prs = [];
  for (const task of profile.tasks) {
    invariant(/^[a-zA-Z0-9_-]+$/.test(task.id), "admitted task ID");
    const issue = await api("GET", `${PREFIX}/issues/${task.issueNumber}`);
    invariant(
      issue.number === task.issueNumber &&
        !issue.pull_request &&
        ["open", "closed"].includes(issue.state) &&
        typeof issue.body === "string",
      "issue identity",
    );
    issues.push({
      number: issue.number,
      state: issue.state,
      bodySha256: hash(issue.body),
      updatedAt: issue.updated_at,
    });
    const matches = await pages(
      api,
      `${PREFIX}/pulls?state=all&head=${encodeURIComponent(`mikevazquez:automation/codex/${task.id}`)}`,
    );
    for (const pr of matches) {
      invariant(
        pr.head?.repo?.full_name === REPOSITORY &&
          pr.head.ref === `automation/codex/${task.id}` &&
          Number.isSafeInteger(pr.number),
        "PR source identity",
      );
      prs.push({
        repository: REPOSITORY,
        taskId: task.id,
        headBranch: pr.head.ref,
        number: pr.number,
        state: pr.merged_at ? "merged" : pr.state,
      });
    }
  }
  const currentRun = await api("GET", `${PREFIX}/actions/runs/${context.runId}`);
  invariant(
    currentRun.id === context.runId &&
      currentRun.head_sha === context.sourceSha &&
      currentRun.head_branch === BRANCH &&
      currentRun.path === WORKFLOW &&
      currentRun.run_attempt === context.attempt,
    "originating run identity",
  );
  const activeRuns = new Map();
  for (const status of activeStates) {
    const runs = await pages(
      api,
      `${PREFIX}/actions/runs?branch=${encodeURIComponent(BRANCH)}&status=${status}`,
      "workflow_runs",
    );
    for (const run of runs) {
      invariant(
        Number.isSafeInteger(run.id) &&
          run.repository?.full_name === REPOSITORY &&
          run.head_branch === BRANCH,
        "run repository",
      );
      if (run.id !== context.runId && run.path === WORKFLOW) activeRuns.set(run.id, run);
    }
  }
  const observation = {
    repository: REPOSITORY,
    controlBranch: BRANCH,
    cycleId: `run/${context.runId}/attempt/${context.attempt}`,
    capturedAt: context.at,
    controlSha: context.sourceSha,
    queueBlobSha: queue.sha,
    policy: {
      complete: policyComplete,
      pageId: profile.source.pageId,
      lastEditedAt: profile.source.lastEditedAt,
      snapshotSha256: hash(snapshot.text),
    },
    issues: { complete: true, items: issues },
    pullRequests: { complete: true, items: prs },
    runs: {
      complete: true,
      items: [...activeRuns.values()].map((run) => ({
        repository: run.repository.full_name,
        controlBranch: run.head_branch,
        status: run.status,
      })),
    },
  };
  const result = evaluateGovernance(profile, observation, current.record.state);
  const cycle = result.state.events.findLast((event) => event.type === "cycle");
  const signature = digest({
    queue: queue.sha,
    findings: cycle.data.findings,
    delivered: cycle.data.delivered,
    outcome: cycle.data.outcome,
  });
  return {
    result,
    signature,
    policyMode: "hosted-dated-snapshot",
    allowed: fresh && cycle.data.outcome !== "blocked",
    observation,
  };
}

/** gate reads; record writes only the journal; recover checks an exact expected revision. */
export async function runShared(api, context, mode, expectedRevision = null) {
  invariant(["gate", "record", "recover"].includes(mode), "bridge mode");
  invariant(
    isSha(context.sourceSha) &&
      Number.isSafeInteger(context.runId) &&
      context.runId > 0 &&
      Number.isSafeInteger(context.attempt) &&
      context.attempt > 0,
    "run context",
  );
  const ledger = new SharedLedger(api);
  const current = await ledger.read();
  await verifyCodeIdentity(api, context.sourceSha, current.head);
  if (mode === "recover") {
    invariant(
      typeof expectedRevision === "string" && current.record.sha256 === expectedRevision,
      "expected shared revision",
    );
    return {
      mode,
      allowed: false,
      changed: false,
      recovered: true,
      revision: current.record.sha256,
      sequence: current.record.sequence,
      journalHead: current.head,
    };
  }
  const knownCycle = current.record.state.events.find(
    (event) => event.id === digest(["cycle", `run/${context.runId}/attempt/${context.attempt}`]),
  );
  if (knownCycle) {
    invariant(knownCycle.data.controlSha === context.sourceSha, "recorded cycle source identity");
    return {
      mode,
      allowed: false,
      changed: false,
      recovered: true,
      revision: current.record.sha256,
      sequence: current.record.sequence,
      journalHead: current.head,
      eligibleTaskIds: [],
    };
  }
  const checked = await observeShared(api, context, current);
  const cycle = checked.result.state.events.findLast((event) => event.type === "cycle");
  const summary = {
    mode,
    sourceSha: context.sourceSha,
    runId: context.runId,
    attempt: context.attempt,
    policyMode: checked.policyMode,
    allowed: checked.allowed,
    revision: current.record.sha256,
    sequence: current.record.sequence,
    journalHead: current.head,
    changed: false,
    eligibleTaskIds: checked.result.proposals[0]?.eligibleTaskIds || [],
    delivered: cycle.data.delivered,
    findings: cycle.data.findings,
    notices: checked.result.notices,
    noticesSent: false,
    runtimeUat: false,
    productionAuthorized: false,
  };
  if (
    mode === "record" &&
    checked.signature !== current.record.signature &&
    !checked.result.replay
  ) {
    const saved = await ledger.commit(current, checked.result.state, checked.signature);
    Object.assign(summary, {
      revision: saved.record.sha256,
      sequence: saved.record.sequence,
      journalHead: saved.head,
      changed: saved.changed,
      recovered: saved.recovered,
    });
  }
  return summary;
}

export function admitSelected(tasks, gate) {
  invariant(gate.allowed === true, "blocked gate");
  invariant(Array.isArray(tasks) && Array.isArray(gate.eligibleTaskIds), "selection arrays");
  invariant(
    tasks.every((task) => typeof task.id === "string"),
    "selected task identity",
  );
  return tasks.filter((task) => gate.eligibleTaskIds.includes(task.id));
}

async function main() {
  invariant(
    process.env.GITHUB_REPOSITORY === REPOSITORY &&
      process.env.GITHUB_REF === `refs/${REF}` &&
      process.env.GITHUB_ACTOR === "mikevazquez",
    "hosted execution scope",
  );
  const mode = process.argv[2];
  if (mode === "admit") {
    const gate = JSON.parse(fs.readFileSync("/tmp/governance-shared/gate.json", "utf8"));
    const tasks = admitSelected(JSON.parse(process.env.SELECTED_TASKS), gate);
    invariant(typeof process.env.GITHUB_OUTPUT === "string", "output file");
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `tasks=${JSON.stringify(tasks)}\nhas_tasks=${tasks.length > 0}\n`,
    );
    return;
  }
  const context = {
    sourceSha: process.env.GITHUB_SHA,
    runId: Number(process.env.GITHUB_RUN_ID),
    attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    at: new Date().toISOString(),
  };
  const result = await runShared(
    githubClient(process.env.GH_TOKEN),
    context,
    mode,
    process.env.EXPECTED_REVISION || null,
  );
  fs.mkdirSync("/tmp/governance-shared", { recursive: true });
  fs.writeFileSync(`/tmp/governance-shared/${mode}.json`, `${JSON.stringify(result, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `allowed=${result.allowed}\nrevision=${result.revision}\nchanged=${result.changed}\n`,
    );
  console.log(JSON.stringify(result));
  if (mode === "gate" && !result.allowed)
    throw new Error("Governance gate blocked; no execution admitted");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
