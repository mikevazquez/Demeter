import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  admitSupervisorTask,
  recordSupervisorActivity,
  supervisorContractSha256,
  tickSupervisor,
  validateSupervisorContract,
} from "../../scripts/automation/supervisor.mjs";

const REPOSITORY = "mikevazquez/Demeter";
const START = "2026-10-20T12:00:00.000Z";
const clone = (value) => JSON.parse(JSON.stringify(value));
const hash = (value) => createHash("sha1").update(value).digest("hex");
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const after = (minutes) => new Date(Date.parse(START) + minutes * 60_000).toISOString();
const authorization = {
  actor: "mikevazquez",
  reference: "https://github.com/mikevazquez/Demeter/issues/341",
  authorized_at: START,
};

function freshEnvelope() {
  const legacy = {
    schema: "governance2-registry-authority-v1",
    repository: REPOSITORY,
    active: null,
    history: [{ id: "legacy-imported", closure: { kind: "published" } }],
    entries: [{ task: { id: "legacy-auth-failed" }, closure: { kind: "auth-blocked" } }],
  };
  return {
    schema: "governance2-supervisor-v1",
    repository: REPOSITORY,
    sequence: 0,
    previous: "a".repeat(40),
    legacy: { head_sha: "a".repeat(40), sha256: digest(legacy), state: legacy },
    tasks: [],
    active_task_id: null,
  };
}

// The strict in-memory store checks the persistence contract independently of the core.
// Failure injection represents loss of a coordinator, not successful remote worker evidence.
function strictStore(initial = freshEnvelope()) {
  let state = clone(initial);
  let version = hash(JSON.stringify(state));
  const events = [];
  let failure;
  return {
    async read() {
      return { version, state: clone(state) };
    },
    async compareAndSwap(expected, next, event) {
      if (expected !== version)
        throw Object.assign(new Error("CAS conflict"), { code: "CAS_CONFLICT" });
      assert.equal(next.schema, "governance2-supervisor-v1");
      assert.equal(next.repository, REPOSITORY);
      assert.equal(next.previous, version);
      assert.equal(next.sequence, state.sequence + 1);
      assert.deepEqual(next.legacy, state.legacy, "Legacy snapshot cannot change");
      const selected = failure?.eventType === event.type ? failure : null;
      if (selected) failure = null;
      if (selected?.when === "before")
        throw Object.assign(new Error("Lost coordinator before write"), {
          code: "WRITE_UNCERTAIN",
        });
      state = clone(next);
      version = hash(`${expected}\n${JSON.stringify(state)}\n${JSON.stringify(event)}`);
      events.push({ version, state: clone(state), event: clone(event) });
      if (selected?.when === "after")
        throw Object.assign(new Error("Lost write acknowledgement"), { code: "WRITE_UNCERTAIN" });
      return { version, state: clone(state) };
    },
    failOnce(eventType, when = "before") {
      failure = { eventType, when };
    },
    get events() {
      return clone(events);
    },
  };
}

function contract(overrides = {}) {
  return {
    task_id: "supervisor-test-task",
    objective: "Review the authorized documentation and return one bounded result",
    repo: REPOSITORY,
    branch: "governance2/supervisor-test-task",
    base_sha: "b".repeat(40),
    allowed_paths: ["docs/automation/review.md"],
    read_only: true,
    requires_uat: false,
    required_checks: ["CI"],
    recovery: { mode: "read_only", max_attempts: 3 },
    required_capabilities: ["repository_review"],
    required_permissions: ["repository:read", "receipt:write"],
    acceptance_criteria: ["Return evidence for the exact authorized scope"],
    definition_of_done: ["Independent verification passed"],
    forbidden: ["production", "merge to main", "credential changes"],
    ...clone(overrides),
  };
}

function worker(overrides = {}) {
  return {
    workerId: "claude-code-web",
    state: "available",
    capabilities: ["repository_review"],
    permissions: ["repository:read", "receipt:write"],
    quality: { default: 0.95 },
    relativeCost: 1,
    specialties: ["software"],
    contextScore: 1,
    maxRiskTier: 2,
    ...overrides,
  };
}

