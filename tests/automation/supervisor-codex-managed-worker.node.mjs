import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  CODEX_MANAGED_WORKER_ID,
  buildCodexManagedInput,
  buildCodexManagedRegistration,
  codexManagedRuntimeEnvironment,
  codexManagedWorkerProfile,
  inspectCodexManagedWorkspace,
  probeCodexManagedHost,
} from "../../scripts/automation/codex-managed-worker.mjs";

const BASE = "a".repeat(40);
const CONTRACT = "b".repeat(64);
const FINGERPRINT = "c".repeat(64);

function fixture() {
  const contract = {
    task_id: "GOV-CODEX-005-PILOT",
    objective: "Inspect the admitted candidate without changes.",
    repo: "mikevazquez/Demeter",
    branch: "feat/codex-pilot",
    base_sha: BASE,
    read_only: true,
    requires_uat: false,
    allowed_paths: ["scripts/automation/"],
    required_checks: [{ name: "supervisor-tests", app_slug: "github-actions" }],
    recovery: { mode: "read_only", max_attempts: 2 },
    category: "software",
    required_capabilities: ["repository_review"],
    required_permissions: ["repository:read"],
    acceptance_criteria: ["Inspect only."],
    definition_of_done: ["No writes."],
    forbidden: ["No production."],
  };
  const task = {
    task_id: contract.task_id,
    contract,
    contract_sha256: CONTRACT,
  };
  const attempt = {
    attempt_id: "attempt-1",
    worker_id: CODEX_MANAGED_WORKER_ID,
    contract_sha256: CONTRACT,
    dispatch_fingerprint: FINGERPRINT,
  };
  const workspace = {
    root: "/tmp/demeter-codex-managed",
    branch: contract.branch,
    head: BASE,
    clean: true,
  };
  return { task, attempt, workspace };
}

test("runtime environment drops auth, GitHub and product secrets", () => {
  assert.deepEqual(
    codexManagedRuntimeEnvironment({
      PATH: "/bin",
      TMPDIR: "/tmp",
      LANG: "en_US.UTF-8",
      HOME: "/secret-home",
      CODEX_HOME: "/secret-codex",
      OPENAI_API_KEY: "secret",
      GITHUB_TOKEN: "secret",
      GH_TOKEN: "secret",
      NEXT_PUBLIC_SUPABASE_URL: "secret",
    }),
    {
      PATH: "/bin",
      TMPDIR: "/tmp",
      LANG: "en_US.UTF-8",
    },
  );
});

test("host is available only for ChatGPT login under the restricted environment", () => {
  let observed;
  const available = probeCodexManagedHost({
    environment: {
      PATH: "/bin",
      HOME: "/must-not-pass",
      OPENAI_API_KEY: "must-not-pass",
    },
    spawnImpl(command, args, options) {
      observed = { command, args, options };
      return { status: 0, stdout: "Logged in using ChatGPT\n", stderr: "" };
    },
  });
  assert.deepEqual(available, {
    state: "available",
    stateSource: "codex_chatgpt_login_under_managed_environment",
  });
  assert.equal(observed.command, "codex");
  assert.deepEqual(observed.args, ["login", "status"]);
  assert.deepEqual(observed.options.env, { PATH: "/bin" });

  const apiKey = probeCodexManagedHost({
    spawnImpl: () => ({ status: 0, stdout: "Logged in using an API key", stderr: "" }),
  });
  assert.equal(apiKey.state, "disconnected");
  assert.equal(apiKey.stateSource, "codex_chatgpt_login_required");

  const missing = probeCodexManagedHost({
    spawnImpl: () => ({ status: null, stdout: "", stderr: "", error: { code: "ENOENT" } }),
  });
  assert.deepEqual(missing, {
    state: "disconnected",
    stateSource: "codex_cli_missing",
  });
});

test("worker profile never trusts a synthetic available state", () => {
  assert.equal(codexManagedWorkerProfile().state, "disconnected");
  assert.equal(
    codexManagedWorkerProfile({
      probe: { state: "available", stateSource: "owner_worker_state_signal" },
    }).state,
    "disconnected",
  );
  const profile = codexManagedWorkerProfile({
    probe: {
      state: "available",
      stateSource: "codex_chatgpt_login_under_managed_environment",
    },
  });
  assert.equal(profile.state, "available");
  assert.deepEqual(profile.capabilities, ["repository_review"]);
  assert.deepEqual(profile.permissions, ["repository:read"]);
  assert.equal(profile.maxRiskTier, 0);
  assert.equal(profile.scarcityWeight, 5);
});

test("workspace inspection requires exact root, branch, SHA and reports dirty state", () => {
  const cwd = path.resolve("/tmp/demeter-codex-managed");
  const responses = new Map([
    ["rev-parse --show-toplevel", cwd],
    ["branch --show-current", "feat/codex-pilot"],
    ["rev-parse HEAD", BASE],
    ["status --porcelain --untracked-files=all", " M scripts/automation/example.mjs"],
  ]);
  const workspace = inspectCodexManagedWorkspace(cwd, {
    spawnImpl(command, args) {
      assert.equal(command, "git");
      const key = args.slice(2).join(" ");
      return { status: 0, stdout: `${responses.get(key) ?? ""}\n`, stderr: "" };
    },
  });
  assert.deepEqual(workspace, {
    root: cwd,
    branch: "feat/codex-pilot",
    head: BASE,
    clean: false,
  });
});

test("managed input preserves identities and blocks write or drift", () => {
  const { task, attempt, workspace } = fixture();
  const input = buildCodexManagedInput({ task, attempt, checkpoint: null, workspace });
  assert.match(input, /GOV-CODEX-005-PILOT/);
  assert.match(input, new RegExp(CONTRACT));
  assert.match(input, new RegExp(FINGERPRINT));
  assert.match(input, /Do not edit files/);
  assert.doesNotMatch(input, /OPENAI_API_KEY|GITHUB_TOKEN/);

  assert.throws(
    () =>
      buildCodexManagedInput({
        task: { ...task, contract: { ...task.contract, read_only: false } },
        attempt,
        workspace,
      }),
    /read-only/,
  );
  assert.throws(
    () =>
      buildCodexManagedInput({
        task,
        attempt,
        workspace: { ...workspace, head: "d".repeat(40) },
      }),
    /workspace differs/,
  );
  assert.throws(
    () =>
      buildCodexManagedInput({
        task,
        attempt,
        workspace: { ...workspace, clean: false },
      }),
    /workspace differs/,
  );
});

test("registration uses Codex JSONL managed mode and rechecks workspace before input", () => {
  const cwd = path.resolve("/tmp/demeter-codex-managed");
  const { task, attempt, workspace } = fixture();
  let inspections = 0;
  const registration = buildCodexManagedRegistration({
    cwd,
    inspectWorkspace(value) {
      inspections++;
      assert.equal(value, cwd);
      return workspace;
    },
  });
  assert.equal(registration.worker_id, CODEX_MANAGED_WORKER_ID);
  assert.equal(registration.command, "codex");
  assert.deepEqual(registration.args, ["exec", "--json", "--sandbox", "read-only", "-"]);
  assert.equal(registration.cwd, cwd);
  assert.equal(registration.timeoutMs, 20 * 60_000);
  const input = registration.inputForTask({ task, attempt, checkpoint: null });
  assert.equal(inspections, 1);
  assert.match(input, /Governance 2\.0 Codex Managed Worker/);
});
