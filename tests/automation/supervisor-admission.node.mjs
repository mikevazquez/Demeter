import assert from "node:assert/strict";
import test from "node:test";
import {
  admitGatewayAdmission,
  contractsFromGatewayAdmission,
  parseGatewayAdmissionComment,
} from "../../scripts/automation/governance-admission.mjs";

const SHA = "a".repeat(40);

function plan() {
  return {
    plan_id: "GOV-ROUTER-002-PILOT",
    objective: "Admitir una revisión de lectura desde ChatGPT.",
    blocks: [
      {
        block_id: "B1",
        objective: "Revisar documentación de Governance sin modificar fuentes.",
        category: "software",
        risk_tier: 0,
        quality_floor: 0.9,
        read_only: true,
        requires_uat: false,
        required_capabilities: ["repository_review"],
        required_permissions: ["repository:read", "receipt:write"],
        allowed_paths: ["docs/automation/"],
        required_checks: [{ name: "supervisor-tests", app_slug: "github-actions" }],
        acceptance_criteria: ["El worker devuelve evidencia correlacionada."],
        definition_of_done: ["El supervisor puede verificar el receipt."],
        forbidden: ["Producción", "Modificar fuentes"],
        recovery: { mode: "read_only", max_attempts: 2 },
      },
    ],
  };
}

function comment(overrides = {}) {
  const payload = {
    schema: "governance-gpt-admission-v1",
    request_id: "GOV-ROUTER-002-REQ-01",
    repository: "mikevazquez/Demeter",
    environment: "sandbox",
    production_authorized: false,
    base_sha: SHA,
    plan: plan(),
  };
  return {
    user: { login: "mikevazquez" },
    html_url: "https://github.com/mikevazquez/Demeter/issues/382#issuecomment-123",
    created_at: "2026-10-23T19:10:00Z",
    body: `GOVERNANCE_GPT_ADMISSION_V1\n\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``,
    ...overrides,
  };
}

test("trusted ChatGPT admission becomes neutral contracts with durable source", () => {
  const admission = parseGatewayAdmissionComment(comment());
  const [contract] = contractsFromGatewayAdmission(admission);
  assert.equal(contract.task_id, "GOV-ROUTER-002-PILOT-B1");
  assert.equal(contract.gateway.worker_selection, "deferred_to_dispatcher");
  assert.equal(
    contract.gateway.admission_comment_url,
    "https://github.com/mikevazquez/Demeter/issues/382#issuecomment-123",
  );
  assert.equal(contract.worker_id, undefined);
});

test("third-party admission is ignored without blocking the supervisor", () => {
  assert.equal(
    parseGatewayAdmissionComment(comment({ user: { login: "attacker" } })),
    null,
  );
});

test("worker pinning inside an admission is rejected", () => {
  const c = comment();
  const payload = JSON.parse(c.body.match(/```json\n([\s\S]*?)\n```/)[1]);
  payload.plan.blocks[0].preferred_worker = "codex";
  c.body = `GOVERNANCE_GPT_ADMISSION_V1\n\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;
  assert.throws(() => parseGatewayAdmissionComment(c), /Worker selection is forbidden at intake/);
});

test("production authorization cannot be smuggled through gateway intake", () => {
  const c = comment();
  const payload = JSON.parse(c.body.match(/```json\n([\s\S]*?)\n```/)[1]);
  payload.production_authorized = true;
  c.body = `GOVERNANCE_GPT_ADMISSION_V1\n\n\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``;
  assert.throws(() => parseGatewayAdmissionComment(c), /cannot authorize production/);
});

test("same admitted contract is idempotent through supervisor admission", async () => {
  const admission = parseGatewayAdmissionComment(comment());
  const states = [];
  const initial = {
    schema: "governance2-supervisor-v1",
    repository: "mikevazquez/Demeter",
    sequence: 0,
    previous: null,
    active_task_id: null,
    updated_at: "2026-10-23T19:00:00.000Z",
    last_tick_at: "2026-10-23T19:00:00.000Z",
    tasks: [],
    legacy: { state: { history: [], entries: [] } },
  };
  let version = "v0";
  let state = structuredClone(initial);
  const store = {
    async read() {
      return { version, state: structuredClone(state) };
    },
    async compareAndSwap(expected, next) {
      assert.equal(expected, version);
      state = structuredClone(next);
      version = `v${next.sequence}`;
      states.push(structuredClone(next));
      return { version, state: structuredClone(state) };
    },
  };

  const first = await admitGatewayAdmission({ store, admission });
  const second = await admitGatewayAdmission({ store, admission });
  assert.equal(first.results[0].action, "admitted");
  assert.equal(second.results[0].action, "already_admitted");
  assert.equal(states.length, 1);
  assert.equal(state.tasks.length, 1);
});
