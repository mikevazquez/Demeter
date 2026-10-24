import assert from "node:assert/strict";
import test from "node:test";
import {
  applyWorkerStateSignals,
  fetchWorkerStateSignals,
  latestWorkerStateSignals,
  parseWorkerStateComment,
  WORKER_STATE_MARKER,
} from "../../scripts/automation/governance-worker-state.mjs";

const allowedWorkers = ["claude-code-routine-worker", "github-actions-evidence-worker"];

function comment(signal, { id = 100, author = "mikevazquez", marker = WORKER_STATE_MARKER } = {}) {
  return {
    id,
    user: { login: author },
    html_url: `https://github.com/mikevazquez/Demeter/issues/389#issuecomment-${id}`,
    body: `${marker}\n\n\`\`\`json\n${JSON.stringify(signal)}\n\`\`\``,
  };
}

function signal(overrides = {}) {
  return {
    schema: "governance-worker-state-v1",
    worker_id: "claude-code-routine-worker",
    state: "no_capacity",
    observed_at: "2026-10-23T21:00:00.000Z",
    ...overrides,
  };
}

test("trusted owner signal becomes a bounded dispatcher state observation", () => {
  assert.deepEqual(parseWorkerStateComment(comment(signal()), { allowedWorkers }), {
    workerId: "claude-code-routine-worker",
    state: "no_capacity",
    observedAt: "2026-10-23T21:00:00.000Z",
    source: "owner_worker_state_signal",
    commentId: 100,
    sourceUrl: "https://github.com/mikevazquez/Demeter/issues/389#issuecomment-100",
  });
});

test("untrusted marker is ignored instead of changing worker capacity", () => {
  assert.equal(
    parseWorkerStateComment(comment(signal(), { author: "another-user" }), { allowedWorkers }),
    null,
  );
});

test("latest trusted signal wins and available clears an earlier capacity block", () => {
  const result = latestWorkerStateSignals(
    [
      comment(signal(), { id: 100 }),
      comment(
        signal({
          state: "available",
          observed_at: "2026-10-23T22:00:00.000Z",
        }),
        { id: 102 },
      ),
      comment(signal({ worker_id: "github-actions-evidence-worker", state: "available" }), {
        id: 101,
      }),
    ],
    { allowedWorkers },
  );
  assert.deepEqual(
    result.map(({ workerId, state, commentId }) => ({ workerId, state, commentId })),
    [
      { workerId: "claude-code-routine-worker", state: "available", commentId: 102 },
      { workerId: "github-actions-evidence-worker", state: "available", commentId: 101 },
    ],
  );
});

test("trusted malformed signals fail closed", () => {
  assert.throws(
    () => parseWorkerStateComment(comment({ ...signal(), extra: true }), { allowedWorkers }),
    /unexpected fields/,
  );
  assert.throws(
    () => parseWorkerStateComment(comment(signal({ state: "busy" })), { allowedWorkers }),
    /value invalid/,
  );
  assert.throws(
    () =>
      parseWorkerStateComment(comment(signal({ worker_id: "unknown-worker" })), { allowedWorkers }),
    /unregistered worker/,
  );
});

test("ambiguous or non-fenced owner signals are rejected", () => {
  const duplicate = comment(signal());
  duplicate.body = `${duplicate.body}\n${duplicate.body}`;
  assert.throws(() => parseWorkerStateComment(duplicate, { allowedWorkers }), /Ambiguous/);

  const unfenced = comment(signal());
  unfenced.body = `${WORKER_STATE_MARKER}\n${JSON.stringify(signal())}`;
  assert.throws(() => parseWorkerStateComment(unfenced, { allowedWorkers }), /fenced JSON/);
});

test("fetcher paginates the reviewed issue and returns the latest bounded signals", async () => {
  const calls = [];
  const result = await fetchWorkerStateSignals(
    async (method, path) => {
      calls.push({ method, path });
      if (path.endsWith("page=1"))
        return Array.from({ length: 100 }, (_, index) =>
          comment(signal(), { id: index + 1, author: "another-user" }),
        );
      return [comment(signal({ state: "degraded" }), { id: 101 })];
    },
    { allowedWorkers },
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, "GET");
  assert.equal(result.length, 1);
  assert.equal(result[0].workerId, "claude-code-routine-worker");
  assert.equal(result[0].state, "degraded");
});

test("capacity signals cannot fabricate connectivity for a disconnected worker", () => {
  const workers = [
    {
      workerId: "claude-code-routine-worker",
      state: "disconnected",
      stateSource: "missing_credentials",
    },
    {
      workerId: "github-actions-evidence-worker",
      state: "available",
      stateSource: "runtime",
    },
  ];
  const result = applyWorkerStateSignals(workers, [
    {
      workerId: "claude-code-routine-worker",
      state: "available",
      observedAt: "2026-10-23T22:00:00.000Z",
      source: "owner_worker_state_signal",
    },
    {
      workerId: "github-actions-evidence-worker",
      state: "no_capacity",
      observedAt: "2026-10-23T22:00:00.000Z",
      source: "owner_worker_state_signal",
    },
  ]);
  assert.equal(result[0].state, "disconnected");
  assert.equal(result[0].stateSource, "missing_credentials");
  assert.equal(result[1].state, "no_capacity");
  assert.equal(result[1].stateSource, "owner_worker_state_signal");
});

test("documentation that merely mentions the marker is not treated as a state signal", () => {
  const planning = comment(signal());
  planning.body =
    "Diseño: el protocolo GOVERNANCE_WORKER_STATE_V1 se usará después de la promoción.";
  assert.equal(parseWorkerStateComment(planning, { allowedWorkers }), null);
});
