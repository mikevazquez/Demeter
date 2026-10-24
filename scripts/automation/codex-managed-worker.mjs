import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildCodexCommand } from "./supervisor-process.mjs";
import {
  createManagedWorkerDispatch,
  managedRuntimeEnvironment,
} from "./supervisor-managed-worker.mjs";

export const CODEX_MANAGED_WORKER_ID = "codex-managed-worker";

const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;

const ensure = (condition, message) => {
  if (!condition) throw new Error(message);
};

export function codexManagedRuntimeEnvironment(source = {}) {
  ensure(
    source && typeof source === "object" && !Array.isArray(source),
    "Runtime environment source required",
  );
  return managedRuntimeEnvironment(source, "codex-chatgpt");
}

export function probeCodexManagedHost({
  binary = "codex",
  spawnImpl = spawnSync,
  environment = process.env,
} = {}) {
  ensure(
    typeof binary === "string" && binary.length > 0 && !binary.includes("\0"),
    "Invalid Codex binary",
  );
  ensure(typeof spawnImpl === "function", "Codex probe adapter required");
  let result;
  try {
    result = spawnImpl(binary, ["login", "status"], {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 4096,
      env: codexManagedRuntimeEnvironment(environment),
    });
  } catch {
    return {
      state: "disconnected",
      stateSource: "codex_login_probe_failed",
    };
  }
  const output = `${result?.stdout ?? ""} ${result?.stderr ?? ""}`;
  if (result?.status === 0 && /Logged in using ChatGPT/.test(output))
    return {
      state: "available",
      stateSource: "codex_chatgpt_login_under_managed_environment",
    };
  return {
    state: "disconnected",
    stateSource:
      result?.error?.code === "ENOENT" ? "codex_cli_missing" : "codex_chatgpt_login_required",
  };
}

export function codexManagedWorkerProfile({ probe } = {}) {
  const trustedAvailable =
    probe?.state === "available" &&
    probe?.stateSource === "codex_chatgpt_login_under_managed_environment";
  return {
    workerId: CODEX_MANAGED_WORKER_ID,
    state: trustedAvailable ? "available" : "disconnected",
    stateSource: trustedAvailable
      ? probe.stateSource
      : (probe?.stateSource ?? "codex_host_not_registered"),
    capabilities: ["repository_review"],
    permissions: ["repository:read"],
    quality: { default: 0.92, software: 0.94 },
    relativeCost: 2,
    scarcityWeight: 5,
    maxRiskTier: 0,
  };
}

function runGit(cwd, args, spawnImpl) {
  const result = spawnImpl("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    env: codexManagedRuntimeEnvironment(process.env),
  });
  ensure(result?.status === 0, "Managed workspace inspection failed");
  return (result.stdout ?? "").trim();
}

export function inspectCodexManagedWorkspace(cwd, { spawnImpl = spawnSync } = {}) {
  ensure(
    typeof cwd === "string" && path.isAbsolute(cwd) && !cwd.includes("\0"),
    "Managed workspace must be an absolute path",
  );
  ensure(typeof spawnImpl === "function", "Workspace inspection adapter required");
  const root = runGit(cwd, ["rev-parse", "--show-toplevel"], spawnImpl);
  const branch = runGit(cwd, ["branch", "--show-current"], spawnImpl);
  const head = runGit(cwd, ["rev-parse", "HEAD"], spawnImpl);
  const status = runGit(cwd, ["status", "--porcelain", "--untracked-files=all"], spawnImpl);
  ensure(path.resolve(root) === path.resolve(cwd), "Managed workspace must be the repository root");
  ensure(branch.length > 0 && !branch.startsWith("refs/"), "Managed workspace branch required");
  ensure(SHA.test(head), "Managed workspace HEAD invalid");
  return { root, branch, head, clean: status === "" };
}