const accepted = () => ({
  status: "dispatched",
  session_url: "https://claude.ai/code/session_test_1",
});

async function setup(overrides = {}, suppliedStore = strictStore()) {
  const taskContract = contract(overrides);
  await admitSupervisorTask({
    store: suppliedStore,
    contract: taskContract,
    authorization,
    now: START,
  });
  let count = 0;
  const calls = [];
  const options = {
    store: suppliedStore,
    workers: [worker()],
    now: START,
    observerId: "test-supervisor",
    id: () => `attempt-${++count}`,
    dispatch: async (input) => {
      calls.push(clone(input));
      return accepted();
    },
  };
  return { store: suppliedStore, taskContract, options, calls };
}

async function taskOf(store, taskId = "supervisor-test-task") {
  return (await store.read()).state.tasks.find((task) => task.task_id === taskId);
}

test("two simultaneous ticks activate the external worker exactly once", async () => {
  const { store, options, calls } = await setup();
  const results = await Promise.all([tickSupervisor(options), tickSupervisor(options)]);
  assert.equal(calls.length, 1);
  assert.equal(results.filter((result) => result.action === "claim_lost").length, 1);
  const task = await taskOf(store);
  assert.equal(task.status, "sent");
  assert.equal(task.attempts.length, 1);
  assert.equal((await store.read()).state.active_task_id, task.task_id);
  assert.equal(store.events.filter((entry) => entry.event.type === "dispatch_intent").length, 1);
});

test("a reserved intent survives coordinator loss and prevents activation by a second observer", async () => {
  const { store, options, calls } = await setup();
  store.failOnce("dispatch_intent", "after");
  await assert.rejects(tickSupervisor(options), { code: "WRITE_UNCERTAIN" });
  const reserved = await taskOf(store);
  assert.equal(reserved.status, "dispatching");
  assert.equal(calls.length, 0);
  const result = await tickSupervisor({
    ...options,
    now: after(1),
    observerId: "replacement-observer",
  });
  assert.equal(result.action, "uncertain");
  assert.equal(calls.length, 0);
  const task = await taskOf(store);
  assert.equal(task.attempts.length, 1);
  assert.equal(task.attempts[0].attempt_id, reserved.attempts[0].attempt_id);
  assert.equal(result.state.active_task_id, task.task_id);
});

test("loss after external activation but before outcome persistence never creates a second activation", async () => {
  const { store, options, calls } = await setup();
  store.failOnce("dispatch_outcome", "before");
  await assert.rejects(tickSupervisor(options), { code: "WRITE_UNCERTAIN" });
  assert.equal(calls.length, 1);
  assert.equal((await taskOf(store)).status, "dispatching");
  await tickSupervisor({ ...options, now: after(2) });
  await tickSupervisor({ ...options, now: after(120) });
  assert.equal(calls.length, 1);
  assert.equal((await taskOf(store)).attempts.length, 1);
  assert.equal((await taskOf(store)).status, "uncertain");
});

test("network ambiguity and server errors preserve the active attempt without redispatch", async () => {
  for (const outcome of [
    null,
    { status: "rejected", http_status: 500 },
    { status: "rejected", http_status: 503 },
  ]) {
    const { store, options } = await setup();
    let activations = 0;
    const dispatch = async () => {
      activations++;
      if (outcome === null) throw new Error("Connection lost after sending");
      return outcome;
    };
    const result = await tickSupervisor({ ...options, dispatch });
    assert.equal(result.action, "uncertain");
    assert.equal(result.state.active_task_id, "supervisor-test-task");
    await tickSupervisor({ ...options, dispatch, now: after(120) });
    assert.equal(activations, 1);
    assert.equal((await taskOf(store)).attempts.length, 1);
  }
});

