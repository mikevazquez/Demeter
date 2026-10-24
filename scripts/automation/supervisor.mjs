import { createHash, randomUUID } from "node:crypto";
import { dispatchTask } from "./worker-dispatch.mjs";
import { dispatchFingerprint, validateTaskContract } from "./claude-routine-worker.mjs";

const REPO = "mikevazquez/Demeter";
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const ACTIVE = new Set([
  "dispatching",
  "sent",
  "running",
  "no_signal",
  "uncertain",
  "delivered",
  "verifying",
]);
const STATUSES = new Set([
  ...ACTIVE,
  "queued",
  "paused_capacity",
  "blocked",
  "verified",
  "waiting_uat",
  "cancelled",
]);
const clone = (value) => JSON.parse(JSON.stringify(value));
const ensure = (ok, message) => {
  if (!ok) throw new Error(message);
};
const at = (value) => {
  ensure(
    typeof value === "string" && Number.isFinite(Date.parse(value)),
    "Valid timestamp required",
  );
  return new Date(value).toISOString();
};

function managedReceipt(task, attempt, outcome) {
  if (outcome.receipt === undefined && outcome.source === undefined) return null;
  ensure(task.contract.read_only === true, "Managed receipts require a read-only contract");
  ensure(
    outcome.receipt &&
      outcome.receipt.task_id === task.task_id &&
      outcome.receipt.attempt_id === attempt.attempt_id &&
      outcome.receipt.worker_id === attempt.worker_id &&
      outcome.receipt.contract_sha256 === task.contract_sha256 &&
      outcome.receipt.dispatch_fingerprint === attempt.dispatch_fingerprint,
    "Managed receipt identity mismatch",
  );
  ensure(
    outcome.source?.author === "github-actions[bot]" &&
      outcome.source.channel === "github_actions_run" &&
      /^https:\/\/github\.com\/mikevazquez\/Demeter\/actions\/runs\/\d+$/.test(
        outcome.source.receipt_url ?? "",
      ),
    "Managed receipt source invalid",
  );
  const serialized = JSON.stringify({ receipt: outcome.receipt, source: outcome.source });
  ensure(Buffer.byteLength(serialized) <= 128 * 1024, "Managed receipt exceeds limit");
  return { receipt: clone(outcome.receipt), source: clone(outcome.source) };
}

function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  ensure(
    value && Object.getPrototypeOf(value) === Object.prototype,
    "Plain JSON contract required",
  );
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

export function supervisorContractSha256(contract) {
  const serialized = canonical(contract);
  ensure(Buffer.byteLength(serialized) <= 64 * 1024, "Contract exceeds 64 KiB");
  return createHash("sha256").update(serialized).digest("hex");
}

export function validateSupervisorContract(contract) {
  validateTaskContract(contract);
  ensure(contract.repo === REPO && ID.test(contract.task_id), "Unreviewed task repository or ID");
  ensure(
    /^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(contract.branch) &&
      !contract.branch.includes("..") &&
      !contract.branch.startsWith("refs/") &&
      contract.branch !== "main",
    "A scoped candidate branch is required",
  );
  ensure(
    Array.isArray(contract.allowed_paths) &&
      contract.allowed_paths.length > 0 &&
      contract.allowed_paths.length <= 40 &&
      contract.allowed_paths.every(
        (path) =>
          typeof path === "string" &&
          path.length > 0 &&
          path.length < 250 &&
          !path.startsWith("/") &&
          !path.includes("\\") &&
          !path
            .split("/")
            .some((part) => part === ".." || part === ".git" || /^\.env(?:\.|$)/.test(part)),
      ),
    "Explicit allowed paths required",
  );
  ensure(
    typeof contract.read_only === "boolean" && typeof contract.requires_uat === "boolean",
    "Read-only and UAT policies must be explicit",
  );
  ensure(
    Array.isArray(contract.required_checks) && contract.required_checks.length > 0,
    "Independent CI checks required",
  );
  ensure(
    contract.recovery && ["manual", "read_only", "checkpoint"].includes(contract.recovery.mode),
    "Explicit recovery policy required",
  );
  ensure(
    Number.isInteger(contract.recovery.max_attempts) &&
      contract.recovery.max_attempts >= 1 &&
      contract.recovery.max_attempts <= 3,
    "Attempt budget must be 1–3",
  );
  ensure(
    contract.recovery.mode !== "read_only" || contract.read_only,
    "Read-only recovery cannot authorize writes",
  );
  supervisorContractSha256(contract);
  return contract;
}

