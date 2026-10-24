// Executes one explicitly registered local worker for an already reserved task.
// The supervisor owns admission, CAS launch intent, retry budget and completion gates.
import path from "node:path";
import { runManagedWorker } from "./supervisor-process.mjs";
import {
  recordSupervisorActivity,
  supervisorContractSha256,
  validateSupervisorState,
} from "./supervisor.mjs";

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SESSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVITY_INTERVAL_MS = 60_000;
const CALLBACK_TIMEOUT_MS = 2000;
const ACTIVITY = new Set([
  "thread.started",
  "turn.started",
  "item.started",
  "item.updated",
  "item.completed",
  "turn.completed",
  "turn.failed",
]);
const TERMINAL = new Set(["turn.completed", "turn.failed"]);
const copy = (value) => JSON.parse(JSON.stringify(value));
const ensure = (condition, message) => {
  if (!condition) throw new TypeError(message);
};

async function bounded(callback, timeoutMs = CALLBACK_TIMEOUT_MS) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(callback),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Managed observer deadline")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function managedRuntimeEnvironment(source = process.env, profile = "isolated") {
  ensure(["isolated", "codex-chatgpt"].includes(profile), "Invalid managed environment profile");
  // Selectors and transport only; never provider keys, GitHub tokens or product variables.
  // The registered executor must be provisioned separately; this adapter never logs in.
  const keys = ["PATH", "TMPDIR", "LANG", "LC_ALL"];
  if (profile === "codex-chatgpt")
    keys.push(
      "HOME",
      "CODEX_HOME",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "ALL_PROXY",
      "NO_PROXY",
      "http_proxy",
      "https_proxy",
      "all_proxy",
      "no_proxy",
      "SSL_CERT_FILE",
      "SSL_CERT_DIR",
      "NODE_EXTRA_CA_CERTS",
    );
  return Object.fromEntries(
    keys.filter((name) => typeof source[name] === "string").map((name) => [name, source[name]]),
  );
}

function safePath(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 250 &&
    !/[\\\u0000-\u001f\u007f]/.test(value) &&
    !path.isAbsolute(value) &&
    value
      .split("/")
      .every(
        (part) =>
          part && part !== "." && part !== ".." && part !== ".git" && !/^\.env(?:\.|$)/.test(part),
      )
  );
}

function allowedPath(value, allowedPaths) {
  return (
    safePath(value) &&
    allowedPaths.some((allowed) => {
      const prefix = allowed.endsWith("/**")
        ? allowed.slice(0, -3)
        : allowed.endsWith("/")
          ? allowed.slice(0, -1)
          : null;
      return prefix === null ? value === allowed : value.startsWith(`${prefix}/`);
    })
  );
}

// Only independently reconciled commit/file references enter the durable ledger.
// Freeform model text, stdout, stderr, prompts and arbitrary checkpoint keys are dropped.
function checkpointMetadata(checkpoint, task) {
  ensure(checkpoint && typeof checkpoint === "object", "Independent checkpoint required");
  ensure(
    SHA.test(checkpoint.current_sha ?? "") && checkpoint.branch === task.contract.branch,
    "Checkpoint commit or branch mismatch",
  );
  ensure(
    checkpoint.task_id === undefined || checkpoint.task_id === task.task_id,
    "Checkpoint task mismatch",
  );
  ensure(
    checkpoint.contract_sha256 === undefined || checkpoint.contract_sha256 === task.contract_sha256,
    "Checkpoint contract mismatch",
  );
  const result = {
    task_id: task.task_id,
    contract_sha256: task.contract_sha256,
    branch: checkpoint.branch,
    current_sha: checkpoint.current_sha,
  };
  if (checkpoint.completed_paths !== undefined) {
    ensure(
      Array.isArray(checkpoint.completed_paths) &&
        checkpoint.completed_paths.length <= 100 &&
        checkpoint.completed_paths.every((entry) =>
          allowedPath(entry, task.contract.allowed_paths),
        ),
      "Checkpoint paths exceed the admitted scope",
    );
    result.completed_paths = [...new Set(checkpoint.completed_paths)];
  }
  if (checkpoint.artifact !== undefined || checkpoint.artifact_sha256 !== undefined) {
    ensure(
      safePath(checkpoint.artifact) && SHA256.test(checkpoint.artifact_sha256 ?? ""),
      "Checkpoint artifact identity required",
    );
    result.artifact = checkpoint.artifact;
    result.artifact_sha256 = checkpoint.artifact_sha256;
  }
  if (checkpoint.session_id !== undefined) {
    ensure(SESSION.test(checkpoint.session_id), "Checkpoint session identity invalid");
    result.session_id = checkpoint.session_id;
  }
  return result;
}