test("acknowledged HTTP 429 permits only a bounded retry after persisted backoff", async () => {
  const { store, options } = await setup();
  const activations = [];
  const dispatch = async (input) => {
    activations.push(clone(input));
    return activations.length === 1 ? { status: "rejected", http_status: 429 } : accepted();
  };
  await tickSupervisor({ ...options, dispatch });
  let task = await taskOf(store);
  assert.equal(task.status, "paused_capacity");
  assert.equal(task.next_attempt_at, after(15));
  assert.equal((await store.read()).state.active_task_id, null);
  const eventCount = store.events.length;
  assert.equal((await tickSupervisor({ ...options, dispatch, now: after(14) })).action, "idle");
  assert.equal(store.events.length, eventCount);
  assert.equal(activations.length, 1);
  await tickSupervisor({ ...options, dispatch, now: after(15) });
  task = await taskOf(store);
  assert.equal(task.status, "sent");
  assert.equal(activations.length, 2);
  assert.equal(task.attempts.length, 2);
  assert.equal(activations[0].task.task_id, activations[1].task.task_id);
  assert.equal(activations[0].task.contract_sha256, activations[1].task.contract_sha256);
  assert.notEqual(task.attempts[0].attempt_id, task.attempts[1].attempt_id);
});

test("worker no_capacity is a selection signal and does not consume an execution attempt", async () => {
  const { store, options, calls } = await setup();
  await tickSupervisor({ ...options, workers: [worker({ state: "no_capacity" })] });
  const task = await taskOf(store);
  assert.equal(task.status, "paused_capacity");
  assert.equal(task.attempts.length, 0);
  assert.equal(calls.length, 0);
  assert.equal((await store.read()).state.active_task_id, null);
  await tickSupervisor({
    ...options,
    now: after(15),
    workers: [worker({ workerId: "codex", state: "no_capacity" }), worker()],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].attempt.worker_id, "claude-code-web");
});

test("confirmed process closure resumes the same task and contract from the saved checkpoint", async () => {
  const { store, options, taskContract } = await setup({
    read_only: false,
    recovery: { mode: "checkpoint", max_attempts: 3 },
  });
  const checkpoint = {
    current_sha: "c".repeat(40),
    branch: taskContract.branch,
    completed_paths: ["docs/automation/review.md"],
  };
  const activations = [];
  const dispatch = async (input) => {
    activations.push(clone(input));
    return activations.length === 1
      ? {
          status: "stopped",
          terminal_observed: true,
          process_exit_observed: true,
          process_group_closed: true,
          failure_class: "capacity_exhausted",
          resume_verified: true,
          no_side_effects_pending: true,
          checkpoint,
        }
      : accepted();
  };
  await tickSupervisor({ ...options, dispatch });
  const paused = await taskOf(store);
  assert.equal(paused.status, "paused_capacity");
  assert.deepEqual(paused.checkpoint, checkpoint);
  assert.equal(paused.next_attempt_at, after(15));
  await tickSupervisor({ ...options, dispatch, now: after(15) });
  assert.equal(activations.length, 2);
  assert.deepEqual(activations[1].checkpoint, checkpoint);
  assert.equal(activations[1].task.task_id, taskContract.task_id);
  assert.equal(activations[1].task.contract_sha256, supervisorContractSha256(taskContract));
  assert.deepEqual(activations[1].task.contract, taskContract);
});

test("a checkpoint without resume verification blocks automatic recovery", async () => {
  const { store, options } = await setup({
    read_only: false,
    recovery: { mode: "checkpoint", max_attempts: 3 },
  });
  let activations = 0;
  const dispatch = async () => {
    activations++;
    return {
      status: "stopped",
      terminal_observed: true,
      process_exit_observed: true,
      process_group_closed: true,
      checkpoint: { current_sha: "c".repeat(40) },
      resume_verified: false,
      no_side_effects_pending: true,
    };
  };
  await tickSupervisor({ ...options, dispatch });
  assert.equal((await taskOf(store)).status, "blocked");
  assert.equal((await taskOf(store)).requires_user_action, true);
  await tickSupervisor({ ...options, dispatch, now: after(120) });
  assert.equal(activations, 1);
});

test("terminal event without process-group closure is insufficient to release the task", async () => {
  const { store, options } = await setup();
  const result = await tickSupervisor({
    ...options,
    dispatch: async () => ({
      status: "stopped",
      terminal_observed: true,
      process_exit_observed: true,
      process_group_closed: false,
    }),
  });
  assert.equal(result.action, "uncertain");
  assert.equal(result.state.active_task_id, "supervisor-test-task");
  assert.equal((await taskOf(store)).attempts.length, 1);
});