export function validateSupervisorState(state) {
  ensure(
    state?.schema === "governance2-supervisor-v1" &&
      state.repository === REPO &&
      Array.isArray(state.tasks),
    "Supervisor state required",
  );
  const ids = new Set();
  for (const task of state.tasks) {
    validateSupervisorContract(task.contract);
    ensure(
      task.task_id === task.contract.task_id && !ids.has(task.task_id),
      "Duplicate or changed task identity",
    );
    ids.add(task.task_id);
    ensure(
      task.contract_sha256 === supervisorContractSha256(task.contract),
      "Task contract changed after admission",
    );
    ensure(STATUSES.has(task.status) && Array.isArray(task.attempts), "Invalid task state");
    ensure(
      !ACTIVE.has(task.status) || task.attempts.length > 0,
      "Active task requires a reserved attempt",
    );
    ensure(task.attempts.length <= task.contract.recovery.max_attempts, "Attempt budget exceeded");
    const attempts = new Set();
    for (const attempt of task.attempts) {
      ensure(
        ID.test(attempt.attempt_id) && !attempts.has(attempt.attempt_id),
        "Duplicate attempt identity",
      );
      attempts.add(attempt.attempt_id);
      ensure(
        attempt.contract_sha256 === task.contract_sha256 &&
          attempt.dispatch_fingerprint === dispatchFingerprint(task.contract) &&
          ID.test(attempt.worker_id),
        "Attempt differs from its admitted contract",
      );
      at(attempt.intent_at);
      ensure(
        attempt.managed_host_id === undefined || ID.test(attempt.managed_host_id),
        "Invalid reserved host identity",
      );
      if (attempt.managed_receipt !== undefined || attempt.managed_receipt_source !== undefined) {
        ensure(task.contract.read_only === true, "Managed receipt requires read-only task");
        ensure(
          attempt.managed_receipt?.task_id === task.task_id &&
            attempt.managed_receipt?.attempt_id === attempt.attempt_id &&
            attempt.managed_receipt?.worker_id === attempt.worker_id &&
            attempt.managed_receipt?.contract_sha256 === task.contract_sha256 &&
            attempt.managed_receipt?.dispatch_fingerprint === attempt.dispatch_fingerprint,
          "Persisted managed receipt identity mismatch",
        );
        ensure(
          attempt.managed_receipt_source?.author === "github-actions[bot]" &&
            attempt.managed_receipt_source?.channel === "github_actions_run" &&
            /^https:\/\/github\.com\/mikevazquez\/Demeter\/actions\/runs\/\d+$/.test(
              attempt.managed_receipt_source?.receipt_url ?? "",
            ),
          "Persisted managed receipt source invalid",
        );
      }
    }
  }
  const active = state.tasks.filter((task) => ACTIVE.has(task.status));
  ensure(
    active.length <= 1 && (active[0]?.task_id ?? null) === state.active_task_id,
    "Active slot and tasks disagree",
  );
  return state;
}

async function commit(store, snapshot, next, event, now) {
  next.sequence = snapshot.state.sequence + 1;
  next.previous = snapshot.version;
  next.updated_at = now;
  next.last_tick_at = now;
  validateSupervisorState(next);
  return store.compareAndSwap(snapshot.version, next, { ...event, at: now });
}

export async function admitSupervisorTask({
  store,
  contract,
  authorization,
  now = new Date().toISOString(),
}) {
  validateSupervisorContract(contract);
  const time = at(now);
  ensure(
    authorization?.actor === "mikevazquez" &&
      /^https:\/\/github\.com\/mikevazquez\/Demeter\/issues\/\d+$/.test(
        authorization.reference ?? "",
      ),
    "Owner authorization with a durable issue reference required",
  );
  at(authorization.authorized_at);
  const snapshot = await store.read();
  validateSupervisorState(snapshot.state);
  const existing = snapshot.state.tasks.find((task) => task.task_id === contract.task_id);
  if (existing) {
    ensure(
      existing.contract_sha256 === supervisorContractSha256(contract),
      "Task ID cannot be reused with another contract",
    );
    return { ...snapshot, action: "already_admitted" };
  }
  const legacy = snapshot.state.legacy?.state ?? {};
  const consumed = new Set([
    ...(legacy.history ?? []).map((entry) => entry.id),
    ...(legacy.entries ?? []).map((entry) => entry.task?.id),
  ]);
  ensure(!consumed.has(contract.task_id), "A consumed legacy task ID cannot be regenerated");
  const next = clone(snapshot.state);
  next.tasks.push({
    task_id: contract.task_id,
    title: contract.objective,
    contract: clone(contract),
    contract_sha256: supervisorContractSha256(contract),
    authorization: clone(authorization),
    status: "queued",
    verification_status: "pending",
    requires_user_action: false,
    next_action: "Seleccionar un worker elegible.",
    created_at: time,
    updated_at: time,
    attempts: [],
    checkpoint: null,
    evidence: null,
    uat_status: contract.requires_uat ? "pending" : "not_required",
  });
  return {
    ...(await commit(
      store,
      snapshot,
      next,
      { type: "task_admitted", task_id: contract.task_id },
      time,
    )),
    action: "admitted",
  };
}

