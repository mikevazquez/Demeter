/** Durable stage reservations; never executes generated code or sends notifications. */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import {
  canonical,
  digest,
  invariant,
  validateState,
  initialState,
} from "./governance-evaluator.mjs";
import { readSourceVersion, ReadRecoveryBlocked } from "./governance-failures.mjs";
import {
  REPOSITORY,
  BRANCH,
  QUEUE,
  WORKFLOW,
  SharedLedger,
  githubClient,
  readFileAt,
  verifyCodeIdentity,
  observeShared,
  runShared,
  pages,
} from "./governance-shared.mjs";

const PREFIX = `/repos/${REPOSITORY}`;
const HEX = /^[a-f0-9]{40}$/;
const PHASES = [
  "select",
  "reserve-operations",
  "execute",
  "repair",
  "certify",
  "publish",
  "report",
];
const RESULTS = [
  "success",
  "failure",
  "timed_out",
  "cancelled",
  "skipped",
  "action_required",
  "neutral",
  "stale",
  "startup_failure",
];
const now = () => new Date().toISOString();

function checkContext(c) {
  invariant(typeof c.sourceSha === "string" && HEX.test(c.sourceSha), "execution SHA");
  invariant(Number.isSafeInteger(c.runId) && c.runId > 0, "execution run");
  invariant(Number.isSafeInteger(c.attempt) && c.attempt > 0, "execution attempt");
  invariant(typeof c.at === "string" && new Date(c.at).toISOString() === c.at, "execution clock");
}
function scope(state, profile) {
  validateState(state);
  initialState(profile);
  invariant(state.repository === REPOSITORY && state.controlBranch === BRANCH, "budget scope");
  invariant(profile.repository === REPOSITORY && profile.controlBranch === BRANCH, "profile scope");
}
function append(state, type, key, at, data) {
  const id = digest([type, key]);
  const old = state.events.find((e) => e.id === id);
  if (old) {
    invariant(canonical(old.data) === canonical(data), "conflicting operation receipt");
    return structuredClone(state);
  }
  return validateState({
    ...structuredClone(state),
    events: [...state.events, { id, type, at, data }],
  });
}

/** Reserves both existing stages once. No expiry/refresh resets the task ID's budget. */
export function reserveExecution(state, profile, context, selected) {
  scope(state, profile);
  checkContext(context);
  invariant(Array.isArray(selected) && selected.length <= profile.maxTasksPerRun, "selected batch");
  invariant(new Set(selected.map((t) => t.id)).size === selected.length, "duplicate selection");
  let next = structuredClone(state);
  const tasks = [],
    blocked = [];
  const delivered = new Set(state.events.flatMap((e) => e.data.delivered || []));
  for (const entry of selected) {
    const task = profile.tasks.find((t) => t.id === entry.id && t.status === "ready");
    invariant(task && typeof entry.recovery === "boolean", "admitted selection");
    if (delivered.has(task.id)) {
      blocked.push({ taskId: task.id, reason: "already-delivered" });
      continue;
    }
    // This path grants NO model call. prepare must recover and certify the actual branch.
    if (entry.recovery) {
      tasks.push({ id: task.id, recovery: true });
      continue;
    }
    const data = {
      taskId: task.id,
      contractHash: digest(task),
      sourceSha: context.sourceSha,
      runId: context.runId,
      runAttempt: context.attempt,
      maximumStages: 2,
    };
    const lease = next.events.find(
      (e) => e.type === "execution_lease" && e.data.taskId === task.id,
    );
    if (lease && canonical(lease.data) !== canonical(data)) {
      blocked.push({
        taskId: task.id,
        reason: "existing-generation-reservation",
        ownerRunId: lease.data.runId,
        ownerAttempt: lease.data.runAttempt,
      });
      continue;
    }
    next = append(next, "execution_lease", task.id, context.at, data);
    tasks.push({ id: task.id, recovery: false });
  }
  return { state: next, tasks, blocked };
}