test("confirmed process cancellation can recover without fabricating a Codex terminal event", async () => {
  const { store, options } = await setup();
  await tickSupervisor({
    ...options,
    dispatch: async () => ({
      status: "stopped",
      terminal_observed: false,
      process_exit_observed: true,
      process_group_closed: true,
      failure_class: "execution_timeout",
    }),
  });
  const task = await taskOf(store);
  assert.equal(task.status, "paused_capacity");
  assert.equal(task.attempts[0].stop_proof.terminal_observed, false);
  assert.equal(task.attempts[0].stop_proof.process_exit_observed, true);
  assert.equal(task.next_attempt_at, after(15));
  assert.equal((await store.read()).state.active_task_id, null);
});

test("a terminal event with no observed process exit cannot release the execution slot", async () => {
  const { options } = await setup();
  const result = await tickSupervisor({
    ...options,
    dispatch: async () => ({
      status: "stopped",
      terminal_observed: true,
      process_exit_observed: false,
      process_group_closed: true,
    }),
  });
  assert.equal(result.action, "uncertain");
  assert.equal(result.state.active_task_id, "supervisor-test-task");
});

test("authentication failures stop automatic retries even with remaining attempt budget", async () => {
  for (const outcome of [
    { status: "rejected", http_status: 401 },
    { status: "rejected", http_status: 403 },
    {
      status: "stopped",
      terminal_observed: true,
      process_exit_observed: true,
      process_group_closed: true,
      failure_class: "auth_required",
    },
  ]) {
    const { store, options } = await setup();
    let activations = 0;
    const dispatch = async () => {
      activations++;
      return outcome;
    };
    await tickSupervisor({ ...options, dispatch });
    const task = await taskOf(store);
    assert.equal(task.status, "blocked");
    assert.equal(task.requires_user_action, true);
    assert.equal(task.attempts.length, 1);
    assert.equal((await store.read()).state.active_task_id, null);
    await tickSupervisor({ ...options, dispatch, now: after(120) });
    assert.equal(activations, 1);
  }
});

test("capacity retries stop at the contract budget with no new task identity", async () => {
  const { store, options } = await setup({ recovery: { mode: "read_only", max_attempts: 2 } });
  let activations = 0;
  const dispatch = async () => {
    activations++;
    return { status: "rejected", http_status: 429 };
  };
  await tickSupervisor({ ...options, dispatch });
  await tickSupervisor({ ...options, dispatch, now: after(15) });
  await tickSupervisor({ ...options, dispatch, now: after(120) });
  const task = await taskOf(store);
  assert.equal(activations, 2);
  assert.equal(task.status, "blocked");
  assert.equal(task.attempts.length, 2);
  assert.equal((await store.read()).state.tasks.length, 1);
});

test("a spoofed or blocked receipt cannot release a possibly-running writer", async () => {
  const { store, options, calls } = await setup();
  await admitSupervisorTask({
    store,
    contract: contract({ task_id: "another-task", branch: "governance2/another-task" }),
    authorization,
    now: START,
  });
  await tickSupervisor(options);
  const result = await tickSupervisor({
    ...options,
    now: after(1),
    observe: async () => ({
      receipt: { status: "completed", task_id: "spoofed" },
      source: { author: "untrusted" },
    }),
    verify: async () => ({
      status: "blocked",
      reason: "Receipt identity or author does not match",
    }),
  });
  assert.equal(result.action, "uncertain");
  assert.equal(result.state.active_task_id, "supervisor-test-task");
  assert.equal((await taskOf(store)).verification_status, "blocked");
  await tickSupervisor({ ...options, now: after(120) });
  assert.equal(calls.length, 1);
  assert.equal((await taskOf(store, "another-task")).attempts.length, 0);
});

test("a receipt awaiting CI stays verifying and retains the execution slot", async () => {
  const { store, options } = await setup();
  await tickSupervisor(options);
  const result = await tickSupervisor({
    ...options,
    now: after(1),
    observe: async () => ({ receipt: { status: "completed" } }),
    verify: async () => ({ status: "pending", reason: "CI has not completed for the receipt SHA" }),
  });
  assert.equal(result.action, "verifying");
  assert.equal((await taskOf(store)).verification_status, "pending");
  assert.equal(result.state.active_task_id, "supervisor-test-task");
});

