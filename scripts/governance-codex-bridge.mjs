import { admitCodexRequest } from "./governance-codex-intake.mjs";

/**
 * Dry-run bridge to the existing Codex coordinator queue schema.
 * Does not write queue.json, dispatch Actions, create issues or access credentials.
 * The coordinator itself remains the only component allowed to select tasks.
 */
export function previewCoordinatorAdmission(request, policy, existing = []) {
  const decision = admitCodexRequest(request, policy, existing);
  if (decision.state !== "admitted") return decision;
  return {
    state: "preview",
    requiresExplicitQueueAdmission: true,
    task: {
      id: decision.id,
      owner: decision.owner,
      status: "pending-admission",
      kind: "code",
      allowedPaths: [...decision.allowedPaths],
      checks: [],
      issueNumber: null,
      issueBodySha256: null,
      issueUpdatedAt: null,
    },
    fingerprint: decision.fingerprint,
    policyVersion: policy.version,
    controlBranch: "chore/governance-autonomous-coordinator-20261015",
    codexExecutionTriggered: false,
    productionAuthorized: false,
  };
}