function backoff(task, time) {
  const minutes = [15, 30, 60][Math.min(Math.max(task.attempts.length - 1, 0), 2)];
  return new Date(Date.parse(time) + minutes * 60_000).toISOString();
}

function waitOrBlock(task, next, time, reason) {
  next.active_task_id = null;
  task.requires_user_action = task.attempts.length >= task.contract.recovery.max_attempts;
  task.status = task.requires_user_action ? "blocked" : "paused_capacity";
  task.next_attempt_at = task.requires_user_action ? null : backoff(task, time);
  task.next_action = task.requires_user_action
    ? "Revisar el intento y autorizar un nuevo contrato; presupuesto agotado."
    : reason;
}

function applyOutcome(task, next, outcome, time) {
  const attempt = task.attempts.at(-1);
  // Only explicitly acknowledged pre-activation rejection frees the execution slot.
  if (outcome.status === "rejected" && outcome.http_status === 429) {
    attempt.status = "rejected_capacity";
    attempt.finished_at = time;
    waitOrBlock(task, next, time, "Reintentar después de la pausa de capacidad registrada.");
  } else if (
    outcome.status === "rejected" &&
    [400, 401, 403, 404, 422].includes(outcome.http_status)
  ) {
    attempt.status = "rejected";
    attempt.finished_at = time;
    task.status = "blocked";
    task.requires_user_action = true;
    task.next_action = "Corregir autorización o contrato del worker; reintentos suspendidos.";
    next.active_task_id = null;
  } else if (
    outcome.status === "dispatched" &&
    /^https:\/\/claude\.ai\/code\/[A-Za-z0-9_-]+$/.test(outcome.session_url ?? "")
  ) {
    attempt.status = "sent";
    attempt.session_url = outcome.session_url;
    task.status = "sent";
    task.requires_user_action = false;
    task.next_action = "Esperar receipt correlacionado y comprobar SHA y CI.";
  } else if (
    outcome.status === "stopped" &&
    outcome.process_exit_observed === true &&
    outcome.process_group_closed === true
  ) {
    attempt.status = "stopped";
    attempt.finished_at = time;
    attempt.stop_proof = {
      terminal_observed: outcome.terminal_observed === true,
      process_exit_observed: true,
      process_group_closed: true,
      observed_at: time,
    };
    if (outcome.checkpoint && SHA.test(outcome.checkpoint.current_sha ?? ""))
      task.checkpoint = clone(outcome.checkpoint);
    const canResume =
      task.contract.recovery.mode === "read_only" ||
      (task.contract.recovery.mode === "checkpoint" &&
        outcome.resume_verified === true &&
        outcome.no_side_effects_pending === true &&
        SHA.test(task.checkpoint?.current_sha ?? ""));
    if (canResume && !["auth_required", "unauthorized"].includes(outcome.failure_class)) {
      waitOrBlock(
        task,
        next,
        time,
        "Worker detenido y grupo cerrado; continuar desde el checkpoint tras la pausa.",
      );
    } else {
      task.status = "blocked";
      task.requires_user_action = true;
      task.next_action =
        "Proceso cerrado. Resolver autenticación o verificar el checkpoint antes de continuar.";
      next.active_task_id = null;
    }
  } else if (
    outcome.status === "delivered" &&
    outcome.terminal_observed === true &&
    outcome.process_group_closed === true
  ) {
    const embedded = managedReceipt(task, attempt, outcome);
    if (embedded) {
      attempt.managed_receipt = embedded.receipt;
      attempt.managed_receipt_source = embedded.source;
    }
    attempt.status = "delivered";
    attempt.finished_at = time;
    task.status = "delivered";
    task.next_action =
      "El proceso terminó; falta receipt y verificación independiente del resultado.";
  } else {
    attempt.status = "uncertain";
    task.status = "uncertain";
    task.requires_user_action = true;
    task.next_action =
      "Reconciliar el intento registrado. No hay evidencia suficiente para activar otro worker.";
  }
  task.updated_at = time;
}

