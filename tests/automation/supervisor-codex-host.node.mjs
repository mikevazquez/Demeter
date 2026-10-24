// Synthetic Codex-compatible processes; no model, authentication or external service.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  runCodexHostTick,
  validateCodexHostConfig,
  createCodexHostGitHubRequest,
} from "../../scripts/automation/supervisor-codex-host.mjs";
import { admitSupervisorTask, tickSupervisor } from "../../scripts/automation/supervisor.mjs";
import { createManagedWorkerDispatch } from "../../scripts/automation/supervisor-managed-worker.mjs";
import { supervisorWorkerProfiles } from "../../scripts/automation/supervisor-runner.mjs";
import { applyWorkerStateSignals } from "../../scripts/automation/governance-worker-state.mjs";
const BASE = "a".repeat(40),
  EXECUTOR = "b".repeat(40),
  REPO = "mikevazquez/Demeter";
const copy = (v) => JSON.parse(JSON.stringify(v));

test("Actions knows Codex but neither registration nor owner available fabricates connectivity", () => {
  const profiles = supervisorWorkerProfiles({ configured: true });
  const codex = profiles.find((w) => w.workerId === "codex-managed-worker");
  assert.equal(codex.state, "disconnected");
  const gated = applyWorkerStateSignals(profiles, [
    { workerId: codex.workerId, state: "available", source: "owner_worker_state_signal" },
  ]);
  assert.equal(gated.find((w) => w.workerId === codex.workerId).state, "disconnected");
});

