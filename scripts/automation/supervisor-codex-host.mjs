// One operator-enabled host tick; same authority, dispatcher and verifier as Actions.
// No daemon, public listener, alternate queue, auto-login or automatic task admission.
import fs from "node:fs/promises";
import { constants, writeSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createGitHubSupervisorStore } from "./supervisor-store.mjs";
import {
  tickSupervisor,
  validateSupervisorState,
  supervisorContractSha256,
} from "./supervisor.mjs";
import {
  SUPERVISOR_CONFIG,
  createReceiptObserver,
  supervisorWorkerProfiles,
} from "./supervisor-runner.mjs";
import { parseSupervisorReceipts, verifySupervisorReceipt } from "./supervisor-evidence.mjs";
import {
  probeCodexManagedHost,
  codexManagedWorkerProfile,
  buildCodexManagedRegistration,
  inspectCodexManagedWorkspace,
  CODEX_MANAGED_WORKER_ID,
} from "./codex-managed-worker.mjs";
import { createManagedWorkerDispatch } from "./supervisor-managed-worker.mjs";
import { evaluateWorker } from "./worker-dispatch.mjs";
import { fetchWorkerStateSignals, applyWorkerStateSignals } from "./governance-worker-state.mjs";

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SHA = /^[a-f0-9]{40}$/;
const REPO = SUPERVISOR_CONFIG.repository;
const clone = (v) => JSON.parse(JSON.stringify(v));
const ensure = (ok, message) => {
  if (!ok) throw new Error(message);
};
const digest = supervisorContractSha256;
const receiptKeys = [
  "schema",
  "task_id",
  "attempt_id",
  "worker_id",
  "contract_sha256",
  "dispatch_fingerprint",
  "status",
  "base_sha",
  "current_sha",
  "files_changed",
  "commands_run",
  "tests_passed",
  "blockers",
  "remaining_work",
  "next_action",
].sort();

export function validateCodexHostConfig(config, executorSha) {
  ensure(
    config?.schema === "governance-codex-host-v1" && config.enabled === true,
    "Codex host activation is disabled",
  );
  ensure(
    config.repository === REPO && ID.test(config.host_id ?? ""),
    "Unreviewed host identity or repository",
  );
  ensure(
    SHA.test(config.executor_sha ?? "") && config.executor_sha === executorSha,
    "Host executor SHA differs from operator pin",
  );
  ensure(
    Array.isArray(config.allowed_task_ids) &&
      config.allowed_task_ids.length > 0 &&
      config.allowed_task_ids.length <= 100 &&
      new Set(config.allowed_task_ids).size === config.allowed_task_ids.length &&
      config.allowed_task_ids.every((id) => ID.test(id)),
    "Explicit host task scope required",
  );
  ensure(
    /^https:\/\/github\.com\/mikevazquez\/Demeter\/issues\/\d+$/.test(config.authorization ?? ""),
    "Host activation authorization reference required",
  );
  ensure(
    path.isAbsolute(config.workspace ?? "") && path.isAbsolute(config.receipt_directory ?? ""),
    "Absolute host directories required",
  );
  const relative = path.relative(config.workspace, config.receipt_directory);
  ensure(
    relative === ".." || relative.startsWith(`..${path.sep}`),
    "Receipt directory must be outside workspace",
  );
  ensure(
    Number.isSafeInteger(config.timeout_ms) &&
      config.timeout_ms >= 1000 &&
      config.timeout_ms <= 20 * 60_000,
    "Bounded host timeout required",
  );
  return config;
}

function sameWorkspace(workspace, contract) {
  return (
    contract.read_only === true &&
    contract.recovery?.mode === "read_only" &&
    contract.branch === workspace.branch &&
    contract.base_sha === workspace.head &&
    workspace.clean
  );
}

