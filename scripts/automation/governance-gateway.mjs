import { dispatchTask } from "./worker-dispatch.mjs";

const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SHA = /^[a-f0-9]{40}$/;
const FORBIDDEN_WORKER_KEYS = new Set([
  "assigned_worker",
  "assignedWorker",
  "preferred_worker",
  "preferredWorker",
  "worker_id",
  "workerId",
  "provider",
  "executor",
]);

const ensure = (ok, message) => {
  if (!ok) throw new Error(message);
};

function assertNoWorkerPinning(value, path = "plan") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    ensure(
      !FORBIDDEN_WORKER_KEYS.has(key),
      `Worker selection is forbidden at intake: ${path}.${key}`,
    );
    if (Array.isArray(child))
      child.forEach((entry, index) =>
        assertNoWorkerPinning(entry, `${path}.${key}[${index}]`),
      );
    else assertNoWorkerPinning(child, `${path}.${key}`);
  }
}

function stringArray(value, name, { min = 0, max = 40 } = {}) {
  ensure(
    Array.isArray(value) && value.length >= min && value.length <= max,
    `${name} must be an array`,
  );
  ensure(
    value.every((entry) => typeof entry === "string" && entry.length > 0),
    `${name} must contain strings`,
  );
  return [...new Set(value)];
}

function validateBlock(block) {
  ensure(block && typeof block === "object", "Gateway block required");
  ensure(ID.test(block.block_id ?? ""), "Valid block_id required");
  ensure(
    typeof block.objective === "string" && block.objective.length > 0,
    "Block objective required",
  );
  ensure(
    typeof block.category === "string" && block.category.length > 0,
    "Block category required",
  );
  ensure(
    Number.isInteger(block.risk_tier) &&
      block.risk_tier >= 0 &&
      block.risk_tier <= 4,
    "risk_tier must be 0-4",
  );
  ensure(
    Number.isFinite(block.quality_floor) &&
      block.quality_floor >= 0 &&
      block.quality_floor <= 1,
    "quality_floor must be 0-1",
  );
  ensure(typeof block.read_only === "boolean", "read_only must be explicit");
  ensure(
    typeof block.requires_uat === "boolean",
    "requires_uat must be explicit",
  );
  stringArray(block.required_capabilities, "required_capabilities");
  stringArray(block.required_permissions, "required_permissions");
  stringArray(block.allowed_paths, "allowed_paths", { min: 1 });
  stringArray(block.acceptance_criteria, "acceptance_criteria", { min: 1 });
  stringArray(block.definition_of_done, "definition_of_done", { min: 1 });
  stringArray(block.forbidden ?? [], "forbidden");
  ensure(
    Array.isArray(block.required_checks) && block.required_checks.length > 0,
    "required_checks required",
  );
  ensure(
    block.recovery &&
      ["manual", "read_only", "checkpoint"].includes(block.recovery.mode) &&
      Number.isInteger(block.recovery.max_attempts) &&
      block.recovery.max_attempts >= 1 &&
      block.recovery.max_attempts <= 3,
    "Valid recovery policy required",
  );
  return block;
}

export function validateGatewayPlan(plan) {
  ensure(plan && typeof plan === "object", "Gateway plan required");
  assertNoWorkerPinning(plan);
  ensure(ID.test(plan.plan_id ?? ""), "Valid plan_id required");
  ensure(
    typeof plan.objective === "string" && plan.objective.length > 0,
    "Plan objective required",
  );
  ensure(
    Array.isArray(plan.blocks) &&
      plan.blocks.length > 0 &&
      plan.blocks.length <= 20,
    "Plan blocks required",
  );
  const ids = new Set();
  for (const block of plan.blocks) {
    validateBlock(block);
    ensure(!ids.has(block.block_id), "Duplicate block_id");
    ids.add(block.block_id);
  }
  return plan;
}

export function createGatewayContracts(
  plan,
  {
    repo = "mikevazquez/Demeter",
    baseSha,
    branchPrefix = "governance2/gpt",
  } = {},
) {
  validateGatewayPlan(plan);
  ensure(repo === "mikevazquez/Demeter", "Unreviewed repository");
  ensure(SHA.test(baseSha ?? ""), "Exact base SHA required");
  ensure(
    typeof branchPrefix === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._/-]{0,100}$/.test(branchPrefix) &&
      !branchPrefix.includes(".."),
    "Valid branch prefix required",
  );

  return plan.blocks.map((block) => ({
    task_id: `${plan.plan_id}-${block.block_id}`,
    objective: block.objective,
    repo,
    branch: `${branchPrefix}/${plan.plan_id.toLowerCase()}-${block.block_id.toLowerCase()}`,
    base_sha: baseSha,
    read_only: block.read_only,
    requires_uat: block.requires_uat,
    allowed_paths: [...new Set(block.allowed_paths)],
    required_checks: block.required_checks.map((check) => ({ ...check })),
    recovery: { ...block.recovery },
    category: block.category,
    required_capabilities: [...new Set(block.required_capabilities)],
    required_permissions: [...new Set(block.required_permissions)],
    risk_tier: block.risk_tier,
    quality_floor: block.quality_floor,
    acceptance_criteria: [...new Set(block.acceptance_criteria)],
    definition_of_done: [...new Set(block.definition_of_done)],
    forbidden: [...new Set(block.forbidden ?? [])],
    dependencies: [...new Set(block.dependencies ?? [])],
    gateway: {
      schema: "governance-gpt-gateway-v1",
      plan_id: plan.plan_id,
      intake_owner: "governance",
      worker_selection: "deferred_to_dispatcher",
    },
  }));
}

function dispatchShape(contract) {
  return {
    taskId: contract.task_id,
    category: contract.category,
    requiredCapabilities: contract.required_capabilities,
    requiredPermissions: contract.required_permissions,
    qualityFloor: contract.quality_floor,
    riskTier: contract.risk_tier,
  };
}

export function routeGatewayContracts(contracts, workers, options = {}) {
  ensure(
    Array.isArray(contracts) && contracts.length > 0,
    "Gateway contracts required",
  );
  return contracts.map((contract) => ({
    contract,
    routing: dispatchTask(dispatchShape(contract), workers, options),
  }));
}