test("a delivered process result is not technically verified or UAT approved", async () => {
  const { store, options } = await setup({ requires_uat: true });
  await tickSupervisor({
    ...options,
    dispatch: async () => ({
      status: "delivered",
      terminal_observed: true,
      process_group_closed: true,
    }),
  });
  const task = await taskOf(store);
  assert.equal(task.status, "delivered");
  assert.equal(task.verification_status, "pending");
  assert.equal(task.uat_status, "pending");
  assert.equal((await store.read()).state.active_task_id, task.task_id);
});

test("independent verification closes a technical task and allows the next queued task", async () => {
  const { store, options, calls } = await setup();
  await admitSupervisorTask({
    store,
    contract: contract({ task_id: "next-task", branch: "governance2/next-task" }),
    authorization,
    now: START,
  });
  await tickSupervisor(options);
  const evidence = {
    sha: "c".repeat(40),
    run_url: "https://github.com/mikevazquez/Demeter/actions/runs/1",
  };
  const result = await tickSupervisor({
    ...options,
    now: after(1),
    observe: async () => ({ receipt: { status: "completed" } }),
    verify: async () => ({ status: "verified", reason: "Exact SHA and checks agree", evidence }),
  });
  assert.equal(result.action, "verified");
  const task = await taskOf(store);
  assert.deepEqual(task.evidence, evidence);
  assert.equal(task.attempts[0].status, "receipt_verified");
  assert.equal(task.uat_status, "not_required");
  assert.equal(result.state.active_task_id, null);
  await tickSupervisor({ ...options, now: after(2) });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].task.task_id, "next-task");
});

test("verified work that requires UAT remains waiting for functional approval", async () => {
  const { store, options } = await setup({ requires_uat: true });
  await tickSupervisor(options);
  const result = await tickSupervisor({
    ...options,
    now: after(1),
    observe: async () => ({ receipt: { status: "completed" } }),
    verify: async () => ({ status: "verified", reason: "Technical evidence verified" }),
  });
  const task = await taskOf(store);
  assert.equal(result.action, "waiting_uat");
  assert.equal(task.verification_status, "verified");
  assert.equal(task.uat_status, "pending");
  assert.equal(task.requires_user_action, true);
  assert.equal(result.state.active_task_id, null);
});

test("observer heartbeats do not create worker activity or alter authority", async () => {
  const { store, options } = await setup();
  await tickSupervisor(options);
  const before = await store.read();
  const attempt = before.state.tasks[0].attempts[0];
  const result = await recordSupervisorActivity({
    store,
    taskId: "supervisor-test-task",
    attemptId: attempt.attempt_id,
    activity: { type: "observer.heartbeat" },
    now: after(20),
  });
  assert.equal(result.action, "ignored_observer_heartbeat");
  assert.deepEqual(await store.read(), before);
});

test("a turn-completed event is activity, not receipt verification or permission to retry", async () => {
  const { store, options, calls } = await setup();
  await tickSupervisor(options);
  const attempt = (await taskOf(store)).attempts[0];
  await recordSupervisorActivity({
    store,
    taskId: "supervisor-test-task",
    attemptId: attempt.attempt_id,
    activity: { type: "turn.completed", session_id: "session-1" },
    now: after(1),
  });
  const task = await taskOf(store);
  assert.equal(task.verification_status, "pending");
  assert.equal(task.attempts.length, 1);
  assert.equal(task.last_worker_activity_at, after(1));
  assert.equal((await store.read()).state.active_task_id, task.task_id);
  await tickSupervisor({ ...options, now: after(2) });
  assert.equal(calls.length, 1);
});

