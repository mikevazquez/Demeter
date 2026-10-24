import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSupervisorDelivery,
  createReceiptObserver,
  githubSupervisorRequest,
  runSupervisorCommand,
  SUPERVISOR_CONFIG,
} from "../../scripts/automation/supervisor-runner.mjs";

const ref = SUPERVISOR_CONFIG.proofRef;
const api = "repos/mikevazquez/Demeter";

test("GitHub adapter permits comparison and refuses cross-repository or force writes", async () => {
  const calls = [];
  const request = githubSupervisorRequest({
    token: "private-fixture",
    allowedRef: ref,
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ ok: true }));
    },
  });
  assert.deepEqual(
    await request("GET", `${api}/compare/${"a".repeat(40)}...${"b".repeat(40)}?per_page=1`),
    { ok: true },
  );
  await assert.rejects(
    request("PATCH", `${api}/git/refs/heads/main`, { sha: "a".repeat(40), force: false }),
  );
  await assert.rejects(
    request("PATCH", `${api}/git/refs/${ref.slice(5)}`, { sha: "a".repeat(40), force: true }),
  );
  await assert.rejects(
    request("POST", `${api}/issues/353/comments`, { body: "Not a registry mutation" }),
  );
  await assert.rejects(request("GET", "repos/other/repo/issues"));
  await assert.rejects(
    request("POST", `${api}/git/refs`, { ref: "refs/heads/main", sha: "a".repeat(40) }),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.redirect, "error");
});

test("An ambiguous mutation is sent once and its error contains no token or raw body", async () => {
  let requests = 0;
  const request = githubSupervisorRequest({
    token: "private-fixture",
    allowedRef: ref,
    fetchImpl: async () => {
      requests++;
      return new Response("private-provider-body", { status: 503 });
    },
  });
  await assert.rejects(
    request("POST", `${api}/git/commits`, { tree: "a".repeat(40), parents: ["b".repeat(40)] }),
    (error) => error.httpStatus === 503 && !/private/.test(error.message),
  );
  assert.equal(requests, 1);
});

test("Operating commands require activated main; proof cannot migrate the operating authority", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    throw new Error("unexpected network");
  };
  await assert.rejects(
    runSupervisorCommand({
      mode: "tick",
      environment: { GITHUB_REF: "refs/heads/main" },
      fetchImpl,
    }),
    /not activated/,
  );
  await assert.rejects(
    runSupervisorCommand({
      mode: "migrate",
      environment: { GITHUB_REF: "refs/heads/feature", GOVERNANCE_SUPERVISOR_ENABLED: "true" },
      fetchImpl,
    }),
    /reviewed main/,
  );
  await assert.rejects(
    runSupervisorCommand({
      mode: "proof-init",
      environment: {
        GITHUB_REPOSITORY: SUPERVISOR_CONFIG.repository,
        GITHUB_REF: "refs/heads/main",
      },
      fetchImpl,
    }),
    /authorized candidate/,
  );
  assert.equal(calls, 0);
});

test("A different push actor cannot activate the pilot using the owner's recorded authorization", async () => {
  let calls = 0;
  await assert.rejects(
    runSupervisorCommand({
      mode: "proof-init",
      environment: {
        GITHUB_REPOSITORY: SUPERVISOR_CONFIG.repository,
        GITHUB_REF: "refs/heads/feat/governance-supervisor-20261020",
        GITHUB_SHA: "a".repeat(40),
        GITHUB_ACTOR: "another-collaborator",
        GH_TOKEN: "private-fixture",
      },
      fetchImpl: async () => {
        calls++;
        throw new Error("No network or external activation is authorized for this actor");
      },
    }),
    /owner actor/,
  );
  assert.equal(calls, 0);
});