async function saveDispatchOutcome({ store, taskId, attemptId, outcome, now }) {
  // Retrying a state write is safe. Never repeat the external activation here.
  for (let retry = 0; retry < 3; retry++) {
    const snapshot = await store.read();
    validateSupervisorState(snapshot.state);
    const next = clone(snapshot.state);
    const task = next.tasks.find((entry) => entry.task_id === taskId);
    ensure(
      task?.attempts.at(-1)?.attempt_id === attemptId,
      "Dispatch result belongs to a superseded attempt",
    );
    if (!["dispatching", "uncertain", "no_signal", "running"].includes(task.status))
      return { ...snapshot, action: "outcome_already_reconciled" };
    applyOutcome(task, next, outcome, now);
    try {
      return {
        ...(await commit(
          store,
          snapshot,
          next,
          {
            type: "dispatch_outcome",
            task_id: taskId,
            attempt_id: attemptId,
            outcome: task.status,
          },
          now,
        )),
        action: task.status,
      };
    } catch (error) {
      if (error.code !== "CAS_CONFLICT") throw error;
    }
  }
  throw new Error("Dispatch result could not be persisted; original intent remains consumed");
}

export async function recordSupervisorActivity({
  store,
  taskId,
  attemptId,
  activity,
  now = new Date().toISOString(),
}) {
  const time = at(now);
  // An observer heartbeat cannot fabricate worker progress.
  if (
    ![
      "thread.started",
      "turn.started",
      "item.started",
      "item.updated",
      "item.completed",
      "turn.completed",
      "turn.failed",
    ].includes(activity.type)
  )
    return { action: "ignored_observer_heartbeat" };
  const snapshot = await store.read();
  validateSupervisorState(snapshot.state);
  const next = clone(snapshot.state);
  const task = next.tasks.find((entry) => entry.task_id === taskId);
  ensure(
    task?.attempts.at(-1)?.attempt_id === attemptId && ACTIVE.has(task.status),
    "Activity does not belong to the active attempt",
  );
  const attempt = task.attempts.at(-1);
  if (attempt.last_activity_at && Date.parse(attempt.last_activity_at) >= Date.parse(time))
    return { ...snapshot, action: "old_activity" };
  attempt.last_activity_at = time;
  attempt.last_activity_type = activity.type;
  if (typeof activity.session_id === "string" && /^[a-zA-Z0-9_-]{1,120}$/.test(activity.session_id))
    attempt.session_id = activity.session_id;
  task.last_worker_activity_at = time;
  task.status = "running";
  attempt.status = "running";
  task.updated_at = time;
  task.requires_user_action = false;
  task.next_action = "Observar el proceso registrado y conservar su checkpoint.";
  return {
    ...(await commit(
      store,
      snapshot,
      next,
      {
        type: "worker_activity",
        task_id: taskId,
        attempt_id: attemptId,
        activity_type: activity.type,
      },
      time,
    )),
    action: "activity_recorded",
  };
}

