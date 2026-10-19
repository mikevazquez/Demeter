import { createHash } from "node:crypto";

const assert = (value, message) => {
  if (!value) throw new Error(message);
};

const ROUTINE_PATH = /^\/v1\/claude_code\/routines\/trig_[A-Za-z0-9_-]+\/fire$/;

export function validateTaskContract(contract) {
  assert(
    contract && typeof contract === "object" && !Array.isArray(contract),
    "Task contract required",
  );
  for (const field of ["task_id", "objective", "repo", "branch", "base_sha"]) {
    assert(typeof contract[field] === "string" && contract[field].length > 0, `${field} required`);
  }
  assert(/^[a-f0-9]{40}$/.test(contract.base_sha), "base_sha must be a full commit SHA");
  assert(Array.isArray(contract.acceptance_criteria ?? []), "acceptance_criteria must be an array");
  assert(Array.isArray(contract.definition_of_done ?? []), "definition_of_done must be an array");
  assert(Array.isArray(contract.forbidden ?? []), "forbidden must be an array");
  return contract;
}

export function buildRoutineText(contract) {
  validateTaskContract(contract);
  return [
    "Governance 2.0 Task Contract",
    `Dispatch fingerprint: ${dispatchFingerprint(contract)}`,
    "",
    "Preserve task_id exactly. Work only within the declared repository, branch, SHA, scope and gates.",
    "Do not broaden scope, merge to main, deploy production, access production data, or use secrets unless the contract explicitly authorizes it.",
    "Before editing, verify the remote branch still matches base_sha. If it does not, stop and return BLOCKED.",
    "Run applicable checks and return a structured checkpoint with task_id, worker_id, dispatch_fingerprint, base_sha, current_sha, files_changed, commands_run, tests_passed, blockers, remaining_work and next_action.",
    "For completion receipts: preserve dispatch_fingerprint exactly; status must be lowercase completed, blocked, or failed; tests_passed must be an array of passed check names (use [] when none).",
    "",
    JSON.stringify(contract, null, 2),
  ].join("\n");
}

export function validateRoutineFireUrl(value) {
  const url = new URL(value);
  assert(url.protocol === "https:", "Routine fire URL must use HTTPS");
  assert(url.hostname === "api.anthropic.com", "Routine fire URL must use api.anthropic.com");
  assert(ROUTINE_PATH.test(url.pathname), "Unexpected Claude routine fire path");
  assert(
    url.search === "" && url.hash === "",
    "Routine fire URL must not contain query or fragment",
  );
  return url.toString();
}

export function classifyRoutineError(status) {
  if (status === 429) return "no_capacity";
  if (status === 503) return "degraded";
  if (status === 401 || status === 403 || status === 404) return "disconnected";
  return "failed";
}

export function dispatchFingerprint(contract) {
  validateTaskContract(contract);
  return createHash("sha256")
    .update([contract.task_id, contract.repo, contract.branch, contract.base_sha].join("\n"))
    .digest("hex");
}

export async function fireClaudeRoutine({
  fireUrl,
  token,
  contract,
  fetchImpl = globalThis.fetch,
}) {
  assert(typeof token === "string" && token.length > 0, "Routine token required");
  assert(typeof fetchImpl === "function", "fetch implementation required");
  const url = validateRoutineFireUrl(fireUrl);
  const text = buildRoutineText(contract);

  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });
  } catch (error) {
    return {
      task_id: contract.task_id,
      status: "uncertain",
      worker_state: "degraded",
      dispatch_fingerprint: dispatchFingerprint(contract),
      error: error instanceof Error ? error.message : String(error),
    };
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    return {
      task_id: contract.task_id,
      status: "rejected",
      worker_state: classifyRoutineError(response.status),
      http_status: response.status,
      dispatch_fingerprint: dispatchFingerprint(contract),
      error_type: payload?.error?.type ?? null,
      error_message: payload?.error?.message ?? null,
    };
  }

  assert(payload?.type === "routine_fire", "Unexpected Claude routine response type");
  assert(
    typeof payload.claude_code_session_id === "string" && payload.claude_code_session_id.length > 0,
    "Claude routine response missing session ID",
  );
  const sessionUrl = new URL(payload.claude_code_session_url);
  assert(
    sessionUrl.protocol === "https:" && sessionUrl.hostname === "claude.ai",
    "Invalid Claude session URL",
  );

  return {
    task_id: contract.task_id,
    status: "dispatched",
    worker_state: "busy",
    worker_id: "claude-code-web",
    dispatch_fingerprint: dispatchFingerprint(contract),
    claude_code_session_id: payload.claude_code_session_id,
    claude_code_session_url: sessionUrl.toString(),
  };
}

async function main() {
  const encoded = process.env.GOVERNANCE_TASK_CONTRACT_B64;
  const fireUrl = process.env.CLAUDE_ROUTINE_FIRE_URL;
  const token = process.env.CLAUDE_ROUTINE_FIRE_TOKEN;
  assert(encoded, "GOVERNANCE_TASK_CONTRACT_B64 required");
  const contract = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
  const result = await fireClaudeRoutine({ fireUrl, token, contract });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.status !== "dispatched") process.exitCode = 2;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