async function fixture(t, { overrides = {}, mode = "completed" } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "codex-host-006-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const cwd = path.join(directory, "workspace");
  await fs.mkdir(cwd);
  let version = 0;
  let state = {
    schema: "governance2-supervisor-v1",
    repository: REPO,
    sequence: 0,
    previous: BASE,
    legacy: { state: { active: null, history: [], entries: [] } },
    tasks: [],
    active_task_id: null,
  };
  const events = [];
  const store = {
    async read() {
      return { version: String(version), state: copy(state) };
    },
    async compareAndSwap(expected, next, event) {
      if (expected !== String(version))
        throw Object.assign(new Error("CAS conflict"), { code: "CAS_CONFLICT" });
      state = copy(next);
      version++;
      events.push(copy(event));
      return this.read();
    },
  };
  const contract = {
    task_id: "GOV-HOST-006-FIXTURE",
    objective: "Synthetic bounded read-only review",
    repo: REPO,
    branch: "governance2/host-fixture",
    base_sha: BASE,
    read_only: true,
    requires_uat: false,
    allowed_paths: ["docs/automation/"],
    required_checks: [{ name: "quality", app_slug: "github-actions" }],
    recovery: { mode: "read_only", max_attempts: 2 },
    required_capabilities: ["repository_review"],
    required_permissions: ["repository:read", "receipt:write"],
    risk_tier: 0,
    quality_floor: 0.9,
    acceptance_criteria: ["Correlated worker receipt"],
    definition_of_done: ["Independent verification"],
    forbidden: ["production"],
    ...overrides,
  };
  await admitSupervisorTask({
    store,
    contract,
    authorization: {
      actor: "mikevazquez",
      reference: `https://github.com/${REPO}/issues/400`,
      authorized_at: new Date().toISOString(),
    },
  });
  const config = {
    schema: "governance-codex-host-v1",
    enabled: true,
    repository: REPO,
    host_id: "demeter-host-fixture",
    executor_sha: EXECUTOR,
    allowed_task_ids: [contract.task_id],
    authorization: `https://github.com/${REPO}/issues/400`,
    workspace: cwd,
    receipt_directory: path.join(directory, "receipts"),
    timeout_ms: 1000,
  };
  const comments = [],
    counts = { launches: 0, posts: 0 };
  const switches = {
    visible: true,
    loseAck: false,
    failPost: false,
    dirty: false,
    failCi: false,
    remoteDrift: false,
  };
  const request = async (method, endpoint, body) => {
    if (method === "POST") {
      assert.equal(endpoint, `repos/${REPO}/issues/341/comments`);
      counts.posts++;
      if (switches.failPost) throw new Error("private-network-error");
      comments.push({
        id: 100 + comments.length,
        user: { login: "mikevazquez" },
        html_url: `https://github.com/${REPO}/issues/341#issuecomment-${100 + comments.length}`,
        body: body.body,
      });
      if (switches.loseAck) throw new Error("private-ack-lost");
      return comments.at(-1);
    }
    assert.equal(method, "GET");
    if (endpoint.includes("/issues/389/comments?")) return [];
    if (endpoint.includes("/issues/341/comments?")) return switches.visible ? copy(comments) : [];
    if (endpoint.includes("/issues/comments/"))
      return copy(comments.find((c) => endpoint.endsWith(String(c.id))));
    if (endpoint.includes("/git/ref/heads/"))
      return {
        ref: `refs/heads/${contract.branch}`,
        object: { type: "commit", sha: switches.remoteDrift ? EXECUTOR : BASE },
      };
    if (endpoint === `repos/${REPO}/git/commits/${BASE}`)
      return { sha: BASE, tree: { sha: EXECUTOR } };
    if (endpoint.includes("/check-runs?"))
      return {
        total_count: 1,
        check_runs: [
          {
            id: 200,
            head_sha: BASE,
            name: "quality",
            app: { slug: "github-actions" },
            status: "completed",
            conclusion: switches.failCi ? "failure" : "success",
            html_url: `https://github.com/${REPO}/actions/runs/1/job/2`,
          },
        ],
      };
    throw new Error(`Unexpected test endpoint: ${endpoint}`);
  };
  const code = `
    const fs=require("node:fs");
    const emit=e=>fs.writeSync(1,JSON.stringify(e)+"\\n");
    const s=fs.readFileSync(0,"utf8");const start=s.indexOf("\\n{\\n")+1;const end=s.indexOf("\\n}\\nReturn only")+2;const d=JSON.parse(s.slice(start,end));
    emit({type:"thread.started",thread_id:"00000000-0000-4000-8000-000000000006"});emit({type:"turn.started"});
    if(${JSON.stringify(mode)}==="auth"){emit({type:"turn.failed",error:{codex_error_info:"unauthorized"}});process.exitCode=1;}
    else if(${JSON.stringify(mode)}==="capacity"){emit({type:"turn.failed",error:{codex_error_info:"usage_limit_exceeded"}});process.exitCode=1;}
    else if(${JSON.stringify(mode)}==="timeout"){setInterval(()=>{},1000);}
    else{
      for(const name of ["GH_TOKEN","GITHUB_TOKEN","OPENAI_API_KEY","NEXT_PUBLIC_SUPABASE_URL"])if(process.env[name])throw new Error("Private environment reached worker");
      const r={schema:"governance-worker-receipt-v2",task_id:d.task_id,attempt_id:d.attempt_id,worker_id:d.worker_id,contract_sha256:d.contract_sha256,dispatch_fingerprint:d.dispatch_fingerprint,status:"completed",base_sha:d.contract.base_sha,current_sha:d.contract.base_sha,files_changed:[],commands_run:[],tests_passed:[],blockers:[],remaining_work:[],next_action:null};
      if(${JSON.stringify(mode)}==="wrong_identity")r.attempt_id="another-attempt";
      if(${JSON.stringify(mode)}==="private_field")r.private_text="must-not-publish";
      if(${JSON.stringify(mode)}==="blocked"){r.status="blocked";r.blockers=["required local check unavailable"];}
      fs.writeFileSync(process.argv[1],JSON.stringify(r),{flag:"wx",mode:0o600});
      emit({type:"turn.completed"});
    }
  `;
  const options = {
    config,
    executorSha: EXECUTOR,
    store,
    request,
    owner: "mikevazquez",
    probeHost: () => ({
      state: "available",
      stateSource: "codex_chatgpt_login_under_managed_environment",
    }),
    inspectWorkspace: () => ({
      root: cwd,
      branch: contract.branch,
      head: contract.base_sha,
      clean: !switches.dirty,
    }),
    makeDispatch: (args) => {
      counts.launches++;
      const argsIndex = args.registration.args.indexOf("--output-last-message");
      assert.ok(argsIndex >= 0);
      assert.equal(args.registration.hostId, config.host_id);
      return createManagedWorkerDispatch({
        ...args,
        registration: {
          ...args.registration,
          command: process.execPath,
          args: ["-e", code, "--", args.registration.args[argsIndex + 1]],
          timeoutMs: mode === "timeout" ? 100 : 3000,
        },
      });
    },
  };
  return { options, store, config, contract, events, counts, switches, comments };
}

