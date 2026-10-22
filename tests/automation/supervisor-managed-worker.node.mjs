// Real local worker processes and a disk CAS fixture. Reconciliation checks this
// synthetic filesystem exercise; it does not authenticate Codex or certify C5/CI/UAT.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createManagedWorkerDispatch } from "../../scripts/automation/supervisor-managed-worker.mjs";
import {
  admitSupervisorTask,
  tickSupervisor,
  supervisorContractSha256,
} from "../../scripts/automation/supervisor.mjs";

const REPO = "mikevazquez/Demeter";
const START = "2026-10-20T12:00:00.000Z";
const SESSION = "00000000-0000-4000-8000-000000000002";
const posix = { skip: process.platform === "win32" };
const clone = (value) => JSON.parse(JSON.stringify(value));
const digest = (value, algorithm = "sha256") => createHash(algorithm).update(value).digest("hex");
const later = (minutes) => new Date(Date.parse(START) + minutes * 60_000).toISOString();

async function directoryFixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "supervisor-managed-integration-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const workspace = path.join(directory, "workspace");
  const ledger = path.join(directory, "ledger");
  await fs.mkdir(workspace);
  await fs.mkdir(ledger);
  return { directory, workspace, ledger };
}

function initialState() {
  const legacy = {
    schema: "governance2-registry-authority-v1",
    repository: REPO,
    active: null,
    history: [],
    entries: [],
  };
  return {
    schema: "governance2-supervisor-v1",
    repository: REPO,
    sequence: 0,
    previous: "a".repeat(40),
    legacy: { head_sha: "a".repeat(40), sha256: digest(JSON.stringify(legacy)), state: legacy },
    tasks: [],
    active_task_id: null,
  };
}

// Separate instances read the same on-disk CAS state. Exclusive lock acquisition
// and atomic replacement prevent two observers from claiming the same old version.
async function diskStore(directory) {
  const filename = path.join(directory, "state.json");
  try {
    const state = initialState();
    await fs.writeFile(
      filename,
      JSON.stringify({ version: digest(JSON.stringify(state), "sha1"), state, events: [] }),
      { flag: "wx", mode: 0o600 },
    );
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  let failure;
  const readAll = async () => JSON.parse(await fs.readFile(filename, "utf8"));
  return {
    async read() {
      const { version, state } = await readAll();
      return { version, state };
    },
    async compareAndSwap(expected, next, event) {
      const lock = path.join(directory, "cas-lock");
      try {
        await fs.mkdir(lock);
      } catch (error) {
        if (error.code === "EEXIST")
          throw Object.assign(new Error("CAS conflict"), { code: "CAS_CONFLICT" });
        throw error;
      }
      try {
        const previous = await readAll();
        if (previous.version !== expected)
          throw Object.assign(new Error("CAS conflict"), { code: "CAS_CONFLICT" });
        assert.equal(next.previous, expected);
        assert.equal(next.sequence, previous.state.sequence + 1);
        assert.deepEqual(next.legacy, previous.state.legacy);
        if (failure === event.type) {
          failure = null;
          throw Object.assign(new Error("fixture-storage-secret-must-not-leak"), {
            code: "WRITE_UNCERTAIN",
          });
        }
        const version = digest(JSON.stringify([expected, next, event]), "sha1");
        const record = { version, state: clone(next), events: [...previous.events, clone(event)] };
        const temporary = path.join(directory, `next-${randomUUID()}.json`);
        const handle = await fs.open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(JSON.stringify(record));
          await handle.sync();
        } finally {
          await handle.close();
        }
        await fs.rename(temporary, filename);
        const directoryHandle = await fs.open(directory, "r");
        try {
          await directoryHandle.sync();
        } finally {
          await directoryHandle.close();
        }
        return { version, state: clone(next) };
      } finally {
        await fs.rmdir(lock);
      }
    },
    failOnce(eventType) {
      failure = eventType;
    },
    async events() {
      return (await readAll()).events;
    },
  };
}

function contract(overrides = {}) {
  return {
    task_id: "synthetic-managed-worker-task",
    objective: "Complete one synthetic local checkpoint without repeating its side effect",
    repo: REPO,
    branch: "governance2/synthetic-managed-worker-task",
    base_sha: "b".repeat(40),
    allowed_paths: ["checkpoint.json", "completion.json", "starts.jsonl", "effects.jsonl"],
    read_only: false,
    requires_uat: false,
    required_checks: ["independent-check-still-required"],
    recovery: { mode: "checkpoint", max_attempts: 3 },
    required_capabilities: ["repository_review"],
    required_permissions: ["repository:read", "receipt:write"],
    acceptance_criteria: ["Exactly one checkpoint and one completion"],
    definition_of_done: ["Independent result verification remains a separate gate"],
    forbidden: ["production", "merge to main", "credentials"],
    ...overrides,
  };
}

