import assert from "node:assert/strict";
import test from "node:test";
import {
  createGatewayContracts,
  routeGatewayContracts,
  validateGatewayPlan,
} from "../../scripts/automation/governance-gateway.mjs";

const SHA = "a".repeat(40);

const plan = () => ({
  plan_id: "GOV-ROUTER-001-DEMO",
  objective: "Implementar un cambio sin fijar proveedor antes del dispatch.",
  blocks: [
    {
      block_id: "B1",
      objective: "Analizar y documentar el cambio.",
      category: "analysis",
      risk_tier: 1,
      quality_floor: 0.9,
      read_only: true,
      requires_uat: false,
      required_capabilities: ["reasoning"],
      required_permissions: ["repository:read"],
      allowed_paths: ["docs/automation/"],
      required_checks: [{ name: "supervisor-tests", app_slug: "github-actions" }],
      acceptance_criteria: ["El análisis conserva alcance y evidencia."],
      definition_of_done: ["Existe un resultado verificable."],
      forbidden: ["Producción"],
      recovery: { mode: "read_only", max_attempts: 2 },
    },
  ],
});

test("gateway intake rejects worker/provider pinning", () => {
  const pinned = plan();
  pinned.blocks[0].preferred_worker = "codex";
  assert.throws(() => validateGatewayPlan(pinned), /Worker selection is forbidden at intake/);
});

test("gateway creates neutral supervisor contracts", () => {
  const [contract] = createGatewayContracts(plan(), { baseSha: SHA });
  assert.equal(contract.task_id, "GOV-ROUTER-001-DEMO-B1");
  assert.equal(contract.gateway.worker_selection, "deferred_to_dispatcher");
  assert.equal(contract.assigned_worker, undefined);
  assert.equal(contract.worker_id, undefined);
  assert.deepEqual(contract.required_capabilities, ["reasoning"]);
});

test("sufficient lower-cost worker is selected without spending scarce Codex", () => {
  const contracts = createGatewayContracts(plan(), { baseSha: SHA });
  const workers = [
    {
      workerId: "gpt-supervisor-worker",
      state: "available",
      capabilities: ["reasoning"],
      permissions: ["repository:read"],
      quality: { default: 0.91 },
      relativeCost: 0,
      scarcityWeight: 0,
      maxRiskTier: 2,
    },
    {
      workerId: "codex-engineering-worker",
      state: "available",
      capabilities: ["reasoning"],
      permissions: ["repository:read"],
      quality: { default: 0.99 },
      relativeCost: 1,
      scarcityWeight: 50,
      maxRiskTier: 4,
    },
  ];
  const [result] = routeGatewayContracts(contracts, workers);
  assert.equal(result.routing.status, "assigned");
  assert.equal(result.routing.assignedWorker, "gpt-supervisor-worker");
});

test("scarce worker remains eligible when it is the only worker meeting the floor", () => {
  const contracts = createGatewayContracts(plan(), { baseSha: SHA });
  const workers = [
    {
      workerId: "gpt-supervisor-worker",
      state: "available",
      capabilities: ["reasoning"],
      permissions: ["repository:read"],
      quality: { default: 0.85 },
      relativeCost: 0,
      scarcityWeight: 0,
      maxRiskTier: 2,
    },
    {
      workerId: "codex-engineering-worker",
      state: "available",
      capabilities: ["reasoning"],
      permissions: ["repository:read"],
      quality: { default: 0.99 },
      relativeCost: 1,
      scarcityWeight: 50,
      maxRiskTier: 4,
    },
  ];
  const [result] = routeGatewayContracts(contracts, workers);
  assert.equal(result.routing.assignedWorker, "codex-engineering-worker");
  assert.match(
    result.routing.evaluations.find((entry) => entry.workerId === "gpt-supervisor-worker").reasons.join(","),
    /below_quality_floor/,
  );
});
