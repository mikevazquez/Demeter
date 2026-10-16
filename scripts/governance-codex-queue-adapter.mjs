import { stageCoordinatorTask } from "./governance-codex-stage.mjs";

/**
 * Build a reviewable manifest for the existing coordinator. The manifest alone
 * cannot enqueue or dispatch work; the queue is still validated independently.
 */
export function buildReviewedIntake(request, policy, evidence, existing = []) {
  const staged = stageCoordinatorTask(request, policy, evidence, existing);
  if (staged.state !== "staged") return staged;
  if (staged.task.owner !== "codex-1")
    return { state: "blocked", reason: "unsupported-owner" };
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(staged.task.id))
    return { state: "blocked", reason: "invalid-id" };
  if (staged.task.allowedPaths.some((p) =>
    !/^tests\/.*\.(ts|tsx|js|mjs|json|css)$/.test(p)))
    return { state: "blocked", reason: "coordinator-scope" };
  if (staged.task.checks.some((check) => !["node", "npm"].includes(check[0])))
    return { state: "blocked", reason: "unsupported-check" };
  return {
    state: "review-required",
    manifest: {
      mode: "reviewed",
      tasks: [{
        state: "pending-review",
        task: { ...staged.task, status: "pending-review" },
        fingerprint: staged.fingerprint,
      }],
    },
    enqueuePerformed: false,
    dispatchPerformed: false,
    productionAuthorized: false,
  };
}