function uncertain(failureClass, result) {
  return {
    status: "uncertain",
    failure_class: failureClass,
    terminal_observed: result?.terminal_observed ?? false,
    process_group_closed: result?.process_group_closed ?? false,
    process_exit_observed:
      !!result &&
      result.process_group_closed === true &&
      (Number.isInteger(result.exit_code) || typeof result.signal === "string"),
    process_status: result?.status ?? "unknown",
  };
}

/**
 * registration is trusted operator configuration, never task/worker-provided argv.
 * Only inputForTask can vary the stdin payload; it cannot choose executable or cwd.
 * onCheckpoint is an independent reconciliation callback, not an agent assertion:
 *   ({phase, task, attempt, checkpoint, process_result}) =>
 *   {status:"passed", checkpoint:{branch,current_sha,...}, no_side_effects_pending:true}
 * It runs after a stopped group and again before resuming a writable task. A failed
 * callback or changed checkpoint prevents another launch. It does not verify CI/UAT.
 * The returned dispatch must be used by tickSupervisor after its durable CAS intent;
 * it never re-dispatches an existing active attempt or recovers an orphan by silence.
 */
export function createManagedWorkerDispatch({
  store,
  registration,
  onCheckpoint,
  now = () => new Date(),
} = {}) {
  ensure(
    store && typeof store.read === "function" && typeof store.compareAndSwap === "function",
    "Supervisor store required",
  );
  ensure(
    registration && ID.test(registration.worker_id ?? ""),
    "Explicit worker registration required",
  );
  ensure(
    typeof registration.command === "string" &&
      registration.command.length > 0 &&
      !registration.command.includes("\0"),
    "Registered executable required",
  );
  ensure(
    Array.isArray(registration.args) &&
      registration.args.every((arg) => typeof arg === "string" && !arg.includes("\0")),
    "Registered argv required",
  );
  ensure(
    typeof registration.cwd === "string" &&
      path.isAbsolute(registration.cwd) &&
      !registration.cwd.includes("\0"),
    "Registered absolute cwd required",
  );
  ensure(
    registration.inputForTask === undefined || typeof registration.inputForTask === "function",
    "Invalid registered input builder",
  );
  ensure(
    onCheckpoint === undefined || typeof onCheckpoint === "function",
    "Invalid independent reconciler",
  );
  ensure(typeof now === "function", "Invalid observer clock");
  const timeoutMs = registration.timeoutMs ?? 120000;
  ensure(
    Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 86400000,
    "Invalid managed timeout",
  );
  const observerTimeoutMs = registration.observerTimeoutMs ?? 60000;
  const reconciliationTimeoutMs = registration.reconciliationTimeoutMs ?? 60000;
  ensure(
    [observerTimeoutMs, reconciliationTimeoutMs].every(
      (value) => Number.isSafeInteger(value) && value > 0 && value <= 60000,
    ),
    "Invalid managed observer or reconciliation timeout",
  );
  const signal = registration.signal;
  ensure(
    signal === undefined ||
      (typeof signal.aborted === "boolean" && typeof signal.addEventListener === "function"),
    "Invalid managed cancellation signal",
  );
  const config = Object.freeze({
    worker_id: registration.worker_id,
    command: registration.command,
    args: Object.freeze([...registration.args]),
    cwd: registration.cwd,
    inputForTask: registration.inputForTask,
    environmentProfile: registration.environmentProfile ?? "isolated",
  });
  // Reject an unknown profile before consuming an attempt or acquiring a launch claim.
  managedRuntimeEnvironment({}, config.environmentProfile);
  const invokedAttempts = new Set();

  async function reconcile({ phase, task, attempt, checkpoint, processResult }) {
    if (!onCheckpoint) return null;
    const verdict = await bounded(
      () =>
        onCheckpoint({
          phase,
          task: copy(task),
          attempt: copy(attempt),
          checkpoint: copy(checkpoint),
          process_result: processResult ? copy(processResult) : null,
        }),
      reconciliationTimeoutMs,
    );
    if (verdict?.status !== "passed" || verdict.no_side_effects_pending !== true) return null;
    return checkpointMetadata(verdict.checkpoint, task);
  }

  return async ({ task, attempt, checkpoint = null } = {}) => {
    if (attempt?.worker_id !== config.worker_id) return uncertain("worker_registration_mismatch");
    const identity = `${task?.task_id}:${attempt?.attempt_id}`;
    if (invokedAttempts.has(identity)) return uncertain("attempt_already_invoked");
    // Consume this call even if validation fails. Retrying activation is never an
    // appropriate response to an ambiguous storage read or input-builder failure.
    invokedAttempts.add(identity);
    try {
      const snapshot = await store.read();
      validateSupervisorState(snapshot.state);
      const durable = snapshot.state.tasks.find((entry) => entry.task_id === task?.task_id);
      const claimed = durable?.attempts.at(-1);
      ensure(
        durable?.status === "dispatching" && snapshot.state.active_task_id === task.task_id,
        "An active reserved launch intent is required",
      );
      ensure(
        claimed?.attempt_id === attempt.attempt_id &&
          claimed.worker_id === config.worker_id &&
          claimed.contract_sha256 === task.contract_sha256 &&
          durable.contract_sha256 === task.contract_sha256 &&
          supervisorContractSha256(task.contract) === durable.contract_sha256,
        "Reserved task identity mismatch",
      );
      ensure(
        supervisorContractSha256(checkpoint) === supervisorContractSha256(durable.checkpoint),
        "Checkpoint differs from durable intent",
      );
      task = copy(durable);
      attempt = copy(claimed);
      checkpoint = copy(durable.checkpoint);
    } catch {
      return uncertain("launch_intent_unconfirmed");
    }

    let effectiveCheckpoint = checkpoint;
    const isResume = checkpoint !== null || task.attempts.length > 1;
    if (!task.contract.read_only && isResume) {
      try {
        ensure(task.contract.recovery.mode === "checkpoint", "Writable recovery is not authorized");
        const reconciled = await reconcile({
          phase: "before_resume",
          task,
          attempt,
          checkpoint,
          processResult: null,
        });
        ensure(reconciled !== null, "Independent resume reconciliation required");
        if (checkpoint !== null)
          ensure(
            supervisorContractSha256(reconciled) ===
              supervisorContractSha256(checkpointMetadata(checkpoint, task)),
            "Checkpoint changed since its stop proof",
          );
        effectiveCheckpoint = reconciled;
      } catch {
        return uncertain("checkpoint_reconciliation_required");
      }
    }

    let input = "";
    try {
      if (config.inputForTask)
        input = await bounded(() =>
          config.inputForTask({
            task: copy(task),
            attempt: copy(attempt),
            checkpoint: copy(effectiveCheckpoint),
          }),
        );
      ensure(
        (typeof input === "string" || Buffer.isBuffer(input)) &&
          Buffer.byteLength(input) <= 1024 * 1024,
        "Bounded worker input required",
      );
    } catch {
      return uncertain("input_unavailable");
    }

    // A second adapter instance must not replay the same reserved activation,
    // including the window before the child has emitted its first event.
    try {
      const snapshot = await store.read();
      validateSupervisorState(snapshot.state);
      const next = copy(snapshot.state);
      const current = next.tasks.find((entry) => entry.task_id === task.task_id);
      const claimed = current?.attempts.at(-1);
      ensure(
        current?.status === "dispatching" &&
          next.active_task_id === task.task_id &&
          claimed?.attempt_id === attempt.attempt_id &&
          claimed.worker_id === config.worker_id &&
          claimed.managed_launch_claim === undefined,
        "Managed launch has already been claimed",
      );
      const time = new Date(now()).toISOString();
      claimed.managed_launch_claim = { worker_id: config.worker_id, claimed_at: time };
      next.sequence = snapshot.state.sequence + 1;
      next.previous = snapshot.version;
      next.updated_at = time;
      next.last_tick_at = time;
      validateSupervisorState(next);
      await store.compareAndSwap(snapshot.version, next, {
        type: "managed_process_launch",
        task_id: task.task_id,
        attempt_id: attempt.attempt_id,
        worker_id: config.worker_id,
        at: time,
      });
    } catch {
      return uncertain("launch_claim_unconfirmed");
    }

    let lastPersistedActivity = null;
    let result;
    try {
      result = await runManagedWorker({
        command: config.command,
        args: [...config.args],
        cwd: config.cwd,
        env: managedRuntimeEnvironment(process.env, config.environmentProfile),
        input,
        timeoutMs,
        observerTimeoutMs,
        signal,
        now,
        onActivity: async (activity) => {
          if (!ACTIVITY.has(activity.type)) return;
          const at = Date.parse(activity.at);
          if (
            lastPersistedActivity !== null &&
            !TERMINAL.has(activity.type) &&
            at - lastPersistedActivity < ACTIVITY_INTERVAL_MS
          )
            return;
          // Any failed durable activity write throws into the wrapper, which closes
          // its own group and returns observer_error. Do not swallow lost receipts.
          await recordSupervisorActivity({
            store,
            taskId: task.task_id,
            attemptId: attempt.attempt_id,
            activity,
            now: activity.at,
          });
          lastPersistedActivity = at;
        },
      });
    } catch {
      return uncertain("managed_observation_failed");
    }
    const processExitObserved =
      result.process_group_closed === true &&
      (Number.isInteger(result.exit_code) || typeof result.signal === "string");
    const proof = {
      kind: "managed_process_observation",
      task_id: task.task_id,
      attempt_id: attempt.attempt_id,
      worker_id: config.worker_id,
      contract_sha256: task.contract_sha256,
      ...result,
      process_exit_observed: processExitObserved,
    };
    const outcome = {
      terminal_observed: result.terminal_observed,
      process_group_closed: result.process_group_closed,
      process_exit_observed: processExitObserved,
      process_status: result.status,
      failure_class:
        result.failure_class === "authentication" ? "auth_required" : result.failure_class,
      session_id: result.session_id,
      proof,
    };
    if (result.status === "completed" && result.terminal_observed && processExitObserved)
      return { ...outcome, status: "delivered" };
    if (!["failed", "interrupted"].includes(result.status) || !processExitObserved)
      return { ...outcome, ...uncertain(outcome.failure_class ?? "terminal_unconfirmed", result) };

    const stopped = {
      ...outcome,
      status: "stopped",
      resume_verified: false,
      no_side_effects_pending: false,
    };
    if (outcome.failure_class === "auth_required") return stopped;
    if (task.contract.recovery.mode === "checkpoint") {
      try {
        const reconciled = await reconcile({
          phase: "after_stop",
          task,
          attempt,
          checkpoint: effectiveCheckpoint,
          processResult: result,
        });
        if (reconciled)
          return {
            ...stopped,
            checkpoint: reconciled,
            resume_verified: true,
            no_side_effects_pending: true,
          };
      } catch {
        return { ...stopped, failure_class: "checkpoint_reconciliation_required" };
      }
    }
    return stopped;
  };
}