test("host config disabled, wrong executor pin or owner fails before authority mutation", async (t) => {
  const f = await fixture(t),
    count = f.events.length;
  for (const config of [
    { ...f.config, enabled: false },
    { ...f.config, executor_sha: "c".repeat(40) },
  ])
    await assert.rejects(runCodexHostTick({ ...f.options, config }));
  await assert.rejects(runCodexHostTick({ ...f.options, owner: "someone-else" }));
  assert.equal(f.events.length, count);
  assert.equal(f.counts.launches, 0);
  assert.throws(() =>
    validateCodexHostConfig({ ...f.config, receipt_directory: f.config.workspace }, EXECUTOR),
  );
});

test("dirty, writable, out-of-scope or unsupported-capability tasks do not reserve", async (t) => {
  for (const overrides of [
    { read_only: false, recovery: { mode: "manual", max_attempts: 1 } },
    { required_capabilities: ["browser_uat"] },
    {},
  ]) {
    const f = await fixture(t, { overrides });
    if (!Object.keys(overrides).length) f.switches.dirty = true;
    const count = f.events.length;
    const result = await runCodexHostTick(f.options);
    assert.ok(["no_matching_host_task", "no_eligible_host_task"].includes(result.action));
    assert.equal(f.events.length, count);
    assert.equal(f.counts.launches, 0);
  }
  const f = await fixture(t);
  const count = f.events.length;
  await runCodexHostTick({
    ...f.options,
    config: { ...f.config, allowed_task_ids: ["different-task"] },
  });
  assert.equal(f.events.length, count);
});

test("real synthetic process shares authority and independently verifies one worker receipt", async (t) => {
  const f = await fixture(t),
    result = await runCodexHostTick(f.options),
    task = result.state.tasks[0];
  assert.equal(task.status, "verified");
  assert.equal(task.verification_status, "verified");
  assert.equal(result.state.active_task_id, null);
  assert.equal(task.attempts.length, 1);
  assert.equal(task.attempts[0].status, "receipt_verified");
  assert.equal(task.attempts[0].codex_host_result.proof.process_group_closed, true);
  assert.equal(f.events.filter((e) => e.type === "managed_process_launch").length, 1);
  assert.equal(f.counts.posts, 1);
  assert.equal(f.counts.launches, 1);
});

test("lost POST acknowledgement recovers the same receipt without another POST or process", async (t) => {
  const f = await fixture(t);
  f.switches.loseAck = true;
  f.switches.visible = false;
  const first = await runCodexHostTick(f.options);
  assert.equal(first.state.tasks[0].status, "delivered");
  f.switches.visible = true;
  const second = await runCodexHostTick({ ...f.options });
  assert.equal(second.state.tasks[0].status, "verified");
  assert.equal(second.state.active_task_id, null);
  assert.equal(f.counts.launches, 1);
  assert.equal(f.counts.posts, 1);
  assert.equal(second.state.tasks[0].attempts.length, 1);
});

test("unconfirmed publication claim never retries POST or relaunches after host restart", async (t) => {
  const f = await fixture(t);
  f.switches.failPost = true;
  await runCodexHostTick(f.options);
  await runCodexHostTick({ ...f.options });
  const current = await f.store.read();
  assert.equal(current.state.tasks[0].status, "delivered");
  assert.equal(f.counts.posts, 1);
  assert.equal(f.counts.launches, 1);
  assert.notEqual(current.state.active_task_id, null);
});

test("auth, capacity and timeout preserve one launch and never publish success", async (t) => {
  for (const mode of ["auth", "capacity", "timeout"]) {
    const f = await fixture(t, { mode });
    await runCodexHostTick(f.options);
    const current = await f.store.read();
    assert.ok(["blocked", "paused_capacity"].includes(current.state.tasks[0].status));
    await runCodexHostTick(f.options);
    assert.equal(f.counts.launches, 1);
    assert.equal(f.counts.posts, 0);
  }
});

test("wrong receipt identity, private fields and drift cannot publish or self-certify", async (t) => {
  for (const mode of ["wrong_identity", "private_field"]) {
    const f = await fixture(t, { mode }),
      result = await runCodexHostTick(f.options);
    assert.equal(result.state.tasks[0].status, "uncertain");
    assert.equal(f.counts.posts, 0);
    await runCodexHostTick(f.options);
    assert.equal(f.counts.launches, 1);
  }
  const f = await fixture(t);
  const original = f.options.makeDispatch;
  f.options.makeDispatch = (args) => {
    const dispatch = original(args);
    return async (input) => {
      const outcome = await dispatch(input);
      f.switches.dirty = true;
      return outcome;
    };
  };
  const result = await runCodexHostTick(f.options);
  assert.equal(result.state.tasks[0].status, "uncertain");
  assert.equal(f.counts.posts, 0);
});