export function validateCodexHostReceipt(receipt, task, attempt) {
  ensure(
    JSON.stringify(Object.keys(receipt ?? {}).sort()) === JSON.stringify(receiptKeys),
    "Unexpected host receipt fields",
  );
  const entries = parseSupervisorReceipts([
    {
      body: JSON.stringify(receipt),
      user: { login: "mikevazquez" },
      html_url: "https://github.com/mikevazquez/Demeter/issues/341#issuecomment-1",
    },
  ]);
  ensure(entries.length === 1, "Structured worker receipt required");
  ensure(
    receipt.task_id === task.task_id &&
      receipt.attempt_id === attempt.attempt_id &&
      receipt.worker_id === CODEX_MANAGED_WORKER_ID &&
      receipt.contract_sha256 === task.contract_sha256 &&
      attempt.contract_sha256 === task.contract_sha256 &&
      receipt.dispatch_fingerprint === attempt.dispatch_fingerprint,
    "Host receipt identity mismatch",
  );
  ensure(
    receipt.base_sha === task.contract.base_sha &&
      receipt.current_sha === task.contract.base_sha &&
      receipt.files_changed.length === 0,
    "Read-only host receipt changed workspace",
  );
  digest(receipt); // Same 64 KiB canonical bound used by durable publication identity.
  return clone(receipt);
}

async function readReceipt(filename) {
  const handle = await fs.open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    ensure(
      stat.isFile() && stat.size > 0 && stat.size <= 128 * 1024,
      "Bounded worker receipt file required",
    );
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}

async function updateAttempt(store, taskId, attemptId, change, event, now) {
  for (let retry = 0; retry < 3; retry++) {
    const snapshot = await store.read();
    validateSupervisorState(snapshot.state);
    const next = clone(snapshot.state),
      task = next.tasks.find((t) => t.task_id === taskId),
      attempt = task?.attempts.at(-1);
    ensure(
      next.active_task_id === taskId && attempt?.attempt_id === attemptId,
      "Host attempt is no longer active",
    );
    const changed = change(attempt, task);
    if (!changed) return { snapshot, claimed: false };
    const time = new Date(now()).toISOString();
    next.sequence++;
    next.previous = snapshot.version;
    next.updated_at = time;
    next.last_tick_at = time;
    validateSupervisorState(next);
    try {
      return {
        snapshot: await store.compareAndSwap(snapshot.version, next, {
          type: event,
          task_id: taskId,
          attempt_id: attemptId,
          at: time,
        }),
        claimed: true,
      };
    } catch (error) {
      if (error.code !== "CAS_CONFLICT") throw error;
    }
  }
  throw new Error("Host evidence CAS could not be confirmed");
}

async function publishReceipt({ store, request, task, attempt, hostId, observe, now }) {
  const record = attempt.codex_host_result;
  ensure(
    attempt.managed_launch_claim?.host_id === hostId && record?.host_id === hostId,
    "Receipt belongs to a different host",
  );
  ensure(
    record.proof?.process_group_closed === true &&
      record.proof.process_exit_observed === true &&
      record.proof.terminal_observed === true &&
      record.proof.exit_code === 0 &&
      record.proof.status === "completed",
    "Host process closure is not proven",
  );
  const receipt = validateCodexHostReceipt(record.receipt, task, attempt),
    fingerprint = digest(receipt);
  ensure(
    record.proof.task_id === task.task_id &&
      record.proof.attempt_id === attempt.attempt_id &&
      record.proof.worker_id === CODEX_MANAGED_WORKER_ID &&
      record.proof.contract_sha256 === task.contract_sha256 &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
        record.proof.session_id ?? "",
      ),
    "Host process proof identity mismatch",
  );
  const found = await observe({ task, attempt });
  if (found) {
    ensure(digest(found.receipt) === digest(receipt), "Conflicting host receipt publication");
    return;
  }
  const claim = await updateAttempt(
    store,
    task.task_id,
    attempt.attempt_id,
    (a) => {
      if (a.codex_host_publication_claim) {
        ensure(
          a.codex_host_publication_claim.receipt_sha256 === fingerprint,
          "Host publication claim changed",
        );
        return false;
      }
      a.codex_host_publication_claim = { host_id: hostId, receipt_sha256: fingerprint };
      return true;
    },
    "codex_host_receipt_publication_claim",
    now,
  );
  if (!claim.claimed) return; // Lost acknowledgement is reconciled by GET; never POST twice.
  try {
    await request("POST", `repos/${REPO}/issues/341/comments`, {
      body: `GOVERNANCE_WORKER_RECEIPT_V2\n\`\`\`json\n${JSON.stringify(receipt, null, 2)}\n\`\`\`\n\nCodex worker report relayed by the registered host after verified process closure. Independent verification remains required.`,
    });
  } catch {
    // The publication may have succeeded. Retain the claim and let the observer GET it.
    return;
  }
}