const worker = (workerId = "registered-local-fixture") => ({
  workerId,
  state: "available",
  capabilities: ["repository_review"],
  permissions: ["repository:read", "receipt:write"],
  quality: { default: 0.95 },
  relativeCost: 1,
  specialties: ["software"],
  contextScore: 1,
  maxRiskTier: 2,
});

const PRELUDE = `
  const fs = require("node:fs");
  const {createHash} = require("node:crypto");
  const data = JSON.parse(fs.readFileSync(0, "utf8"));
  const emit = event => fs.writeSync(1, JSON.stringify(event) + "\\n");
  const hash = bytes => createHash("sha256").update(bytes).digest("hex");
  const check = value => { if (!value) throw new Error("Synthetic checkpoint mismatch"); };
  const write = (name, value) => {
    const fd = fs.openSync(name, "wx", 0o600);
    try { fs.writeSync(fd, JSON.stringify(value) + "\\n"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  };
  const effect = step => fs.appendFileSync("effects.jsonl", JSON.stringify({step, task_id:data.task_id}) + "\\n");
  fs.appendFileSync("starts.jsonl", JSON.stringify({task_id:data.task_id, attempt_id:data.attempt_id, contract_sha256:data.contract_sha256, pid:process.pid}) + "\\n");
  emit({type:"thread.started", thread_id:${JSON.stringify(SESSION)}});
  emit({type:"turn.started"});
`;

const CONTINUITY_WORKER = `${PRELUDE}
  if (!data.checkpoint) {
    write("checkpoint.json", {task_id:data.task_id, contract_sha256:data.contract_sha256, current_sha:data.base_sha, branch:data.branch, value:41});
    effect("checkpoint_saved");
    emit({type:"item.completed", item:{type:"agent_message", text:"resume_verified=true; no_side_effects_pending=true"}});
    setInterval(() => {}, 1000);
  } else {
    check(data.prior_stop_proof.process_exit_observed === true && data.prior_stop_proof.process_group_closed === true);
    const bytes = fs.readFileSync(data.checkpoint.artifact);
    check(hash(bytes) === data.checkpoint.artifact_sha256);
    const checkpoint = JSON.parse(bytes);
    check(checkpoint.task_id === data.task_id && checkpoint.contract_sha256 === data.contract_sha256 && checkpoint.value === 41);
    write("completion.json", {task_id:data.task_id, value:checkpoint.value + 1, checkpoint_sha256:hash(bytes)});
    effect("completion_saved");
    emit({type:"turn.completed"});
  }
`;

function inputForTask({ task, attempt, checkpoint }) {
  return JSON.stringify({
    task_id: task.task_id,
    attempt_id: attempt.attempt_id,
    contract_sha256: task.contract_sha256,
    branch: task.contract.branch,
    base_sha: task.contract.base_sha,
    checkpoint,
    prior_stop_proof: task.attempts.at(-2)?.stop_proof ?? null,
  });
}