test("failed independent CI retains the slot even with a valid worker receipt", async (t) => {
  const f = await fixture(t);
  f.switches.failCi = true;
  const result = await runCodexHostTick(f.options);
  assert.equal(result.state.tasks[0].verification_status, "blocked");
  assert.notEqual(result.state.active_task_id, null);
  assert.equal(f.counts.launches, 1);
});

test("worker-reported blocked is never success and a restart cannot repeat the model", async (t) => {
  const f = await fixture(t, { mode: "blocked" });
  const result = await runCodexHostTick(f.options);
  assert.equal(result.state.tasks[0].verification_status, "blocked");
  assert.notEqual(result.state.active_task_id, null);
  await runCodexHostTick(f.options);
  assert.equal(f.counts.launches, 1);
  assert.equal(f.counts.posts, 1);
});

test("a process proof from another attempt cannot be used to reconcile publication", async (t) => {
  const f = await fixture(t);
  f.switches.failPost = true;
  await runCodexHostTick(f.options);
  const current = await f.store.read(),
    changed = copy(current.state);
  changed.tasks[0].attempts[0].codex_host_result.proof.attempt_id = "different-attempt";
  await f.store.compareAndSwap(current.version, changed, { type: "synthetic-corrupt-proof" });
  await assert.rejects(runCodexHostTick(f.options), /proof identity/);
  assert.equal(f.counts.launches, 1);
  assert.equal(f.counts.posts, 1);
});

test("durable owner capacity signal blocks a locally authenticated host without mutation", async (t) => {
  const f = await fixture(t),
    request = f.options.request,
    count = f.events.length;
  f.options.request = async (method, endpoint, body) =>
    endpoint.includes("/issues/389/comments?")
      ? [
          {
            id: 1,
            user: { login: "mikevazquez" },
            html_url: `https://github.com/${REPO}/issues/389#issuecomment-1`,
            body:
              "GOVERNANCE_WORKER_STATE_V1\n```json\n" +
              JSON.stringify({
                schema: "governance-worker-state-v1",
                worker_id: "codex-managed-worker",
                state: "no_capacity",
                observed_at: new Date().toISOString(),
              }) +
              "\n```",
          },
        ]
      : request(method, endpoint, body);
  const result = await runCodexHostTick(f.options);
  assert.equal(result.action, "host_unavailable");
  assert.equal(f.events.length, count);
  assert.equal(f.counts.launches, 0);
});

test("a foreign active host cannot publish or adopt the reserved process", async (t) => {
  const f = await fixture(t);
  f.switches.failPost = true;
  await runCodexHostTick(f.options);
  const count = f.events.length;
  const result = await runCodexHostTick({
    ...f.options,
    config: { ...f.config, host_id: "different-host" },
  });
  assert.equal(result.action, "foreign_active_task");
  assert.equal(f.events.length, count);
  assert.equal(f.counts.launches, 1);
});

test("remote branch drift and a receipt directory symlink do not reserve an attempt", async (t) => {
  const f = await fixture(t);
  f.switches.remoteDrift = true;
  const count = f.events.length;
  const result = await runCodexHostTick(f.options);
  assert.equal(result.action, "remote_host_workspace_drift");
  assert.equal(f.events.length, count);
  assert.equal(f.counts.launches, 0);
  const link = path.join(path.dirname(f.config.workspace), "receipt-link");
  await fs.symlink(f.config.workspace, link);
  await assert.rejects(
    runCodexHostTick({ ...f.options, config: { ...f.config, receipt_directory: link } }),
    /resolves inside/,
  );
  assert.equal(f.events.length, count);
});

test("a scoped task still in backoff cannot pause an unrelated ready task", async (t) => {
  const f = await fixture(t);
  await admitSupervisorTask({
    store: f.store,
    contract: { ...f.contract, task_id: "other-ready-task" },
    authorization: {
      actor: "mikevazquez",
      reference: `https://github.com/${REPO}/issues/400`,
      authorized_at: new Date().toISOString(),
    },
  });
  const current = await f.store.read(),
    next = copy(current.state);
  next.tasks[0].status = "paused_capacity";
  next.tasks[0].next_attempt_at = new Date(Date.now() + 3600000).toISOString();
  await f.store.compareAndSwap(current.version, next, { type: "synthetic-backoff" });
  const count = f.events.length;
  const result = await runCodexHostTick(f.options);
  assert.equal(result.action, "no_matching_host_task");
  assert.equal(f.events.length, count);
  assert.equal(f.counts.launches, 0);
  assert.equal(result.state.tasks[1].status, "queued");
});