const policy = {
  repositories: [REPO],
  require_baseline_ci: true,
  allowed_sources: [
    {
      author: "mikevazquez",
      channel: "github_issue_comment",
      worker_id: CODEX_MANAGED_WORKER_ID,
      receipt_url_prefix: `https://github.com/${REPO}/issues/341#issuecomment-`,
    },
  ],
};

export async function runCodexHostTick({
  config,
  executorSha,
  store,
  request,
  owner,
  probeHost = probeCodexManagedHost,
  inspectWorkspace = inspectCodexManagedWorkspace,
  makeDispatch = createManagedWorkerDispatch,
  now = () => new Date(),
}) {
  validateCodexHostConfig(config, executorSha);
  ensure(owner === "mikevazquez", "Codex host requires the configured owner identity");
  ensure(typeof request === "function" && store, "Host authority adapters required");
  await fs.mkdir(config.receipt_directory, { recursive: true, mode: 0o700 });
  const physicalWorkspace = await fs.realpath(config.workspace);
  const physicalReceipts = await fs.realpath(config.receipt_directory);
  const physicalRelative = path.relative(physicalWorkspace, physicalReceipts);
  ensure(
    physicalRelative === ".." || physicalRelative.startsWith(`..${path.sep}`),
    "Receipt directory resolves inside workspace",
  );
  const observe = createReceiptObserver(request);
  const verify = (input) => verifySupervisorReceipt({ ...input, request, policy });
  const snapshot = await store.read();
  validateSupervisorState(snapshot.state);
  const active = snapshot.state.tasks.find((t) => t.task_id === snapshot.state.active_task_id);
  if (active) {
    const attempt = active.attempts.at(-1);
    if (
      !config.allowed_task_ids.includes(active.task_id) ||
      attempt.worker_id !== CODEX_MANAGED_WORKER_ID ||
      (attempt.managed_host_id ?? attempt.managed_launch_claim?.host_id) !== config.host_id
    )
      return { ...snapshot, action: "foreign_active_task" };
    if (!active.contract.read_only) return { ...snapshot, action: "unsupported_host_task" };
    if (attempt.codex_host_result) {
      const workspace = inspectWorkspace(config.workspace);
      ensure(
        sameWorkspace(workspace, active.contract),
        "Host workspace changed before reconciliation",
      );
      await publishReceipt({
        store,
        request,
        task: active,
        attempt,
        hostId: config.host_id,
        observe,
        now,
      });
    }
    // Observation may close an existing attempt, but this path can never launch a model.
    return tickSupervisor({
      store,
      workers: [],
      dispatch: async () => {
        throw new Error("Reconciliation cannot dispatch");
      },
      observe,
      verify,
      observerId: config.host_id,
    });
  }
  const workspace = inspectWorkspace(config.workspace);
  let allowed = snapshot.state.tasks
    .filter(
      (t) =>
        config.allowed_task_ids.includes(t.task_id) &&
        sameWorkspace(workspace, t.contract) &&
        ["queued", "paused_capacity"].includes(t.status),
    )
    .map((t) => t.task_id);
  if (!allowed.length) return { ...snapshot, action: "no_matching_host_task" };
  const remotelyPinned = [];
  for (const id of allowed) {
    const c = snapshot.state.tasks.find((t) => t.task_id === id).contract;
    const ref = await request(
      "GET",
      `repos/${REPO}/git/ref/heads/${c.branch.split("/").map(encodeURIComponent).join("/")}`,
    );
    if (
      ref?.ref === `refs/heads/${c.branch}` &&
      ref.object?.type === "commit" &&
      ref.object.sha === c.base_sha
    )
      remotelyPinned.push(id);
  }
  allowed = remotelyPinned;
  if (!allowed.length) return { ...snapshot, action: "remote_host_workspace_drift" };
  const probe = probeHost();
  let profile = codexManagedWorkerProfile({ probe });
  if (profile.state !== "available") return { ...snapshot, action: "host_disconnected" };
  const signals = await fetchWorkerStateSignals(request, {
    allowedWorkers: supervisorWorkerProfiles().map((worker) => worker.workerId),
  });
  [profile] = applyWorkerStateSignals([profile], signals);
  if (profile.state !== "available") return { ...snapshot, action: "host_unavailable" };
  profile.permissions = [...profile.permissions, "receipt:write"]; // Parent relay only; subprocess has no GitHub credentials.
  allowed = allowed.filter((id) => {
    const task = snapshot.state.tasks.find((t) => t.task_id === id),
      c = task.contract;
    return evaluateWorker(
      {
        taskId: id,
        category: c.category,
        requiredCapabilities: c.required_capabilities ?? ["repository_review"],
        requiredPermissions: c.required_permissions ?? ["repository:read"],
        qualityFloor: c.quality_floor ?? 0.8,
        riskTier: c.risk_tier ?? 0,
      },
      profile,
    ).eligible;
  });
  if (!allowed.length) return { ...snapshot, action: "no_eligible_host_task" };
  profile.allowedTaskIds = allowed;
  profile.managedHostId = config.host_id;
  const dispatch = async (input) => {
    const { task, attempt } = input;
    ensure(
      allowed.includes(task.task_id) && task.contract.read_only,
      "Host task escaped its registration scope",
    );
    await fs.mkdir(config.receipt_directory, { recursive: true, mode: 0o700 });
    const directory = await fs.mkdtemp(
      path.join(config.receipt_directory, `${attempt.attempt_id}-`),
    );
    const outputFile = path.join(directory, "receipt.json");
    const registration = buildCodexManagedRegistration({
      cwd: config.workspace,
      timeoutMs: config.timeout_ms,
      outputFile,
      inspectWorkspace,
    });
    registration.hostId = config.host_id;
    const baseInput = registration.inputForTask;
    registration.inputForTask = (value) =>
      baseInput(value) +
      "\nReturn only one raw JSON governance-worker-receipt-v2 object, no markdown. Copy task_id, worker_id, attempt_id, contract_sha256 and dispatch_fingerprint exactly from the delivery. Include status (completed, blocked or failed), base_sha, current_sha, files_changed, commands_run, tests_passed, blockers, remaining_work and next_action. Report only commands and checks actually executed; never fabricate tests. Use blocked when required work or checks cannot be completed. Do not publish the receipt yourself; the host relays it. No other fields.";
    const outcome = await makeDispatch({ store, registration, now })(input);
    if (outcome.status !== "delivered") return outcome;
    try {
      ensure(
        outcome.proof?.exit_code === 0 &&
          outcome.process_group_closed &&
          outcome.process_exit_observed,
        "Host process not closed",
      );
      ensure(
        sameWorkspace(inspectWorkspace(config.workspace), task.contract),
        "Host workspace drift after process",
      );
      const receipt = validateCodexHostReceipt(await readReceipt(outputFile), task, attempt);
      await updateAttempt(
        store,
        task.task_id,
        attempt.attempt_id,
        (a) => {
          ensure(a.managed_launch_claim?.host_id === config.host_id, "Host launch claim changed");
          a.codex_host_result = { host_id: config.host_id, receipt, proof: clone(outcome.proof) };
          return true;
        },
        "codex_host_result",
        now,
      );
      const current = await store.read(),
        persisted = current.state.tasks.find((t) => t.task_id === task.task_id);
      await publishReceipt({
        store,
        request,
        task: persisted,
        attempt: persisted.attempts.at(-1),
        hostId: config.host_id,
        observe,
        now,
      });
      return outcome;
    } catch {
      return {
        status: "unknown",
        failure_class: "host_receipt_reconciliation_required",
        terminal_observed: outcome.terminal_observed,
        process_group_closed: outcome.process_group_closed,
      };
    }
  };
  const result = await tickSupervisor({
    store,
    workers: [profile],
    dispatch,
    observe,
    verify,
    observerId: config.host_id,
  });
  if (result.action !== "delivered") return result;
  return tickSupervisor({
    store,
    workers: [],
    dispatch: async () => {
      throw new Error("Verification cannot dispatch");
    },
    observe,
    verify,
    observerId: config.host_id,
  });
}