export async function tickSupervisor({
  store,
  workers,
  dispatch,
  observe = async () => null,
  verify = async () => ({ status: "pending", reason: "No independent verifier configured" }),
  now,
  runUrl = null,
  observerId = "scheduled-supervisor",
  staleAfterMinutes = 30,
  workerSignals = [],
  id = randomUUID,
}) {
  const time = at(now ?? new Date().toISOString());
  ensure(
    ID.test(observerId) &&
      Number.isFinite(staleAfterMinutes) &&
      staleAfterMinutes >= 1 &&
      Array.isArray(workerSignals),
    "Valid observer configuration required",
  );
  for (const signal of workerSignals) {
    ensure(
      signal &&
        ID.test(signal.workerId ?? "") &&
        ["no_capacity", "disconnected"].includes(signal.state) &&
        typeof signal.observedAt === "string" &&
        Number.isFinite(Date.parse(signal.observedAt)),
      "Trusted worker capacity signals require workerId, state and observedAt",
    );
  }
  const snapshot = await store.read();
  validateSupervisorState(snapshot.state);
  const active = snapshot.state.tasks.find(
    (task) => task.task_id === snapshot.state.active_task_id,
  );
  if (active) {
    const attempt = active.attempts.at(-1);
    const observation = await observe({ task: clone(active), attempt: clone(attempt) });
    const next = clone(snapshot.state);
    const task = next.tasks.find((entry) => entry.task_id === active.task_id);
    if (observation?.receipt) {
      const result = await verify({
        task: clone(task),
        attempt: clone(attempt),
        receipt: observation.receipt,
        source: observation.source,
      });
      task.verification_status = result.status;
      if (
        /^https:\/\/github\.com\/mikevazquez\/Demeter\/issues\/341#issuecomment-\d{1,20}$/.test(
          observation.source?.receipt_url ?? "",
        )
      )
        task.reported_receipt_url = observation.source.receipt_url;
      task.verification_reason = result.reason;
      task.next_action =
        result.status === "verified"
          ? task.contract.requires_uat
            ? "Completar la aceptación funcional sobre el SHA verificado."
            : "Verificación técnica completa. Conservar la evidencia para el cierre y la decisión de promoción."
          : result.status === "blocked"
            ? "La evidencia no permite cerrar el trabajo. Revisar el receipt y CI antes de continuar."
            : "Esperar la evidencia independiente y los checks requeridos para el mismo SHA.";
      if (result.evidence) task.evidence = clone(result.evidence);
      if (result.checkpoint) task.checkpoint = clone(result.checkpoint);
      if (result.status === "verified") {
        task.status = task.contract.requires_uat ? "waiting_uat" : "verified";
        task.requires_user_action = task.contract.requires_uat;
        task.attempts.at(-1).status = "receipt_verified";
        task.attempts.at(-1).finished_at = time;
        next.active_task_id = null;
      } else if (result.status === "blocked") {
        // An invalid receipt must not release a possibly still-running writer.
        task.status = "uncertain";
        task.requires_user_action = true;
      } else {
        task.status = "verifying";
        task.requires_user_action = false;
      }
    } else if (observation?.status === "stopped") {
      applyOutcome(task, next, observation, time);
    } else if (
      active.status === "dispatching" &&
      attempt.managed_host_id &&
      Date.parse(time) - Date.parse(attempt.intent_at) < 30_000
    ) {
      // Retain the live host's slot during its pre-spawn CAS window. Never replay on expiry.
      return { ...snapshot, action: "observed_no_change" };
    } else if (active.status === "dispatching") {
      task.status = "uncertain";
      task.requires_user_action = true;
      task.next_action =
        "El observador anterior dejó un intento reservado. Reconciliar antes de reintentar.";
    } else {
      const last = attempt.last_activity_at ?? attempt.intent_at;
      const capacitySignal = workerSignals
        .filter(
          (signal) =>
            signal.workerId === attempt.worker_id &&
            Date.parse(signal.observedAt) >= Date.parse(attempt.intent_at),
        )
        .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))[0];
      const staleReadOnlyCapacity =
        task.contract.read_only &&
        task.contract.recovery.mode === "read_only" &&
        capacitySignal &&
        (active.status === "no_signal" ||
          (["sent", "running"].includes(active.status) &&
            Date.parse(time) - Date.parse(last) > staleAfterMinutes * 60_000));
      if (staleReadOnlyCapacity) {
        const persistedAttempt = task.attempts.at(-1);
        persistedAttempt.status = "rejected_capacity";
        persistedAttempt.finished_at = time;
        persistedAttempt.capacity_signal = {
          state: capacitySignal.state,
          observed_at: new Date(capacitySignal.observedAt).toISOString(),
        };
        waitOrBlock(
          task,
          next,
          time,
          "Capacidad del worker agotada en una tarea de sólo lectura; reintentar con otro worker elegible tras la pausa.",
        );
      } else if (
        ["sent", "running"].includes(active.status) &&
        Date.parse(time) - Date.parse(last) > staleAfterMinutes * 60_000
      ) {
        task.status = "no_signal";
        task.requires_user_action = true;
        task.next_action =
          "No se observa señal reciente. Sin una señal confiable de capacidad o cierre del proceso no se autoriza un relevo.";
      }
    }
    if (JSON.stringify(task) === JSON.stringify(active))
      return { ...snapshot, action: "observed_no_change" };
    task.updated_at = time;
    try {
      return {
        ...(await commit(
          store,
          snapshot,
          next,
          {
            type: "attempt_observed",
            task_id: task.task_id,
            attempt_id: attempt.attempt_id,
            outcome: task.status,
          },
          time,
        )),
        action: task.status,
      };
    } catch (error) {
      if (error.code === "CAS_CONFLICT")
        return { ...(await store.read()), action: "observation_raced" };
      throw error;
    }
  }

  const ready = snapshot.state.tasks.filter(
    (task) =>
      ["queued", "paused_capacity"].includes(task.status) &&
      (!task.next_attempt_at || Date.parse(task.next_attempt_at) <= Date.parse(time)),
  );
  if (!ready.length) return { ...snapshot, action: "idle" };

  const route = (candidate) => {
    const capacityFailedWorkers = new Set(
      candidate.attempts
        .filter((attempt) => ["rejected_capacity", "stale_capacity"].includes(attempt.status))
        .map((attempt) => attempt.worker_id),
    );
    const workersWithoutRecentCapacityFailure = workers.filter(
      (worker) => !capacityFailedWorkers.has(worker.workerId),
    );
    const candidateWorkers = workersWithoutRecentCapacityFailure.length
      ? workersWithoutRecentCapacityFailure
      : workers;
    const decision = candidateWorkers.length
      ? dispatchTask(
          {
            taskId: candidate.task_id,
            category: candidate.contract.category ?? "software",
            requiredCapabilities: candidate.contract.required_capabilities ?? ["repository_review"],
            requiredPermissions: candidate.contract.required_permissions ?? [
              "repository:read",
              "receipt:write",
            ],
            qualityFloor: candidate.contract.quality_floor ?? 0.8,
            riskTier: candidate.contract.risk_tier ?? (candidate.contract.read_only ? 0 : 1),
          },
          candidateWorkers,
        )
      : { assignedWorker: null };
    return { candidate, decision };
  };

  const routes = ready.map(route);
  const selected = routes.find(({ decision }) => decision.assignedWorker) ?? routes[0];
  const eligible = selected.candidate;
  const decision = selected.decision;
  const next = clone(snapshot.state);
  const task = next.tasks.find((entry) => entry.task_id === eligible.task_id);
  if (!decision.assignedWorker) {
    task.status = "paused_capacity";
    task.next_attempt_at = backoff(task, time);
    task.next_action =
      "No hay worker elegible. Esperar capacidad o conectar el ejecutor registrado.";
    task.updated_at = time;
    try {
      return {
        ...(await commit(
          store,
          snapshot,
          next,
          { type: "no_eligible_worker", task_id: task.task_id },
          time,
        )),
        action: "paused_capacity",
      };
    } catch (error) {
      if (error.code === "CAS_CONFLICT") return { ...(await store.read()), action: "claim_lost" };
      throw error;
    }
  }
  ensure(
    task.attempts.length < task.contract.recovery.max_attempts,
    "Task attempt budget exhausted",
  );
  const attempt = {
    attempt_id: id(),
    worker_id: decision.assignedWorker,
    contract_sha256: task.contract_sha256,
    dispatch_fingerprint: dispatchFingerprint(task.contract),
    status: "dispatching",
    intent_at: time,
    observer_id: observerId,
    run_url: runUrl,
  };
  const managedHostId = workers.find(
    (worker) => worker.workerId === decision.assignedWorker,
  )?.managedHostId;
  if (managedHostId !== undefined) {
    ensure(
      ID.test(managedHostId) && managedHostId === observerId,
      "Managed host must reserve its own local worker",
    );
    attempt.managed_host_id = managedHostId;
  }
  ensure(
    ID.test(attempt.attempt_id) && DIGEST.test(attempt.contract_sha256),
    "Invalid attempt identity",
  );
  task.attempts.push(attempt);
  task.status = "dispatching";
  task.requires_user_action = false;
  task.updated_at = time;
  task.next_attempt_at = null;
  task.next_action = "Intento reservado; activar una sola vez y guardar el acuse.";
  next.active_task_id = task.task_id;
  try {
    await commit(
      store,
      snapshot,
      next,
      {
        type: "dispatch_intent",
        task_id: task.task_id,
        attempt_id: attempt.attempt_id,
        worker_id: attempt.worker_id,
        contract_sha256: task.contract_sha256,
      },
      time,
    );
  } catch (error) {
    if (error.code === "CAS_CONFLICT") return { ...(await store.read()), action: "claim_lost" };
    throw error;
  }
  let outcome;
  try {
    outcome = await dispatch({
      task: clone(task),
      attempt: clone(attempt),
      checkpoint: clone(task.checkpoint),
    });
  } catch {
    outcome = { status: "uncertain" };
  }
  return saveDispatchOutcome({
    store,
    taskId: task.task_id,
    attemptId: attempt.attempt_id,
    outcome,
    now: at(now ?? new Date().toISOString()),
  });
}