test("Delivery preserves immutable contract identity, attempt and checkpoint", () => {
  const task = {
    contract: { task_id: "TASK-1", objective: "review", base_sha: "a".repeat(40) },
    contract_sha256: "c".repeat(64),
    checkpoint: { current_sha: "a".repeat(40) },
  };
  const attempt = {
    attempt_id: "attempt-1",
    worker_id: "claude-code-routine-worker",
    dispatch_fingerprint: "d".repeat(64),
  };
  const before = JSON.stringify(task);
  const delivery = buildSupervisorDelivery(task, attempt);
  assert.equal(delivery.contract_sha256, task.contract_sha256);
  assert.equal(delivery.attempt_id, attempt.attempt_id);
  assert.equal(delivery.receipt_protocol, "GOVERNANCE_WORKER_RECEIPT_V2");
  assert.deepEqual(delivery.resume_checkpoint, task.checkpoint);
  assert.equal(JSON.stringify(task), before);
});

function comment(receipt, author = "mikevazquez", id = 101) {
  return {
    user: { login: author },
    html_url: `https://github.com/mikevazquez/Demeter/issues/341#issuecomment-${id}`,
    body: `GOVERNANCE_WORKER_RECEIPT_V2\n\`\`\`json\n${JSON.stringify(receipt)}\n\`\`\``,
  };
}

test("Observer paginates and only selects the authorized account and exact attempt", async () => {
  const matching = { task_id: "TASK-1", attempt_id: "attempt-1" };
  let pages = 0;
  const observer = createReceiptObserver(async (method, path) => {
    assert.equal(method, "GET");
    pages++;
    if (path.endsWith("page=1"))
      return Array.from({ length: 100 }, (_, i) =>
        comment({ ...matching, attempt_id: "old" }, "mikevazquez", i),
      );
    return [comment(matching, "untrusted-user"), comment(matching)];
  });
  const result = await observer({
    task: { task_id: "TASK-1" },
    attempt: { attempt_id: "attempt-1" },
  });
  assert.equal(pages, 2);
  assert.deepEqual(result.receipt, matching);
  assert.equal(result.source.author, "mikevazquez");
});

test("Conflicting authoritative receipts fail closed instead of selecting the latest", async () => {
  const matching = { task_id: "TASK-1", attempt_id: "attempt-1" };
  const observer = createReceiptObserver(async () => [
    comment({ ...matching, status: "completed" }),
    comment({ ...matching, status: "failed" }, "mikevazquez", 102),
  ]);
  assert.deepEqual(
    await observer({ task: { task_id: "TASK-1" }, attempt: { attempt_id: "attempt-1" } }),
    { receipt: {}, source: {} },
  );
});

test("Identical receipt retransmissions keep one result despite object key order", async () => {
  const receipt = { task_id: "TASK-1", attempt_id: "attempt-1", status: "completed" };
  const repeated = { status: "completed", attempt_id: "attempt-1", task_id: "TASK-1" };
  const observer = createReceiptObserver(async () => [
    comment(receipt),
    comment(repeated, "mikevazquez", 102),
  ]);
  const result = await observer({
    task: { task_id: "TASK-1" },
    attempt: { attempt_id: "attempt-1" },
  });
  assert.deepEqual(result.receipt, receipt);
  assert.match(result.source.receipt_url, /101$/);
});

test("observer prefers a persisted managed receipt without reading the comment channel", async () => {
  let calls = 0;
  const receipt = {
    task_id: "TASK-2",
    attempt_id: "attempt-2",
    worker_id: "github-actions-evidence-worker",
  };
  const source = {
    author: "github-actions[bot]",
    channel: "github_actions_run",
    receipt_url: "https://github.com/mikevazquez/Demeter/actions/runs/123",
  };
  const observer = createReceiptObserver(async () => {
    calls++;
    throw new Error("comment channel must not be read for a persisted managed receipt");
  });
  const result = await observer({
    task: { task_id: "TASK-2" },
    attempt: {
      attempt_id: "attempt-2",
      managed_receipt: receipt,
      managed_receipt_source: source,
    },
  });
  assert.deepEqual(result, { receipt, source });
  assert.equal(calls, 0);
});