test(
  "read-only silence releases the slot as stale capacity without inventing completion",
  async () => {
    const { store, options, calls } = await setup();
    await tickSupervisor(options);
    await tickSupervisor({
      ...options,
      now: after(31),
      workerSignals: [
        { workerId: "claude-code-web", state: "no_capacity", observedAt: after(30) },
      ],
    });
    const silent = await taskOf(store);
    assert.equal(silent.status, "paused_capacity");
    assert.equal(silent.requires_user_action, false);
    assert.equal(silent.last_worker_activity_at, undefined);
    assert.equal(silent.attempts[0].last_activity_at, undefined);
    assert.equal(silent.attempts[0].intent_at, START);
    assert.equal(silent.attempts[0].status, "rejected_capacity");
    assert.equal(silent.attempts[0].finished_at, after(31));
    assert.equal(silent.next_attempt_at, after(46));
    assert.equal((await store.read()).state.active_task_id, null);
    assert.equal(calls.length, 1);
  },
);

test(
  "read-only stale capacity preserves task identity and prefers another eligible worker",
  async () => {
    const { store, options, calls, taskContract } = await setup();
    await tickSupervisor(options);
    await tickSupervisor({
      ...options,
      now: after(31),
      workerSignals: [
        { workerId: "claude-code-web", state: "no_capacity", observedAt: after(30) },
      ],
    });
    await tickSupervisor({
      ...options,
      now: after(46),
      workers: [
        worker(),
        worker({
          workerId: "gpt-routine-worker",
          relativeCost: 2,
          contextScore: 0,
        }),
      ],
    });
    const task = await taskOf(store);
    assert.equal(calls.length, 2);
    assert.equal(task.status, "sent");
    assert.equal(task.attempts.length, 2);
    assert.equal(task.attempts[0].worker_id, "claude-code-web");
    assert.equal(task.attempts[0].status, "rejected_capacity");
    assert.equal(task.attempts[1].worker_id, "gpt-routine-worker");
    assert.equal(calls[1].task.task_id, taskContract.task_id);
    assert.equal(calls[1].task.contract_sha256, supervisorContractSha256(taskContract));
    assert.equal((await store.read()).state.active_task_id, taskContract.task_id);
  },
);

test(
  "writable silence remains fail-closed until process closure or checkpoint is proven",
  async () => {
    const { store, options, calls } = await setup({
      read_only: false,
      recovery: { mode: "checkpoint", max_attempts: 3 },
    });
    await tickSupervisor(options);
    await tickSupervisor({ ...options, now: after(31) });
    const silent = await taskOf(store);
    assert.equal(silent.status, "no_signal");
    assert.equal(silent.requires_user_action, true);
    assert.equal(silent.attempts[0].status, "sent");
    assert.equal((await store.read()).state.active_task_id, silent.task_id);
    await tickSupervisor({ ...options, now: after(120) });
    assert.equal(calls.length, 1);
    assert.equal((await taskOf(store)).attempts.length, 1);
  },
);

test("staleness uses actual worker activity rather than the observer's latest tick", async () => {
  const { store, options } = await setup();
  await tickSupervisor(options);
  const attempt = (await taskOf(store)).attempts[0];
  await recordSupervisorActivity({
    store,
    taskId: "supervisor-test-task",
    attemptId: attempt.attempt_id,
    activity: { type: "item.updated" },
    now: after(29),
  });
  await tickSupervisor({ ...options, now: after(55) });
  assert.equal((await taskOf(store)).status, "running");
  await tickSupervisor({ ...options, now: after(60) });
  assert.equal((await taskOf(store)).status, "no_signal");
  assert.equal((await taskOf(store)).last_worker_activity_at, after(29));
});

