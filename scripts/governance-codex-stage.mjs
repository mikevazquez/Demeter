import { previewCoordinatorAdmission } from "./governance-codex-bridge.mjs";

/**
 * Fail-closed adapter: only a task backed by a separately admitted, immutable
 * GitHub issue and matching policy may be offered to the existing coordinator.
 * This function has no side effects and cannot trigger a workflow.
 */
export function stageCoordinatorTask(request, policy, evidence, existing = []) {
  const preview = previewCoordinatorAdmission(request, policy, existing);
  if (preview.state !== "preview") return preview;
  if (!evidence || !Number.isSafeInteger(evidence.issueNumber) || evidence.issueNumber <= 0 ||
      !/^[a-f0-9]{64}$/.test(evidence.issueBodySha256 ?? "") ||
      typeof evidence.issueUpdatedAt !== "string" ||
      !Number.isFinite(Date.parse(evidence.issueUpdatedAt)) ||
      evidence.issueApproved !== true)
    return { state: "blocked", reason: "issue-evidence" };
  if (evidence.policyVersion !== policy.version ||
      evidence.requestFingerprint !== preview.fingerprint ||
      evidence.issueTaskId !== request.id)
    return { state: "blocked", reason: "evidence-mismatch" };
  if (!Array.isArray(evidence.checks) || evidence.checks.length === 0 ||
      evidence.checks.some((c) => !Array.isArray(c) || c.length === 0 ||
        c.some((v) => typeof v !== "string" || !v.length)))
    return { state: "blocked", reason: "checks" };
  if (evidence.existingCoordinatorTask === true)
    return { state: "blocked", reason: "already-admitted" };
  return {
    state: "staged",
    task: {
      ...preview.task,
      issueNumber: evidence.issueNumber,
      issueBodySha256: evidence.issueBodySha256,
      issueUpdatedAt: evidence.issueUpdatedAt,
      checks: evidence.checks.map((check) => [...check]),
      requiredText: evidence.requiredText ?? [],
      status: "pending-review",
    },
    fingerprint: preview.fingerprint,
    requiresQueueReview: true,
    codexExecutionTriggered: false,
    productionAuthorized: false,
  };
}
