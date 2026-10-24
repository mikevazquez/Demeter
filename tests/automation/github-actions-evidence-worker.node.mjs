import assert from "node:assert/strict";
import test from "node:test";
import {
  evidenceWorkerProfile,
  GITHUB_ACTIONS_EVIDENCE_WORKER_ID,
  runGitHubActionsEvidenceWorker,
} from "../../scripts/automation/github-actions-evidence-worker.mjs";

const task = {
  task_id: "EVIDENCE-1",
  contract_sha256: "c".repeat(64),
  contract: {
    task_id: "EVIDENCE-1",
    repo: "mikevazquez/Demeter",
    branch: "governance2/evidence-1",
    base_sha: "a".repeat(40),
    read_only: true,
    required_capabilities: ["ci_evidence_review"],
  },
};

const attempt = {
  attempt_id: "attempt-1",
  worker_id: GITHUB_ACTIONS_EVIDENCE_WORKER_ID,
  contract_sha256: task.contract_sha256,
  dispatch_fingerprint: "d".repeat(64),
};

test("profile is a narrow read-only evidence worker, not a general coding worker", () => {
  const profile = evidenceWorkerProfile();
  assert.deepEqual(profile.capabilities, ["ci_evidence_review"]);
  assert.equal(profile.maxRiskTier, 0);
  assert.equal(profile.state, "available");
});

test("worker returns a correlated V2 receipt after an exact branch SHA match", async () => {
  const calls = [];
  const result = await runGitHubActionsEvidenceWorker({
    task,
    attempt,
    runUrl: "https://github.com/mikevazquez/Demeter/actions/runs/123",
    request: async (method, path) => {
      calls.push({ method, path });
      return { object: { type: "commit", sha: task.contract.base_sha } };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(result.status, "delivered");
  assert.equal(result.receipt.task_id, task.task_id);
  assert.equal(result.receipt.attempt_id, attempt.attempt_id);
  assert.equal(result.receipt.worker_id, GITHUB_ACTIONS_EVIDENCE_WORKER_ID);
  assert.equal(result.receipt.current_sha, task.contract.base_sha);
  assert.deepEqual(result.receipt.files_changed, []);
  assert.deepEqual(result.receipt.tests_passed, ["branch-sha-match"]);
  assert.equal(result.source.channel, "github_actions_run");
});

test("worker fails closed on writable scope, wrong capability or branch drift", async () => {
  const request = async () => ({ object: { type: "commit", sha: "b".repeat(40) } });
  await assert.rejects(
    runGitHubActionsEvidenceWorker({
      task: { ...task, contract: { ...task.contract, read_only: false } },
      attempt,
      request,
      runUrl: "https://github.com/mikevazquez/Demeter/actions/runs/123",
    }),
    /read-only/,
  );
  await assert.rejects(
    runGitHubActionsEvidenceWorker({
      task: {
        ...task,
        contract: { ...task.contract, required_capabilities: ["repository_review"] },
      },
      attempt,
      request,
      runUrl: "https://github.com/mikevazquez/Demeter/actions/runs/123",
    }),
    /capability/,
  );
  await assert.rejects(
    runGitHubActionsEvidenceWorker({
      task,
      attempt,
      request,
      runUrl: "https://github.com/mikevazquez/Demeter/actions/runs/123",
    }),
    /base SHA/,
  );
});
