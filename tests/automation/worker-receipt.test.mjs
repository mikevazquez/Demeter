import { describe, expect, it } from "vitest";
import {
  WORKER_RECEIPT_MARKER,
  findMatchingWorkerReceipt,
  parseWorkerReceipt,
  serializeWorkerReceipt,
} from "../../scripts/automation/worker-receipt.mjs";

const receipt = {
  task_id: "GOV-PILOT-02",
  worker_id: "claude-code-web",
  dispatch_fingerprint: "a".repeat(64),
  status: "completed",
  base_sha: "b".repeat(40),
  current_sha: "c".repeat(40),
  files_changed: ["scripts/example.mjs"],
  commands_run: ["npm test"],
  tests_passed: ["example"],
  blockers: [],
  remaining_work: [],
  next_action: "Governance verifies GitHub evidence",
};

describe("Governance worker receipt", () => {
  it("round trips a structured receipt", () => {
    const body = serializeWorkerReceipt(receipt);
    expect(body.startsWith(WORKER_RECEIPT_MARKER)).toBe(true);
    expect(parseWorkerReceipt(body)).toEqual(receipt);
  });

  it("ignores unrelated comments", () => {
    expect(parseWorkerReceipt("ordinary issue comment")).toBeNull();
  });

  it("finds the latest matching receipt for task and dispatch", () => {
    const older = {
      ...receipt,
      status: "blocked",
      current_sha: null,
      blockers: ["waiting"],
    };
    const comments = [
      { id: 10, user: { login: "mikevazquez" }, body: serializeWorkerReceipt(older) },
      { id: 11, user: { login: "other" }, body: "not a receipt" },
      { id: 12, user: { login: "mikevazquez" }, body: serializeWorkerReceipt(receipt) },
    ];

    const match = findMatchingWorkerReceipt(comments, {
      task_id: receipt.task_id,
      dispatch_fingerprint: receipt.dispatch_fingerprint,
    });

    expect(match.comment_id).toBe(12);
    expect(match.receipt.status).toBe("completed");
  });

  it("does not accept a receipt from another dispatch fingerprint", () => {
    const comments = [{ id: 1, body: serializeWorkerReceipt(receipt) }];
    const match = findMatchingWorkerReceipt(comments, {
      task_id: receipt.task_id,
      dispatch_fingerprint: "d".repeat(64),
    });
    expect(match).toBeNull();
  });

  it("rejects malformed SHA data", () => {
    expect(() =>
      serializeWorkerReceipt({
        ...receipt,
        current_sha: "not-a-sha",
      }),
    ).toThrow("Invalid current SHA");
  });
});
