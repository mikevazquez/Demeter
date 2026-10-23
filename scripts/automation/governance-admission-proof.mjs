import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  admitGatewayAdmission,
  contractsFromGatewayAdmission,
  parseGatewayAdmissionComment,
} from "./governance-admission.mjs";
import { dispatchTask } from "./worker-dispatch.mjs";

const REPO = "mikevazquez/Demeter";
const ISSUE = 382;
const REQUEST_ID = "GOV-ROUTER-002-REQ-01";
const TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;

const ensure = (ok, message) => {
  if (!ok) throw new Error(message);
};

async function github(path) {
  ensure(TOKEN, "GitHub token required");
  const response = await fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(30_000),
  });
  ensure(response.ok, `GitHub GET failed (${response.status})`);
  return response.json();
}

function memoryStore() {
  let version = "v0";
  let state = {
    schema: "governance2-supervisor-v1",
    repository: REPO,
    sequence: 0,
    previous: null,
    active_task_id: null,
    updated_at: "2026-10-23T19:00:00.000Z",
    last_tick_at: "2026-10-23T19:00:00.000Z",
    tasks: [],
    legacy: { state: { history: [], entries: [] } },
  };
  return {
    async read() {
      return { version, state: structuredClone(state) };
    },
    async compareAndSwap(expected, next) {
      ensure(expected === version, "Unexpected in-memory CAS conflict");
      state = structuredClone(next);
      version = `v${next.sequence}`;
      return { version, state: structuredClone(state) };
    },
  };
}

async function findAdmission() {
  for (let page = 1; page <= 20; page++) {
    const comments = await github(`issues/${ISSUE}/comments?per_page=100&page=${page}`);
    ensure(Array.isArray(comments), "Issue comments response required");
    for (const comment of comments) {
      const parsed = parseGatewayAdmissionComment(comment);
      if (parsed?.request_id === REQUEST_ID) return parsed;
    }
    if (comments.length < 100) break;
  }
  throw new Error(`Admission ${REQUEST_ID} not found`);
}

const admission = await findAdmission();
const [contract] = contractsFromGatewayAdmission(admission);
ensure(contract, "Pilot contract missing");
ensure(
  contract.gateway.worker_selection === "deferred_to_dispatcher",
  "Worker was selected during intake",
);
ensure(!("worker_id" in contract) && !("assigned_worker" in contract), "Pinned worker detected");

const refPath = `git/ref/heads/${contract.branch}`;
const ref = await github(refPath);
ensure(ref.object?.sha === contract.base_sha, "Pilot branch does not match admitted base SHA");

const store = memoryStore();
await admitGatewayAdmission({ store, admission });
const snapshot = await store.read();
const task = snapshot.state.tasks.find((entry) => entry.task_id === contract.task_id);
ensure(task?.status === "queued", "Admission did not create a queued supervisor task");
ensure(task.attempts.length === 0, "Admission activated a worker too early");

const routing = dispatchTask(
  {
    taskId: contract.task_id,
    category: contract.category,
    requiredCapabilities: contract.required_capabilities,
    requiredPermissions: contract.required_permissions,
    qualityFloor: contract.quality_floor,
    riskTier: contract.risk_tier,
  },
  [
    {
      workerId: "claude-code-routine-worker",
      state: "available",
      capabilities: ["repository_review"],
      permissions: ["repository:read", "receipt:write"],
      quality: { default: 0.9 },
      relativeCost: 1,
      scarcityWeight: 0,
      maxRiskTier: 0,
    },
    {
      workerId: "codex-engineering-worker",
      state: "available",
      capabilities: ["repository_review"],
      permissions: ["repository:read", "receipt:write"],
      quality: { default: 0.95 },
      relativeCost: 1,
      scarcityWeight: 50,
      maxRiskTier: 4,
    },
  ],
);
ensure(
  routing.assignedWorker === "claude-code-routine-worker",
  "Scarce Codex was selected unnecessarily",
);

const evidence = {
  schema: "governance-gpt-admission-proof-v1",
  request_id: admission.request_id,
  source_comment_url: admission.source_comment_url,
  task_id: contract.task_id,
  base_sha: contract.base_sha,
  branch: contract.branch,
  admitted_status: task.status,
  attempts_after_admission: task.attempts.length,
  worker_selection_at_intake: contract.gateway.worker_selection,
  dispatcher_selected: routing.assignedWorker,
  codex_consumed: false,
};

await mkdir(resolve("supervisor-output"), { recursive: true });
await writeFile(
  resolve("supervisor-output", "admission-proof.json"),
  JSON.stringify(evidence, null, 2) + "\n",
);
process.stdout.write(JSON.stringify(evidence) + "\n");
