const SHA = /^[a-f0-9]{40}$/;

const ensure = (condition, message) => {
  if (!condition) throw new Error(message);
};

export const GITHUB_ACTIONS_EVIDENCE_WORKER_ID = "github-actions-evidence-worker";

export function evidenceWorkerProfile() {
  return {
    workerId: GITHUB_ACTIONS_EVIDENCE_WORKER_ID,
    state: "available",
    stateSource: "governance_actions_runtime",
    capabilities: ["ci_evidence_review"],
    permissions: ["repository:read", "receipt:write"],
    quality: { default: 0.95, governance_verification: 0.98 },
    relativeCost: 2,
    maxRiskTier: 0,
  };
}

export async function runGitHubActionsEvidenceWorker({ task, attempt, request, runUrl } = {}) {
  ensure(task?.contract?.read_only === true, "Evidence worker accepts read-only tasks only");
  ensure(
    task.contract.required_capabilities?.includes("ci_evidence_review"),
    "Evidence worker capability was not requested",
  );
  ensure(attempt?.worker_id === GITHUB_ACTIONS_EVIDENCE_WORKER_ID, "Evidence worker mismatch");
  ensure(typeof request === "function", "Evidence worker request adapter required");
  ensure(
    /^https:\/\/github\.com\/mikevazquez\/Demeter\/actions\/runs\/\d+$/.test(runUrl ?? ""),
    "Evidence worker requires a trusted Governance Actions run",
  );
  ensure(task.contract.repo === "mikevazquez/Demeter", "Evidence worker repository mismatch");
  ensure(SHA.test(task.contract.base_sha ?? ""), "Evidence worker base SHA invalid");

  const ref = await request(
    "GET",
    `repos/mikevazquez/Demeter/git/ref/heads/${task.contract.branch}`,
  );
  ensure(
    ref?.object?.type === "commit" && ref.object.sha === task.contract.base_sha,
    "Evidence worker branch no longer matches the admitted base SHA",
  );

  return {
    status: "delivered",
    terminal_observed: true,
    process_group_closed: true,
    receipt: {
      schema: "governance-worker-receipt-v2",
      task_id: task.task_id,
      worker_id: attempt.worker_id,
      attempt_id: attempt.attempt_id,
      contract_sha256: task.contract_sha256,
      dispatch_fingerprint: attempt.dispatch_fingerprint,
      status: "completed",
      base_sha: task.contract.base_sha,
      current_sha: task.contract.base_sha,
      files_changed: [],
      commands_run: ["github:get-branch-ref"],
      tests_passed: ["branch-sha-match"],
      blockers: [],
      remaining_work: [],
      next_action: "Supervisor verifies the required GitHub checks independently.",
    },
    source: {
      author: "github-actions[bot]",
      channel: "github_actions_run",
      receipt_url: runUrl,
    },
  };
}