export function createCodexHostGitHubRequest({ spawnImpl = spawnSync } = {}) {
  return async (method, endpoint, body) => {
    const api = `repos/${REPO}`;
    ensure(
      ["GET", "POST", "PATCH"].includes(method) &&
        typeof endpoint === "string" &&
        endpoint.startsWith(`${api}/`) &&
        !endpoint.split(/[/?]/).includes("..") &&
        !/[\r\n#]/.test(endpoint),
      "Host request outside repository",
    );
    if (method === "POST")
      ensure(
        ["blobs", "trees", "commits"].some((kind) => endpoint === `${api}/git/${kind}`) ||
          endpoint === `${api}/issues/341/comments`,
        "Host mutation outside registry or receipt channel",
      );
    if (method === "PATCH")
      ensure(
        endpoint === `${api}/git/refs/${SUPERVISOR_CONFIG.authorityRef.slice(5)}` &&
          body?.force === false &&
          SHA.test(body.sha ?? ""),
        "Host registry updates must fast-forward",
      );
    const args = ["api", endpoint, "--method", method];
    if (body !== undefined) args.push("--input", "-");
    const result = spawnImpl("gh", args, {
      encoding: "utf8",
      input: body === undefined ? undefined : JSON.stringify(body),
      timeout: 30000,
      maxBuffer: 5 * 1024 * 1024,
    });
    if (result.status !== 0) {
      const error = new Error("Configured GitHub CLI request failed");
      error.httpStatus =
        Number(String(result.stderr ?? "").match(/HTTP (\d{3})/)?.[1]) || undefined;
      throw error;
    }
    return JSON.parse(result.stdout);
  };
}

async function main() {
  ensure(
    process.argv[2] === "tick" && process.argv[3],
    "Usage: supervisor-codex-host.mjs tick /trusted/host-config.json",
  );
  const config = JSON.parse(await fs.readFile(process.argv[3], "utf8"));
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const head = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" });
  ensure(head.status === 0, "Host executor identity unavailable");
  validateCodexHostConfig(config, head.stdout.trim());
  const status = spawnSync("git", ["-C", root, "status", "--porcelain", "--untracked-files=all"], {
    encoding: "utf8",
  });
  ensure(
    status.status === 0 && status.stdout.trim() === "",
    "Host executor checkout must be clean",
  );
  const identity = spawnSync("gh", ["api", "user", "--jq", ".login"], {
    encoding: "utf8",
    timeout: 15000,
    maxBuffer: 4096,
  });
  ensure(
    identity.status === 0 && identity.stdout.trim() === "mikevazquez",
    "Configured GitHub owner required",
  );
  const request = createCodexHostGitHubRequest();
  const store = createGitHubSupervisorStore({
    repository: REPO,
    ref: SUPERVISOR_CONFIG.authorityRef,
    anchorSha: SUPERVISOR_CONFIG.anchorSha,
    legacySha256: SUPERVISOR_CONFIG.legacySha256,
    request,
  });
  const result = await runCodexHostTick({
    config,
    executorSha: head.stdout.trim(),
    owner: identity.stdout.trim(),
    request,
    store,
  });
  writeSync(
    1,
    JSON.stringify({
      action: result.action,
      registry_version: result.version,
      active_task_id: result.state.active_task_id,
    }) + "\n",
  );
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => {
    writeSync(
      2,
      "Codex host stopped; inspect retained evidence and configured access. No automatic replay.\n",
    );
    process.exitCode = 1;
  });