/** Only the original run+attempt may use its stage; partial reruns have a new attempt. */
export function assertExecutionLease(state, profile, context, taskId, stage) {
  scope(state, profile);
  checkContext(context);
  invariant(stage === 1 || stage === 2, "generation stage");
  const task = profile.tasks.find((t) => t.id === taskId && t.status === "ready");
  const lease = state.events.find((e) => e.type === "execution_lease" && e.data.taskId === taskId);
  invariant(task && lease, "generation reservation required");
  invariant(
    lease.data.contractHash === digest(task) && lease.data.sourceSha === context.sourceSha,
    "generation contract changed",
  );
  invariant(
    lease.data.runId === context.runId && lease.data.runAttempt === context.attempt,
    "generation owner changed",
  );
  invariant(
    !state.events.some((e) => e.data.delivered?.includes(taskId)),
    "task already delivered",
  );
  invariant(
    !state.events.some(
      (e) =>
        e.type === "execution_outcome" &&
        e.data.runId === context.runId &&
        e.data.runAttempt === context.attempt &&
        e.data.taskId === taskId &&
        e.data.stage === stage,
    ),
    "stage already observed",
  );
  return true;
}
async function readScope(api, context) {
  checkContext(context);
  const ledger = new SharedLedger(api),
    current = await ledger.read();
  await verifyCodeIdentity(api, context.sourceSha, current.head);
  const profile = JSON.parse((await readFileAt(api, QUEUE, current.head)).text);
  scope(current.record.state, profile);
  return { ledger, current, profile };
}
export async function reserveSharedExecution(api, context, selected) {
  const { ledger, current, profile } = await readScope(api, context);
  const checked = await observeShared(api, context, current);
  invariant(checked.allowed, "operation source gate blocked");
  const eligible = checked.result.proposals[0]?.eligibleTaskIds || [];
  invariant(
    Array.isArray(selected) && selected.every((t) => eligible.includes(t.id)),
    "selection changed",
  );
  const reserved = reserveExecution(current.record.state, profile, context, selected);
  const saved = await ledger.commit(current, reserved.state, current.record.signature);
  // No output enabling a model call is returned until shared read-back succeeds.
  return {
    tasks: reserved.tasks,
    blocked: reserved.blocked,
    changed: saved.changed,
    revision: saved.record.sha256,
    sequence: saved.record.sequence,
    sourceSha: context.sourceSha,
    runId: context.runId,
    attempt: context.attempt,
  };
}
export async function checkSharedExecution(api, context, taskId, stage) {
  const { current, profile } = await readScope(api, context);
  const checked = await observeShared(api, context, current);
  invariant(
    checked.allowed && (checked.result.proposals[0]?.eligibleTaskIds || []).includes(taskId),
    "stage source gate blocked",
  );
  assertExecutionLease(current.record.state, profile, context, taskId, stage);
  return {
    allowed: true,
    taskId,
    stage,
    revision: current.record.sha256,
    runId: context.runId,
    attempt: context.attempt,
  };
}
/** Status is evidence of a job result, NOT evidence of its root cause. */
export async function collectOperationOutcomes(api, context, profile) {
  checkContext(context);
  const run = await api("GET", `${PREFIX}/actions/runs/${context.runId}`);
  invariant(
    run.id === context.runId &&
      run.head_sha === context.sourceSha &&
      run.head_branch === BRANCH &&
      run.path === WORKFLOW &&
      run.run_attempt === context.attempt,
    "outcome run identity",
  );
  const jobs = await pages(
    api,
    `${PREFIX}/actions/runs/${context.runId}/attempts/${context.attempt}/jobs`,
    "jobs",
  );
  const results = [];
  for (const job of jobs) {
    invariant(
      job.run_id === context.runId &&
        job.run_attempt === context.attempt &&
        job.head_sha === context.sourceSha &&
        Number.isSafeInteger(job.id) &&
        job.id > 0,
      "outcome job identity",
    );
    const match = /^(execute|repair) \(([a-zA-Z0-9_-]+), (?:true|false)\)$/.exec(job.name);
    const phase = match?.[1] || (PHASES.includes(job.name) ? job.name : null);
    if (!phase || job.status !== "completed") continue;
    const taskId = match?.[2] || null;
    if (taskId)
      invariant(
        profile.tasks.some((t) => t.id === taskId),
        "outcome admitted task",
      );
    invariant(RESULTS.includes(job.conclusion), "known job conclusion");
    if (!taskId && ["success", "skipped", "neutral"].includes(job.conclusion)) continue;
    const stage = phase === "execute" && taskId ? 1 : phase === "repair" && taskId ? 2 : null;
    const stepName =
      stage === 1
        ? "Execute task with Codex"
        : "Repair once using actual verifier feedback on a fresh runner";
    const step = stage ? job.steps?.find((s) => s.name === stepName) : null;
    results.push({
      taskId,
      stage,
      phase,
      sourceSha: context.sourceSha,
      runId: context.runId,
      runAttempt: context.attempt,
      jobId: job.id,
      result: job.conclusion,
      modelStep:
        step?.status === "completed" && RESULTS.includes(step.conclusion)
          ? step.conclusion
          : "not-established",
      cause: "not-established-by-job-status",
      automaticRerun: false,
    });
  }
  return results;
}
export function addOperationOutcomes(state, context, results) {
  checkContext(context);
  let next = structuredClone(state);
  invariant(Array.isArray(results), "outcome list");
  for (const r of results) {
    invariant(
      r.sourceSha === context.sourceSha &&
        r.runId === context.runId &&
        r.runAttempt === context.attempt,
      "outcome scope",
    );
    const data = {
      taskId: r.taskId,
      stage: r.stage,
      phase: r.phase,
      sourceSha: r.sourceSha,
      runId: r.runId,
      runAttempt: r.runAttempt,
      jobId: r.jobId,
      result: r.result,
      modelStep: r.modelStep,
      cause: "not-established-by-job-status",
      automaticRerun: false,
    };
    next = append(next, "execution_outcome", [r.runId, r.runAttempt, r.jobId], context.at, data);
  }
  return next;
}
export async function recordSharedOutcomes(api, context) {
  const { ledger, profile } = await readScope(api, context);
  const results = await collectOperationOutcomes(api, context, profile);
  // Persist known outcomes first; preserve the separate bounded observation-read recovery.
  const before = await ledger.read();
  await verifyCodeIdentity(api, context.sourceSha, before.head);
  const saved = await ledger.commit(
    before,
    addOperationOutcomes(before.record.state, context, results),
    before.record.signature,
  );
  const summary = await runShared(
    api,
    { ...context, sourceVersion: readSourceVersion(profile) },
    "record",
  );
  return {
    ...summary,
    changed: saved.changed || summary.changed,
    outcomes: results,
    noticesSent: false,
    diagnosis: "not-inferred-from-status",
  };
}
export function consolidateOperations(report, reservation, context) {
  invariant(
    report.sourceSha === context.sourceSha && String(report.runId) === String(context.runId),
    "report source",
  );
  if (!reservation) return { ...report, operations: { state: "unavailable", noticesSent: false } };
  invariant(
    reservation.sourceSha === context.sourceSha &&
      reservation.runId === context.runId &&
      reservation.attempt === context.attempt,
    "reservation report source",
  );
  const blocked = reservation.blocked || [];
  invariant(Array.isArray(blocked), "reservation blocks");
  return {
    ...report,
    tasks: report.tasks.map((t) =>
      blocked.some((b) => b.taskId === t.id)
        ? { ...t, state: "blocked", reason: "generation reserved; reconcile previous result" }
        : t,
    ),
    operations: {
      state: reservation.result === "blocked" || blocked.length ? "blocked" : "checked",
      revision: reservation.revision || null,
      blocked,
      noticesSent: false,
    },
  };
}
async function main() {
  invariant(
    process.env.GITHUB_REPOSITORY === REPOSITORY &&
      process.env.GITHUB_REF === `refs/heads/${BRANCH}` &&
      process.env.GITHUB_ACTOR === "mikevazquez",
    "operations runner scope",
  );
  const mode = process.argv[2];
  invariant(["reserve", "check", "record", "summarize"].includes(mode), "operations mode");
  const context = {
    sourceSha: process.env.GITHUB_SHA,
    runId: Number(process.env.GITHUB_RUN_ID),
    attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    at: now(),
  };
  if (mode === "summarize") {
    const dir = "/tmp/coordinator-report";
    const file = `/tmp/coordinator-report-input/coordinator-operations-${context.attempt}/reserve.json`;
    const result = consolidateOperations(
      JSON.parse(fs.readFileSync(`${dir}/report.json`, "utf8")),
      fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null,
      context,
    );
    fs.writeFileSync(`${dir}/report.json`, `${JSON.stringify(result, null, 2)}\n`);
    fs.appendFileSync(
      `${dir}/report.md`,
      `\n\nGeneration reservations: ${result.operations.state}. No notices sent.\n`,
    );
    return;
  }
  const api = githubClient(process.env.GH_TOKEN);
  let result;
  try {
    result =
      mode === "reserve"
        ? await reserveSharedExecution(api, context, JSON.parse(process.env.SELECTED_TASKS))
        : mode === "check"
          ? await checkSharedExecution(
              api,
              context,
              process.env.TASK_ID,
              Number(process.env.GENERATION_STAGE),
            )
          : await recordSharedOutcomes(api, { ...context, now });
  } catch (error) {
    result = {
      ...context,
      mode,
      result: "blocked",
      allowed: false,
      reason: error.code === "CONFLICT" ? "concurrent-change" : "technical-diagnosis-required",
      persistence: "not-confirmed",
      noticesSent: false,
      ...(error instanceof ReadRecoveryBlocked
        ? { readRecovery: { ...error.report, durable: true } }
        : {}),
    };
    process.exitCode = 1;
  }
  fs.mkdirSync("/tmp/governance-operations", { recursive: true });
  fs.writeFileSync(
    `/tmp/governance-operations/${mode}.json`,
    `${JSON.stringify(result, null, 2)}\n`,
  );
  if (mode === "record") {
    fs.mkdirSync("/tmp/governance-shared", { recursive: true });
    fs.writeFileSync("/tmp/governance-shared/record.json", `${JSON.stringify(result, null, 2)}\n`);
  }
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `tasks=${JSON.stringify(result.tasks || [])}\nhas_tasks=${!!result.tasks?.length}\nrevision=${result.revision || ""}\n`,
    );
  console.log(JSON.stringify(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    console.error("Governance operation failed closed");
    process.exitCode = 1;
  });
}