export function buildCodexManagedInput({ task, attempt, checkpoint, workspace } = {}) {
  ensure(task?.contract?.read_only === true, "Codex managed pilot is read-only only");
  ensure(
    task.contract.recovery?.mode === "read_only",
    "Codex managed pilot requires read-only recovery",
  );
  ensure(attempt?.worker_id === CODEX_MANAGED_WORKER_ID, "Codex managed worker identity mismatch");
  ensure(
    ID.test(task.task_id ?? "") && ID.test(attempt.attempt_id ?? ""),
    "Managed task identity invalid",
  );
  ensure(
    DIGEST.test(task.contract_sha256 ?? "") &&
      attempt.contract_sha256 === task.contract_sha256 &&
      DIGEST.test(attempt.dispatch_fingerprint ?? ""),
    "Managed task digest mismatch",
  );
  ensure(
    workspace?.branch === task.contract.branch &&
      workspace?.head === task.contract.base_sha &&
      workspace.clean === true,
    "Managed workspace differs from the admitted branch or SHA",
  );
  const envelope = {
    schema: "governance-codex-managed-delivery-v1",
    task_id: task.task_id,
    worker_id: CODEX_MANAGED_WORKER_ID,
    attempt_id: attempt.attempt_id,
    contract_sha256: task.contract_sha256,
    dispatch_fingerprint: attempt.dispatch_fingerprint,
    resume_checkpoint: checkpoint ?? null,
    contract: task.contract,
  };
  return [
    "Governance 2.0 Codex Managed Worker — read-only pilot.",
    "Work only on the admitted repository, branch and exact SHA.",
    "Do not edit files, commit, push, open or modify pull requests, merge, deploy, change settings, access production data or read credentials.",
    "Do not use API-key fallback. This host was admitted only after a ChatGPT-login probe under the same restricted runtime environment.",
    "Inspect only the allowed paths and run only the checks required by the contract.",
    "If identity, scope or SHA differs, stop without side effects.",
    "Your terminal event proves only process completion; Governance independently verifies evidence.",
    "",
    JSON.stringify(envelope, null, 2),
  ].join("\n");
}

export function buildCodexManagedRegistration({
  cwd,
  binary = "codex",
  timeoutMs = 20 * 60_000,
  inspectWorkspace = inspectCodexManagedWorkspace,
  outputFile,
} = {}) {
  ensure(
    typeof cwd === "string" && path.isAbsolute(cwd) && !cwd.includes("\0"),
    "Registered Codex workspace required",
  );
  ensure(typeof inspectWorkspace === "function", "Workspace inspector required");
  const command = buildCodexCommand({ binary, sandbox: "read-only" });
  if (outputFile !== undefined) {
    ensure(
      typeof outputFile === "string" &&
        path.isAbsolute(outputFile) &&
        !outputFile.includes("\0") &&
        (path.relative(cwd, outputFile) === ".." ||
          path.relative(cwd, outputFile).startsWith(`..${path.sep}`)),
      "Codex receipt output must be outside the workspace",
    );
    command.args.splice(command.args.length - 1, 0, "--output-last-message", outputFile);
  }
  return {
    worker_id: CODEX_MANAGED_WORKER_ID,
    command: command.command,
    environmentProfile: "codex-chatgpt",
    args: command.args,
    cwd,
    timeoutMs,
    inputForTask: ({ task, attempt, checkpoint }) =>
      buildCodexManagedInput({
        task,
        attempt,
        checkpoint,
        workspace: inspectWorkspace(cwd),
      }),
  };
}

export function createCodexManagedDispatch({
  store,
  cwd,
  binary = "codex",
  spawnImpl = spawnSync,
  environment = process.env,
  inspectWorkspace,
  onCheckpoint,
  now,
} = {}) {
  const probe = probeCodexManagedHost({ binary, spawnImpl, environment });
  const profile = codexManagedWorkerProfile({ probe });
  ensure(profile.state === "available", "Codex managed host is not ChatGPT-authenticated");
  const registration = buildCodexManagedRegistration({
    cwd,
    binary,
    ...(inspectWorkspace ? { inspectWorkspace } : {}),
  });
  return {
    profile,
    dispatch: createManagedWorkerDispatch({
      store,
      registration,
      onCheckpoint,
      now,
    }),
  };
}