async function jsonLines(workspace, name) {
  try {
    const bytes = await fs.readFile(path.join(workspace, name), "utf8");
    return bytes
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function independentReconciler(workspace, phases) {
  return async ({ phase, task, checkpoint, process_result }) => {
    phases.push(phase);
    if (phase === "after_stop") {
      assert.equal(process_result.process_group_closed, true);
      assert.equal(process_result.status, "interrupted");
    } else {
      assert.equal(task.attempts.at(-2).stop_proof.process_group_closed, true);
      assert.equal(task.attempts.at(-2).stop_proof.process_exit_observed, true);
    }
    const bytes = await fs.readFile(path.join(workspace, "checkpoint.json"));
    const value = JSON.parse(bytes);
    assert.equal(value.task_id, task.task_id);
    assert.equal(value.contract_sha256, task.contract_sha256);
    assert.equal(value.current_sha, task.contract.base_sha);
    assert.equal(value.value, 41);
    assert.deepEqual(await jsonLines(workspace, "effects.jsonl"), [
      { step: "checkpoint_saved", task_id: task.task_id },
    ]);
    await assert.rejects(fs.access(path.join(workspace, "completion.json")), { code: "ENOENT" });
    if (checkpoint) assert.equal(checkpoint.artifact_sha256, digest(bytes));
    return {
      status: "passed",
      no_side_effects_pending: true,
      checkpoint: {
        branch: task.contract.branch,
        current_sha: value.current_sha,
        completed_paths: ["checkpoint.json"],
        artifact: "checkpoint.json",
        artifact_sha256: digest(bytes),
        session_id: SESSION,
        model_prose: "fixture-private-checkpoint-text-must-not-enter-ledger",
      },
    };
  };
}

async function setup(
  t,
  {
    overrides = {},
    code = CONTINUITY_WORKER,
    reconcile = true,
    clock = () => START,
    workerId,
  } = {},
) {
  const paths = await directoryFixture(t);
  const store = await diskStore(paths.ledger);
  const taskContract = contract(overrides);
  await admitSupervisorTask({
    store,
    contract: taskContract,
    authorization: {
      actor: "mikevazquez",
      reference: "https://github.com/mikevazquez/Demeter/issues/341",
      authorized_at: START,
    },
    now: START,
  });
  const phases = [];
  const registration = {
    worker_id: "registered-local-fixture",
    command: process.execPath,
    args: ["-e", code],
    cwd: paths.workspace,
    inputForTask,
    timeoutMs: 220,
  };
  const onCheckpoint = reconcile ? independentReconciler(paths.workspace, phases) : undefined;
  const dispatch = createManagedWorkerDispatch({ store, registration, onCheckpoint, now: clock });
  let attempt = 0;
  const options = {
    store,
    workers: [worker(workerId)],
    dispatch,
    now: START,
    observerId: "local-fixture-observer",
    id: () => `fixture-attempt-${++attempt}`,
  };
  return { ...paths, store, taskContract, registration, onCheckpoint, phases, options };
}

test(
  "tick, durable CAS and actual processes stop then resume the same task without duplicates",
  posix,
  async (t) => {
    const fixture = await setup(t);
    const outcomes = [];
    const dispatch = async (input) => {
      const result = await fixture.options.dispatch(input);
      outcomes.push(result);
      return result;
    };
    const initial = await Promise.all([
      tickSupervisor({ ...fixture.options, dispatch }),
      tickSupervisor({ ...fixture.options, dispatch }),
    ]);
    assert.equal(initial.filter((result) => result.action === "claim_lost").length, 1);
    let state = (await fixture.store.read()).state;
    let task = state.tasks[0];
    assert.equal(task.status, "paused_capacity");
    assert.equal(task.next_attempt_at, later(15));
    assert.equal(state.active_task_id, null);
    assert.equal(outcomes[0].status, "stopped");
    assert.equal(outcomes[0].process_exit_observed, true);
    assert.equal(outcomes[0].terminal_observed, false);
    assert.equal(outcomes[0].process_status, "interrupted");
    assert.equal(task.attempts[0].stop_proof.process_group_closed, true);
    assert.equal(task.attempts[0].stop_proof.terminal_observed, false);
    assert.equal(task.checkpoint.artifact, "checkpoint.json");
    assert.equal(task.checkpoint.current_sha, fixture.taskContract.base_sha);
    assert.equal(task.checkpoint.model_prose, undefined);
    assert.equal((await jsonLines(fixture.workspace, "starts.jsonl")).length, 1);

    assert.equal((await tickSupervisor({ ...fixture.options, now: later(14) })).action, "idle");
    // Reconstruct the store and dispatch in a new observer; no prior JS state is used.
    const replacementStore = await diskStore(fixture.ledger);
    const replacementDispatch = createManagedWorkerDispatch({
      store: replacementStore,
      registration: fixture.registration,
      onCheckpoint: fixture.onCheckpoint,
      now: () => later(15),
    });
    const resumed = await tickSupervisor({
      ...fixture.options,
      store: replacementStore,
      dispatch: replacementDispatch,
      now: later(15),
      observerId: "replacement-fixture-observer",
    });
    assert.equal(resumed.action, "delivered");
    task = resumed.state.tasks[0];
    assert.equal(
      task.verification_status,
      "pending",
      "Process completion must not certify the result",
    );
    assert.equal(resumed.state.active_task_id, task.task_id);
    assert.equal(task.attempts.length, 2);
    assert.equal(task.contract_sha256, supervisorContractSha256(fixture.taskContract));
    assert.deepEqual(fixture.phases, ["after_stop", "before_resume"]);
    const starts = await jsonLines(fixture.workspace, "starts.jsonl");
    assert.equal(starts.length, 2);
    assert.notEqual(starts[0].pid, starts[1].pid);
    assert.notEqual(starts[0].attempt_id, starts[1].attempt_id);
    assert.equal(starts[0].task_id, starts[1].task_id);
    assert.equal(starts[0].contract_sha256, starts[1].contract_sha256);
    const completion = JSON.parse(
      await fs.readFile(path.join(fixture.workspace, "completion.json"), "utf8"),
    );
    assert.equal(completion.value, 42);
    assert.equal(completion.checkpoint_sha256, task.checkpoint.artifact_sha256);
    assert.equal((await jsonLines(fixture.workspace, "effects.jsonl")).length, 2);
    await tickSupervisor({
      ...fixture.options,
      store: replacementStore,
      dispatch: replacementDispatch,
      now: later(60),
    });
    assert.equal((await jsonLines(fixture.workspace, "starts.jsonl")).length, 2);
  },
);

test(
  "two independent dispatch adapters cannot launch the same reserved attempt twice",
  posix,
  async (t) => {
    const fixture = await setup(t, {
      overrides: { read_only: true, recovery: { mode: "read_only", max_attempts: 3 } },
      code: `${PRELUDE} emit({type:"turn.completed"});`,
      reconcile: false,
    });
    const other = createManagedWorkerDispatch({
      store: await diskStore(fixture.ledger),
      registration: fixture.registration,
      now: () => START,
    });
    const outcomes = [];
    await tickSupervisor({
      ...fixture.options,
      dispatch: async (input) => {
        outcomes.push(...(await Promise.all([fixture.options.dispatch(input), other(input)])));
        return outcomes.find((outcome) => outcome.status === "delivered") ?? outcomes[0];
      },
    });
    assert.equal(outcomes.filter((outcome) => outcome.status === "delivered").length, 1);
    assert.equal(outcomes.filter((outcome) => outcome.status === "uncertain").length, 1);
    assert.equal((await jsonLines(fixture.workspace, "starts.jsonl")).length, 1);
    assert.equal(
      (await fixture.store.events()).filter((event) => event.type === "managed_process_launch")
        .length,
      1,
    );
  },
);

test("worker checkpoint self-report does not authorize writable recovery", posix, async (t) => {
  const fixture = await setup(t, { reconcile: false });
  const result = await tickSupervisor(fixture.options);
  assert.equal(result.action, "blocked");
  assert.equal(result.state.tasks[0].checkpoint, null);
  await tickSupervisor({ ...fixture.options, now: later(60) });
  assert.equal((await jsonLines(fixture.workspace, "starts.jsonl")).length, 1);
});

test(
  "checkpoint drift detected by the next independent observer prevents a second process",
  posix,
  async (t) => {
    const fixture = await setup(t);
    await tickSupervisor(fixture.options);
    const filename = path.join(fixture.workspace, "checkpoint.json");
    const checkpoint = JSON.parse(await fs.readFile(filename, "utf8"));
    await fs.writeFile(filename, JSON.stringify({ ...checkpoint, value: 99 }));
    const dispatch = createManagedWorkerDispatch({
      store: fixture.store,
      registration: fixture.registration,
      onCheckpoint: fixture.onCheckpoint,
      now: () => later(15),
    });
    const result = await tickSupervisor({ ...fixture.options, dispatch, now: later(15) });
    assert.equal(result.action, "uncertain");
    assert.equal(result.state.tasks[0].attempts.length, 2);
    assert.equal((await jsonLines(fixture.workspace, "starts.jsonl")).length, 1);
  },
);

test(
  "durable observer failure closes the real process and preserves an uncertain active slot",
  posix,
  async (t) => {
    const fixture = await setup(t, {
      code: `${PRELUDE} setInterval(() => {}, 1000);`,
      reconcile: false,
    });
    fixture.store.failOnce("worker_activity");
    let outcome;
    const result = await tickSupervisor({
      ...fixture.options,
      dispatch: async (input) => (outcome = await fixture.options.dispatch(input)),
    });
    assert.equal(result.action, "uncertain");
    assert.equal(result.state.active_task_id, fixture.taskContract.task_id);
    assert.equal(outcome.failure_class, "observer_error");
    assert.equal(outcome.process_group_closed, true);
    assert.equal(outcome.process_exit_observed, true);
    assert.equal(JSON.stringify(outcome).includes("fixture-storage-secret"), false);
    await tickSupervisor({ ...fixture.options, now: later(60) });
    assert.equal((await jsonLines(fixture.workspace, "starts.jsonl")).length, 1);
  },
);

test(
  "a lost final ledger write never permits reactivation by a fresh observer",
  posix,
  async (t) => {
    const fixture = await setup(t, {
      overrides: { read_only: true, recovery: { mode: "read_only", max_attempts: 3 } },
      code: `${PRELUDE} emit({type:"turn.completed"});`,
      reconcile: false,
    });
    fixture.store.failOnce("dispatch_outcome");
    await assert.rejects(tickSupervisor(fixture.options), { code: "WRITE_UNCERTAIN" });
    const store = await diskStore(fixture.ledger);
    const dispatch = createManagedWorkerDispatch({
      store,
      registration: fixture.registration,
      now: () => later(60),
    });
    const result = await tickSupervisor({
      ...fixture.options,
      store,
      dispatch,
      now: later(60),
      observerId: "fresh-observer-after-lost-write",
    });
    assert.equal(result.state.active_task_id, fixture.taskContract.task_id);
    assert.ok(["uncertain", "no_signal"].includes(result.state.tasks[0].status));
    assert.equal((await jsonLines(fixture.workspace, "starts.jsonl")).length, 1);
    assert.equal(result.state.tasks[0].attempts.length, 1);
  },
);

test("typed authentication failure blocks retry even for a read-only task", posix, async (t) => {
  const fixture = await setup(t, {
    overrides: { read_only: true, recovery: { mode: "read_only", max_attempts: 3 } },
    code: `${PRELUDE} emit({type:"turn.failed",error:{code:"Unauthorized"}}); process.exitCode=1;`,
    reconcile: false,
  });
  let outcome;
  const result = await tickSupervisor({
    ...fixture.options,
    dispatch: async (input) => (outcome = await fixture.options.dispatch(input)),
  });
  assert.equal(outcome.failure_class, "auth_required");
  assert.equal(outcome.status, "stopped");
  assert.equal(result.action, "blocked");
  await tickSupervisor({ ...fixture.options, now: later(60) });
  assert.equal((await jsonLines(fixture.workspace, "starts.jsonl")).length, 1);
});

test(
  "unregistered worker selection and missing terminal never become success",
  posix,
  async (t) => {
    const wrong = await setup(t, { workerId: "different-worker" });
    assert.equal((await tickSupervisor(wrong.options)).action, "uncertain");
    assert.equal((await jsonLines(wrong.workspace, "starts.jsonl")).length, 0);
    const missing = await setup(t, {
      code: `${PRELUDE} emit({type:"error",message:"completed"});`,
      reconcile: false,
    });
    const result = await tickSupervisor(missing.options);
    assert.equal(result.action, "uncertain");
    assert.equal(result.state.active_task_id, missing.taskContract.task_id);
    assert.equal(result.state.tasks[0].attempts.length, 1);
  },
);

test(
  "activity is throttled, terminal recorded, and prompts/prose/secrets stay out of the ledger",
  posix,
  async (t) => {
    const secret = "fixture-private-prompt-and-output";
    let tick = 0;
    const fixture = await setup(t, {
      overrides: { read_only: true, recovery: { mode: "read_only", max_attempts: 3 } },
      code: `${PRELUDE}
      fs.writeSync(2, ${JSON.stringify(secret)});
      for(let i=0;i<80;i++) emit({type:"item.updated",item:{text:${JSON.stringify(secret)}}});
      emit({type:"turn.completed"});
    `,
      reconcile: false,
      clock: () => new Date(Date.parse(START) + 1000 * tick++),
    });
    const registration = {
      ...fixture.registration,
      inputForTask: (input) =>
        JSON.stringify({ ...JSON.parse(inputForTask(input)), private_prompt: secret }),
    };
    const dispatch = createManagedWorkerDispatch({
      store: fixture.store,
      registration,
      now: () => new Date(Date.parse(START) + 1000 * tick++),
    });
    const result = await tickSupervisor({ ...fixture.options, dispatch });
    assert.equal(result.action, "delivered");
    const events = (await fixture.store.events()).filter(
      (event) => event.type === "worker_activity",
    );
    assert.equal(events[0].activity_type, "thread.started");
    assert.equal(events.at(-1).activity_type, "turn.completed");
    assert.ok(events.length >= 3 && events.length <= 5);
    for (let index = 1; index < events.length - 1; index++)
      assert.ok(Date.parse(events[index].at) - Date.parse(events[index - 1].at) >= 60000);
    const ledger = await fs.readFile(path.join(fixture.ledger, "state.json"), "utf8");
    assert.equal(ledger.includes(secret), false);
    assert.equal(ledger.includes("heartbeat"), false);
  },
);
