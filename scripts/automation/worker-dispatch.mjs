const WORKER_STATES = new Set([
  "available",
  "busy",
  "degraded",
  "no_capacity",
  "disconnected",
]);

const assert = (value, message) => {
  if (!value) throw new Error(message);
};

const unique = (items) => [...new Set(items ?? [])];

function validateWorker(worker) {
  assert(worker && typeof worker === "object", "Worker profile required");
  assert(typeof worker.workerId === "string" && worker.workerId.length > 0, "workerId required");
  assert(WORKER_STATES.has(worker.state), `Invalid worker state for ${worker.workerId}`);
  assert(Array.isArray(worker.capabilities), `capabilities required for ${worker.workerId}`);
  assert(Array.isArray(worker.permissions), `permissions required for ${worker.workerId}`);
  assert(Number.isFinite(worker.quality?.default), `default quality required for ${worker.workerId}`);
  assert(Number.isFinite(worker.relativeCost), `relativeCost required for ${worker.workerId}`);
  return worker;
}

function validateTask(task) {
  assert(task && typeof task === "object", "Task contract required");
  assert(typeof task.taskId === "string" && task.taskId.length > 0, "taskId required");
  assert(Array.isArray(task.requiredCapabilities), "requiredCapabilities required");
  assert(Array.isArray(task.requiredPermissions), "requiredPermissions required");
  assert(Number.isFinite(task.qualityFloor), "qualityFloor required");
  assert(Number.isInteger(task.riskTier) && task.riskTier >= 0 && task.riskTier <= 4, "riskTier must be 0-4");
  return task;
}

function workerQuality(worker, category) {
  return worker.quality?.[category] ?? worker.quality?.default ?? 0;
}

function hasAll(have, required) {
  const set = new Set(have);
  return required.every((item) => set.has(item));
}

export function applyCapacityGate(worker, { capacityProbe } = {}) {
  validateWorker(worker);

  if (!capacityProbe) {
    return {
      worker: { ...worker },
      observedState: worker.state,
      source: worker.stateSource ?? "registry",
      observedAt: worker.stateObservedAt ?? null,
    };
  }

  const observation = capacityProbe(worker);
  assert(observation && WORKER_STATES.has(observation.state), "Capacity probe must return a valid state");

  return {
    worker: { ...worker, state: observation.state },
    observedState: observation.state,
    source: observation.source ?? "probe",
    observedAt: observation.observedAt ?? null,
  };
}

export function evaluateWorker(task, gatedWorker) {
  validateTask(task);
  const worker = validateWorker(gatedWorker.worker ?? gatedWorker);
  const state = gatedWorker.observedState ?? worker.state;
  const reasons = [];

  if (state !== "available") reasons.push(`state:${state}`);
  if (!hasAll(worker.capabilities, task.requiredCapabilities)) reasons.push("missing_capability");
  if (!hasAll(worker.permissions, task.requiredPermissions)) reasons.push("missing_permission");

  const quality = workerQuality(worker, task.category);
  if (quality < task.qualityFloor) reasons.push("below_quality_floor");

  const maxRiskTier = worker.maxRiskTier ?? 0;
  if (task.riskTier > maxRiskTier) reasons.push("risk_tier_exceeded");

  const specialtyScore = unique(worker.specialties).includes(task.category) ? 1 : 0;
  const contextScore = Number.isFinite(worker.contextScore) ? worker.contextScore : 0;

  return {
    workerId: worker.workerId,
    eligible: reasons.length === 0,
    reasons,
    state,
    quality,
    specialtyScore,
    contextScore,
    relativeCost: worker.relativeCost,
    source: gatedWorker.source ?? worker.stateSource ?? "registry",
    observedAt: gatedWorker.observedAt ?? worker.stateObservedAt ?? null,
  };
}

function compareEligible(a, b) {
  // Quality and fit first; resource cost only breaks ties after sufficiency.
  if (a.specialtyScore !== b.specialtyScore) return b.specialtyScore - a.specialtyScore;
  if (a.contextScore !== b.contextScore) return b.contextScore - a.contextScore;
  if (a.quality !== b.quality) return b.quality - a.quality;
  if (a.relativeCost !== b.relativeCost) return a.relativeCost - b.relativeCost;
  return a.workerId.localeCompare(b.workerId);
}

export function dispatchTask(task, workers, options = {}) {
  validateTask(task);
  assert(Array.isArray(workers) && workers.length > 0, "At least one worker required");

  const seen = new Set();
  const gated = workers.map((worker) => {
    validateWorker(worker);
    assert(!seen.has(worker.workerId), `Duplicate workerId: ${worker.workerId}`);
    seen.add(worker.workerId);
    return applyCapacityGate(worker, options);
  });

  const evaluations = gated.map((worker) => evaluateWorker(task, worker));
  const eligible = evaluations.filter((entry) => entry.eligible).sort(compareEligible);

  return {
    taskId: task.taskId,
    assignedWorker: eligible[0]?.workerId ?? null,
    status: eligible.length ? "assigned" : "blocked",
    evaluations,
    decision: eligible.length
      ? {
          rule: "quality_floor_then_fit_then_cost",
          selected: eligible[0].workerId,
        }
      : {
          rule: "no_eligible_worker",
          selected: null,
        },
  };
}


export function redispatchAfterWorkerSignal(task, workers, signal, options = {}) {
  validateTask(task);
  assert(signal && typeof signal === "object", "Worker signal required");
  assert(typeof signal.workerId === "string" && signal.workerId.length > 0, "signal.workerId required");
  assert(WORKER_STATES.has(signal.state), "Worker signal must contain a valid state");

  const updatedWorkers = workers.map((worker) =>
    worker.workerId === signal.workerId
      ? {
          ...worker,
          state: signal.state,
          stateSource: signal.source ?? "worker_signal",
          stateObservedAt: signal.observedAt ?? null,
        }
      : worker,
  );

  assert(
    updatedWorkers.some((worker) => worker.workerId === signal.workerId),
    `Unknown worker signal: ${signal.workerId}`,
  );

  const result = dispatchTask(task, updatedWorkers, options);
  return {
    ...result,
    reassignment: {
      fromWorker: signal.workerId,
      signalState: signal.state,
      signalSource: signal.source ?? "worker_signal",
      preservedTaskId: result.taskId === task.taskId,
    },
  };
}

export function createWorkerRegistry(workers) {
  const profiles = workers.map((worker) => validateWorker({ ...worker }));
  const byId = new Map();
  for (const worker of profiles) {
    assert(!byId.has(worker.workerId), `Duplicate workerId: ${worker.workerId}`);
    byId.set(worker.workerId, Object.freeze({ ...worker }));
  }
  return Object.freeze({
    list: () => [...byId.values()],
    get: (workerId) => byId.get(workerId) ?? null,
  });
}

export { WORKER_STATES };