test("a real-time dispatch outcome cannot move timestamps behind worker activity recorded during execution", async () => {
  const { store, options } = await setup();
  let activitySnapshot;
  const result = await tickSupervisor({
    ...options,
    now: undefined,
    dispatch: async ({ task, attempt }) => {
      // Make this worker event strictly later than the launch timestamp without
      // injecting a future clock into either authority transition.
      await new Promise((resolve) => setTimeout(resolve, 10));
      await recordSupervisorActivity({
        store,
        taskId: task.task_id,
        attemptId: attempt.attempt_id,
        activity: { type: "turn.completed" },
      });
      activitySnapshot = await store.read();
      return {
        status: "delivered",
        terminal_observed: true,
        process_exit_observed: true,
        process_group_closed: true,
      };
    },
  });
  const task = await taskOf(store);
  const activityAt = Date.parse(task.last_worker_activity_at);
  assert.ok(activityAt > Date.parse(task.attempts[0].intent_at));
  assert.ok(Date.parse(task.updated_at) >= activityAt);
  assert.ok(Date.parse(task.attempts[0].finished_at) >= activityAt);
  assert.ok(Date.parse(result.state.updated_at) >= Date.parse(activitySnapshot.state.updated_at));
  assert.ok(
    Date.parse(result.state.last_tick_at) >= Date.parse(activitySnapshot.state.last_tick_at),
  );
  assert.ok(Date.parse(result.state.updated_at) <= Date.now());
  assert.equal(task.status, "delivered");
  assert.equal(task.verification_status, "pending");
});

test("legacy imported and auth-blocked task IDs remain consumed", async () => {
  const store = strictStore();
  for (const task_id of ["legacy-imported", "legacy-auth-failed"]) {
    await assert.rejects(
      admitSupervisorTask({ store, contract: contract({ task_id }), authorization, now: START }),
      /consumed legacy/,
    );
  }
  assert.equal(store.events.length, 0);
  assert.equal((await store.read()).state.tasks.length, 0);
});

test("legacy status text does not consume an unrelated new task ID", async () => {
  const store = strictStore();
  await admitSupervisorTask({
    store,
    contract: contract({ task_id: "published" }),
    authorization,
    now: START,
  });
  assert.equal((await taskOf(store, "published")).status, "queued");
  assert.equal((await store.read()).state.tasks.length, 1);
});

test("the same admitted contract is idempotent; changing its content cannot recycle the ID", async () => {
  const { store, taskContract } = await setup();
  const count = store.events.length;
  const reordered = Object.fromEntries(Object.entries(taskContract).reverse());
  const result = await admitSupervisorTask({
    store,
    contract: reordered,
    authorization,
    now: after(1),
  });
  assert.equal(result.action, "already_admitted");
  assert.equal(store.events.length, count);
  await assert.rejects(
    admitSupervisorTask({
      store,
      contract: { ...taskContract, objective: "A different task under an old ID" },
      authorization,
      now: after(1),
    }),
    /cannot be reused/,
  );
  assert.equal(store.events.length, count);
  assert.equal((await store.read()).state.tasks.length, 1);
});

test("idle and unchanged observations are no-write outcomes, not synthetic worker heartbeats", async () => {
  const empty = strictStore();
  const original = await empty.read();
  const result = await tickSupervisor({
    store: empty,
    workers: [],
    now: START,
    dispatch: async () => {
      throw new Error("Must not dispatch");
    },
  });
  assert.equal(result.action, "idle");
  assert.deepEqual(await empty.read(), original);
  assert.equal(empty.events.length, 0);
  const { store, options } = await setup();
  await tickSupervisor(options);
  const before = await store.read();
  assert.equal((await tickSupervisor({ ...options, now: after(5) })).action, "observed_no_change");
  assert.deepEqual(await store.read(), before);
});

test("product default-branch aliases and sensitive control files are rejected at admission", () => {
  for (const branch of ["main", "refs/heads/main"]) {
    assert.throws(() => validateSupervisorContract(contract({ branch })));
  }
  for (const path of [".git/config", ".env", ".env.local"]) {
    assert.throws(() => validateSupervisorContract(contract({ allowed_paths: [path] })));
  }
});

test("a terminally blocked task does not prevent a separate eligible task from continuing", async () => {
  const { store, options } = await setup();
  await admitSupervisorTask({
    store,
    contract: contract({ task_id: "independent-task", branch: "governance2/independent-task" }),
    authorization,
    now: START,
  });
  await tickSupervisor({
    ...options,
    dispatch: async () => ({ status: "rejected", http_status: 401 }),
  });
  const activated = [];
  await tickSupervisor({
    ...options,
    now: after(1),
    dispatch: async (input) => {
      activated.push(input.task.task_id);
      return accepted();
    },
  });
  assert.deepEqual(activated, ["independent-task"]);
  assert.equal((await taskOf(store)).status, "blocked");
});