test("a race that makes the scoped task unavailable cannot mutate another task", async (t) => {
  const f = await fixture(t);
  await admitSupervisorTask({
    store: f.store,
    contract: { ...f.contract, task_id: "other-ready-task" },
    authorization: {
      actor: "mikevazquez",
      reference: `https://github.com/${REPO}/issues/400`,
      authorized_at: new Date().toISOString(),
    },
  });
  const request = f.options.request;
  let raced = false;
  f.options.request = async (method, endpoint, body) => {
    if (!raced && endpoint.includes("/issues/389/comments?")) {
      raced = true;
      const current = await f.store.read(),
        next = copy(current.state);
      next.tasks[0].status = "paused_capacity";
      next.tasks[0].next_attempt_at = new Date(Date.now() + 3600000).toISOString();
      await f.store.compareAndSwap(current.version, next, { type: "synthetic-concurrent-backoff" });
    }
    return request(method, endpoint, body);
  };
  const result = await runCodexHostTick(f.options);
  assert.equal(result.action, "no_eligible_worker");
  assert.equal(result.state.tasks[1].status, "queued");
  assert.equal(f.counts.launches, 0);
  assert.equal(f.events.filter((e) => e.type === "no_eligible_worker").length, 0);
});

test("a concurrent observer retains a fresh host intent and cannot steal its launch", async (t) => {
  const f = await fixture(t),
    original = f.options.makeDispatch;
  f.options.makeDispatch = (args) => {
    const dispatch = original(args);
    return async (input) => {
      const before = await f.store.read();
      const observed = await tickSupervisor({
        store: f.store,
        workers: [],
        dispatch: async () => {
          throw new Error("Observer cannot launch");
        },
        now: new Date(Date.parse(before.state.tasks[0].attempts[0].intent_at) + 1000).toISOString(),
        observerId: "actions-observer",
      });
      assert.equal(observed.action, "observed_no_change");
      assert.equal(observed.state.tasks[0].status, "dispatching");
      return dispatch(input);
    };
  };
  const result = await runCodexHostTick(f.options);
  assert.equal(result.state.tasks[0].status, "verified");
  assert.equal(f.counts.launches, 1);
  assert.equal(f.events.filter((e) => e.type === "managed_process_launch").length, 1);
});

test("expired host intent becomes uncertain, retains its slot and never relaunches", async (t) => {
  const f = await fixture(t);
  f.options.makeDispatch = () => async () => {
    const state = await f.store.read();
    await tickSupervisor({
      store: f.store,
      workers: [],
      dispatch: async () => {
        throw new Error("No replay");
      },
      now: new Date(Date.parse(state.state.tasks[0].attempts[0].intent_at) + 31000).toISOString(),
      observerId: "actions-observer",
    });
    return { status: "unknown" };
  };
  const first = await runCodexHostTick(f.options);
  assert.equal(first.state.tasks[0].status, "uncertain");
  const second = await runCodexHostTick(f.options);
  assert.notEqual(second.state.active_task_id, null);
  assert.equal(second.state.tasks[0].attempts.length, 1);
  assert.equal(f.events.filter((e) => e.type === "managed_process_launch").length, 0);
});

test("GitHub CLI transport bounds mutations and never retries or exposes stderr", async () => {
  const calls = [];
  const request = createCodexHostGitHubRequest({
    spawnImpl(command, args, options) {
      calls.push({ command, args, input: options.input });
      return { status: 0, stdout: '{"ok":true}' };
    },
  });
  await assert.rejects(request("POST", `repos/${REPO}/issues/400/comments`, {}));
  await assert.rejects(
    request("PATCH", `repos/${REPO}/git/refs/heads/main`, { force: false, sha: BASE }),
  );
  await request("POST", `repos/${REPO}/issues/341/comments`, { body: "literal $(never-execute)" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "gh");
  assert.match(calls[0].input, /never-execute/);
  const failed = createCodexHostGitHubRequest({
    spawnImpl() {
      return { status: 1, stderr: "private-token HTTP 403" };
    },
  });
  await assert.rejects(
    failed("GET", `repos/${REPO}/git/ref/heads/main`),
    (error) => error.httpStatus === 403 && !error.message.includes("private-token"),
  );
});
