import { describe, expect, it } from "vitest";
import {
  WORKER_STATES,
  applyCapacityGate,
  createWorkerRegistry,
  dispatchTask,
  evaluateWorker,
  redispatchAfterWorkerSignal,
} from "../../scripts/automation/worker-dispatch.mjs";

const engineeringTask = {
  taskId: "GOV-PILOT-01",
  category: "engineering",
  requiredCapabilities: ["code", "git", "tests"],
  requiredPermissions: ["repo:write", "sandbox"],
  qualityFloor: 0.9,
  riskTier: 3,
};

const codex = {
  workerId: "codex",
  provider: "openai",
  state: "available",
  stateSource: "registry",
  capabilities: ["code", "git", "tests", "architecture", "terminal"],
  permissions: ["repo:write", "sandbox"],
  quality: { default: 0.9, engineering: 0.98 },
  specialties: ["engineering", "architecture"],
  contextScore: 0.8,
  relativeCost: 5,
  maxRiskTier: 4,
};

const cloud = {
  workerId: "cloud",
  provider: "external",
  state: "available",
  stateSource: "registry",
  capabilities: ["code", "git", "tests"],
  permissions: ["repo:write", "sandbox"],
  quality: { default: 0.9, engineering: 0.94 },
  specialties: ["engineering"],
  contextScore: 0.5,
  relativeCost: 3,
  maxRiskTier: 3,
};

describe("Governance worker dispatch", () => {
  it("defines the canonical worker states", () => {
    expect([...WORKER_STATES].sort()).toEqual(
      ["available", "busy", "degraded", "disconnected", "no_capacity"].sort(),
    );
  });

  it("selects Codex when both workers are available and Codex has the stronger engineering fit", () => {
    const result = dispatchTask(engineeringTask, [cloud, codex]);
    expect(result.status).toBe("assigned");
    expect(result.assignedWorker).toBe("codex");
    expect(result.decision.rule).toBe("quality_floor_then_fit_then_cost");
  });

  it("falls back to Cloud when the capacity gate observes Codex with no capacity", () => {
    const result = dispatchTask(engineeringTask, [codex, cloud], {
      capacityProbe: (worker) =>
        worker.workerId === "codex"
          ? {
              state: "no_capacity",
              source: "pilot-capacity-probe",
              observedAt: "2026-10-19T13:30:00-06:00",
            }
          : {
              state: worker.state,
              source: "pilot-capacity-probe",
              observedAt: "2026-10-19T13:30:00-06:00",
            },
    });

    expect(result.taskId).toBe(engineeringTask.taskId);
    expect(result.status).toBe("assigned");
    expect(result.assignedWorker).toBe("cloud");

    const codexEvaluation = result.evaluations.find((entry) => entry.workerId === "codex");
    expect(codexEvaluation.eligible).toBe(false);
    expect(codexEvaluation.reasons).toContain("state:no_capacity");
    expect(codexEvaluation.source).toBe("pilot-capacity-probe");
  });

  it("redispatches the same task after Codex reports no capacity", () => {
    const first = dispatchTask(engineeringTask, [codex, cloud]);
    expect(first.assignedWorker).toBe("codex");

    const second = redispatchAfterWorkerSignal(
      engineeringTask,
      [codex, cloud],
      {
        workerId: "codex",
        state: "no_capacity",
        source: "executor_limit_signal",
        observedAt: "2026-10-19T13:35:00-06:00",
      },
    );

    expect(second.taskId).toBe(engineeringTask.taskId);
    expect(second.reassignment.preservedTaskId).toBe(true);
    expect(second.reassignment.fromWorker).toBe("codex");
    expect(second.reassignment.signalState).toBe("no_capacity");
    expect(second.assignedWorker).toBe("cloud");
  });

  it("blocks rather than lowering the quality floor", () => {
    const weakWorker = {
      ...cloud,
      workerId: "cheap-worker",
      quality: { default: 0.7, engineering: 0.75 },
      relativeCost: 1,
    };

    const result = dispatchTask(engineeringTask, [weakWorker]);
    expect(result.status).toBe("blocked");
    expect(result.assignedWorker).toBeNull();
    expect(result.evaluations[0].reasons).toContain("below_quality_floor");
  });

  it("blocks a worker that lacks a required permission even if quality is high", () => {
    const readOnly = {
      ...codex,
      workerId: "readonly",
      permissions: ["sandbox"],
    };

    const result = dispatchTask(engineeringTask, [readOnly]);
    expect(result.status).toBe("blocked");
    expect(result.evaluations[0].reasons).toContain("missing_permission");
  });

  it("uses lower resource cost only after workers have equivalent fit and quality", () => {
    const expensive = {
      ...cloud,
      workerId: "expensive",
      contextScore: 0.5,
      relativeCost: 8,
    };
    const efficient = {
      ...cloud,
      workerId: "efficient",
      contextScore: 0.5,
      relativeCost: 2,
    };

    const result = dispatchTask(engineeringTask, [expensive, efficient]);
    expect(result.assignedWorker).toBe("efficient");
  });

  it("does not let a cheap worker beat a better specialist merely on cost", () => {
    const cheapGeneralist = {
      ...cloud,
      workerId: "cheap-generalist",
      specialties: [],
      quality: { default: 0.99, engineering: 0.99 },
      relativeCost: 1,
    };

    const result = dispatchTask(engineeringTask, [codex, cheapGeneralist]);
    expect(result.assignedWorker).toBe("codex");
  });

  it("accepts a registry state when no live capacity probe exists", () => {
    const gated = applyCapacityGate(
      { ...codex, state: "no_capacity", stateSource: "user_report" },
      {},
    );
    expect(gated.observedState).toBe("no_capacity");
    expect(gated.source).toBe("user_report");
  });

  it("preserves a generic registry without provider-specific dispatch logic", () => {
    const registry = createWorkerRegistry([codex, cloud]);
    expect(registry.get("codex").provider).toBe("openai");
    expect(registry.get("cloud").provider).toBe("external");
    expect(registry.list()).toHaveLength(2);

    const evaluation = evaluateWorker(
      engineeringTask,
      applyCapacityGate(registry.get("cloud")),
    );
    expect(evaluation.eligible).toBe(true);
  });
});
