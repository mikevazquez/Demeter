import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { initialState, validateState } from "../../scripts/governance-evaluator.mjs";
import { SharedLedger, SharedConflict, BRANCH, JOURNAL } from "../../scripts/governance-shared.mjs";
import {
  reserveExecution,
  assertExecutionLease,
  reserveSharedExecution,
  checkSharedExecution,
  collectOperationOutcomes,
  addOperationOutcomes,
  recordSharedOutcomes,
  consolidateOperations,
} from "../../scripts/governance-operations.mjs";
import { fixture, ctx } from "./governance-operations-fixture.mjs";

const selected = [{ id: "accepted-v1", recovery: false }];
const context = ctx();
function pure() {
  const f = fixture();
  return { f, p: f.profile, s: initialState(f.profile) };
}
function outcome(overrides = {}) {
  return {
    taskId: "accepted-v1",
    stage: 1,
    phase: "execute",
    sourceSha: context.sourceSha,
    runId: context.runId,
    runAttempt: 1,
    jobId: 101,
    result: "failure",
    modelStep: "failure",
    cause: "not-established-by-job-status",
    automaticRerun: false,
    ...overrides,
  };
}
function outcomeFixture(f, { conclusion = "failure", task = true, phase = "execute" } = {}) {
  const base = f.raw;
  f.raw = async (method, route, body) => {
    if (route.includes("/attempts/1/jobs")) {
      f.calls.push({ method, route, body });
      return {
        total_count: 1,
        jobs: [
          {
            id: 101,
            run_id: context.runId,
            run_attempt: 1,
            head_sha: context.sourceSha,
            name: task ? `${phase} (accepted-v1, false)` : phase,
            status: "completed",
            conclusion,
            steps: [
              {
                name:
                  phase === "execute"
                    ? "Execute task with Codex"
                    : "Repair once using actual verifier feedback on a fresh runner",
                status: "completed",
                conclusion,
              },
            ],
          },
        ],
      };
    }
    return base(method, route, body);
  };
}

test("OPS-01 reserve only the admitted two stages without mutating inputs", () => {
  const { p, s } = pure();
  const before = JSON.stringify([p, s]);
  const result = reserveExecution(s, p, context, selected);
  assert.equal(result.state.events[0].data.maximumStages, 2);
  assert.deepEqual(result.tasks, selected);
  assert.equal(JSON.stringify([p, s]), before);
});
test("OPS-02 same reservation is idempotent", () => {
  const { p, s } = pure();
  const a = reserveExecution(s, p, context, selected);
  const b = reserveExecution(a.state, p, context, selected);
  assert.deepEqual(a, b);
});
test("OPS-03 another run cannot restart an interrupted generation budget", () => {
  const { p, s } = pure();
  const a = reserveExecution(s, p, context, selected);
  const b = reserveExecution(a.state, p, { ...context, runId: 11 }, selected);
  assert.equal(b.tasks.length, 0);
  assert.equal(b.blocked[0].ownerRunId, 10);
});
test("OPS-04 partial rerun cannot use the previous attempt lease", () => {
  const { p, s } = pure();
  const a = reserveExecution(s, p, context, selected);
  assert.throws(
    () => assertExecutionLease(a.state, p, { ...context, attempt: 2 }, selected[0].id, 1),
    /owner changed/,
  );
  assert.equal(reserveExecution(a.state, p, { ...context, attempt: 2 }, selected).tasks.length, 0);
});
test("OPS-05 original run may use exactly the two configured stages", () => {
  const { p, s } = pure();
  const a = reserveExecution(s, p, context, selected);
  for (const stage of [1, 2])
    assert.equal(assertExecutionLease(a.state, p, context, selected[0].id, stage), true);
  for (const stage of [0, 3, "1"])
    assert.throws(() => assertExecutionLease(a.state, p, context, selected[0].id, stage));
});
test("OPS-06 contract edits cannot repurpose a reserved task ID", () => {
  const { p, s } = pure();
  const a = reserveExecution(s, p, context, selected);
  p.tasks[0].issueBodySha256 = "f".repeat(64);
  assert.throws(
    () => assertExecutionLease(a.state, p, context, selected[0].id, 1),
    /contract changed/,
  );
  assert.equal(reserveExecution(a.state, p, context, selected).tasks.length, 0);
});
test("OPS-07 snapshot renewal cannot replenish a lease", () => {
  const { p, s } = pure();
  const a = reserveExecution(s, p, context, selected);
  p.source.capturedAt = "2026-10-15T17:00:00.000Z";
  p.source.expiresAt = "2026-10-17T17:00:00.000Z";
  assert.equal(reserveExecution(a.state, p, { ...context, runId: 11 }, selected).tasks.length, 0);
});
test("OPS-08 orphan recovery never grants a new generation", () => {
  const { p, s } = pure();
  const result = reserveExecution(s, p, context, [{ id: "accepted-v1", recovery: true }]);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.state.events.length, 0);
  assert.throws(() => assertExecutionLease(result.state, p, context, "accepted-v1", 1), /required/);
});
test("OPS-09 shared reservation is recovered by a new ledger instance", async () => {
  const f = fixture();
  f.prs = false;
  const r = await reserveSharedExecution(f.api, context, selected);
  const recovered = await new SharedLedger(f.api).read();
  assert.equal(r.revision, recovered.record.sha256);
  assert.equal(r.changed, true);
  assert.equal(
    await checkSharedExecution(f.api, context, "accepted-v1", 1).then((r) => r.allowed),
    true,
  );
});
test("OPS-10 missing journal returns no execution permission and no write", async () => {
  const f = fixture();
  f.prs = false;
  f.missing = true;
  await assert.rejects(reserveSharedExecution(f.api, context, selected));
  assert.equal(f.writes().length, 0);
});
test("OPS-11 lost update response is recovered, not written twice", async () => {
  const f = fixture();
  f.prs = false;
  f.lost = true;
  const r = await reserveSharedExecution(f.api, context, selected);
  assert.equal(r.tasks.length, 1);
  assert.equal(f.calls.filter((c) => c.method === "PATCH").length, 1);
});
test("OPS-12 competing writer stops reservation instead of overwriting", async () => {
  const f = fixture();
  f.prs = false;
  f.race = true;
  await assert.rejects(reserveSharedExecution(f.api, context, selected), SharedConflict);
});
test("OPS-13 stale policy blocks before reservation", async () => {
  const f = fixture();
  f.prs = false;
  f.profile.source.sha256 = "f".repeat(64);
  f.changeProfile();
  await assert.rejects(reserveSharedExecution(f.api, context, selected));
  assert.equal(f.writes().length, 0);
});
test("OPS-14 current PR prevents reservation of already delivered work", async () => {
  const f = fixture();
  await assert.rejects(reserveSharedExecution(f.api, context, selected), /selection changed/);
  assert.equal(f.writes().length, 0);
});
test("OPS-15 independent idle runs consume neither lease nor write", async () => {
  const f = fixture();
  const r = await reserveSharedExecution(f.api, context, []);
  assert.deepEqual(r.tasks, []);
  assert.equal(r.changed, false);
  assert.equal(f.writes().length, 0);
});
test("OPS-16 active coordinator blocks even a correctly owned lease", async () => {
  const f = fixture();
  f.prs = false;
  await reserveSharedExecution(f.api, context, selected);
  f.active = [
    {
      id: 99,
      repository: { full_name: f.profile.repository },
      head_branch: BRANCH,
      path: ".github/workflows/governance-codex-coordinator.yml",
      status: "in_progress",
    },
  ];
  await assert.rejects(checkSharedExecution(f.api, context, "accepted-v1", 1), /gate blocked/);
});
test("OPS-17 changed code is not treated as journal-only successor", async () => {
  const f = fixture();
  f.prs = false;
  await reserveSharedExecution(f.api, context, selected);
  f.codeChanged = true;
  await assert.rejects(checkSharedExecution(f.api, context, "accepted-v1", 1), /code changed/);
});
test("OPS-18 observed result prevents reusing that stage", () => {
  const { p, s } = pure();
  const a = reserveExecution(s, p, context, selected);
  const after = addOperationOutcomes(a.state, context, [outcome()]);
  assert.throws(
    () => assertExecutionLease(after, p, context, "accepted-v1", 1),
    /already observed/,
  );
  assert.equal(assertExecutionLease(after, p, context, "accepted-v1", 2), true);
});
test("OPS-19 failed job is recorded without inventing credential diagnosis", async () => {
  const f = fixture();
  outcomeFixture(f);
  const r = await collectOperationOutcomes(f.api, context, f.profile);
  assert.equal(r.length, 1);
  assert.equal(r[0].cause, "not-established-by-job-status");
  assert.equal(r[0].automaticRerun, false);
});
test("OPS-20 failed report remains observable without a report artifact", async () => {
  const f = fixture();
  outcomeFixture(f, { phase: "report", task: false });
  const r = await recordSharedOutcomes(f.api, context);
  const ledger = await new SharedLedger(f.api).read();
  assert.equal(r.outcomes[0].phase, "report");
  assert.equal(
    ledger.record.state.events.some((e) => e.type === "execution_outcome"),
    true,
  );
});
test("OPS-21 repeated outcome does not duplicate its receipt", () => {
  const { s } = pure();
  const a = addOperationOutcomes(s, context, [outcome()]);
  assert.deepEqual(addOperationOutcomes(a, context, [outcome()]), a);
  assert.throws(
    () => addOperationOutcomes(a, context, [outcome({ result: "success" })]),
    /conflicting/,
  );
});
test("OPS-22 outcome whitelist ignores untrusted extra text", () => {
  const { s } = pure();
  const a = addOperationOutcomes(s, context, [
    outcome({ message: "FAKE_SECRET_TEST", command: "delete main" }),
  ]);
  assert.equal(JSON.stringify(a).includes("FAKE_SECRET_TEST"), false);
  assert.equal(JSON.stringify(a).includes("delete main"), false);
});
test("OPS-23 corrupt operation identities and unsafe fields are rejected", () => {
  const { p, s } = pure();
  const a = reserveExecution(s, p, context, selected);
  for (const change of [
    (d) => (d.maximumStages = 3),
    (d) => (d.runId = 0),
    (d) => (d.command = "delete"),
    (d) => (d.contractHash = "bad"),
  ]) {
    const bad = structuredClone(a.state);
    change(bad.events[0].data);
    assert.throws(() => validateState(bad));
  }
  for (const patch of [{ stage: 3 }, { phase: "production" }, { jobId: 0 }, { result: "invented" }])
    assert.throws(() => addOperationOutcomes(s, context, [outcome(patch)]));
});
test("OPS-24 unadmitted, duplicate and paused tasks are rejected", () => {
  const { p, s } = pure();
  assert.throws(() => reserveExecution(s, p, context, [...selected, ...selected]));
  assert.throws(() => reserveExecution(s, p, context, [{ id: "not-admitted", recovery: false }]));
  p.tasks[0].status = "paused";
  assert.throws(() => reserveExecution(s, p, context, selected));
});
test("OPS-25 budget blocking appears in the consolidated report", () => {
  const report = {
    sourceSha: context.sourceSha,
    runId: String(context.runId),
    tasks: [{ id: "accepted-v1", state: "not completed" }],
  };
  const reservation = {
    ...context,
    blocked: [{ taskId: "accepted-v1" }],
    revision: "a".repeat(64),
  };
  const r = consolidateOperations(report, reservation, context);
  assert.equal(r.tasks[0].state, "blocked");
  assert.equal(r.operations.state, "blocked");
  assert.equal(r.operations.noticesSent, false);
  assert.throws(() => consolidateOperations(report, { ...reservation, attempt: 2 }, context));
});
test("OPS-26 cancelled and unknown job states are not called successful", async () => {
  const f = fixture();
  outcomeFixture(f, { conclusion: "cancelled" });
  assert.equal((await collectOperationOutcomes(f.api, context, f.profile))[0].result, "cancelled");
  const g = fixture();
  outcomeFixture(g, { conclusion: "new-unknown" });
  await assert.rejects(collectOperationOutcomes(g.api, context, g.profile));
});
test("OPS-27 all adapter writes target only the journal and non-forced control ref", async () => {
  const f = fixture();
  f.prs = false;
  await reserveSharedExecution(f.api, context, selected);
  for (const c of f.writes()) {
    if (c.route.endsWith("/git/trees"))
      assert.deepEqual(
        c.body.tree.map((t) => t.path),
        [JOURNAL],
      );
    else if (c.method === "PATCH") {
      assert.ok(c.route.endsWith(`/heads/${BRANCH}`));
      assert.equal(c.body.force, false);
    } else assert.ok(c.route.endsWith("/git/commits"));
  }
});
test("OPS-28 saved lease keeps all previous events", async () => {
  const f = fixture();
  outcomeFixture(f, { phase: "report", task: false });
  await recordSharedOutcomes(f.api, context);
  f.prs = false;
  const before = await new SharedLedger(f.api).read();
  // Previous delivery was observed; direct pure test confirms no loss or readmission.
  const a = reserveExecution(
    before.record.state,
    f.profile,
    { ...context, at: before.record.state.events.at(-1).at },
    selected,
  );
  assert.deepEqual(
    a.state.events.slice(0, before.record.state.events.length),
    before.record.state.events,
  );
  assert.equal(a.tasks.length, 0);
});
test("OPS-29 workflow wires reserve before both model stages and keeps writer credential-separated", () => {
  const y = fs.readFileSync(
    new URL("../../.github/workflows/governance-codex-coordinator.yml", import.meta.url),
    "utf8",
  );
  const reserve = y.split("  reserve-operations:\n")[1].split("\n  execute:")[0];
  assert.match(reserve, /contents: write/);
  assert.doesNotMatch(reserve, /secrets\.|codex-action/);
  for (const [name, end, stage] of [
    ["execute", "repair", 1],
    ["repair", "certify", 2],
  ]) {
    const job = y.split(`\n  ${name}:\n`)[1].split(`\n  ${end}:`)[0];
    assert.match(job, /reserve-operations/);
    assert.doesNotMatch(job, /contents: write/);
    assert.ok(job.indexOf(`before stage ${stage}`) < job.indexOf("uses: openai/codex-action"));
    assert.match(job, /run: node scripts\/governance-operations.mjs check/);
  }
  const persist = y.split("\n  persist-governance:\n")[1].split("\n  recover-governance:")[0];
  assert.match(persist, /always\(\)/);
  assert.doesNotMatch(persist, /needs\.report\.result == 'success'/);
  assert.match(persist, /run: node scripts\/governance-operations.mjs record/);
});
test("OPS-30 workflow retains certification and no production action", () => {
  const y = fs.readFileSync(
    new URL("../../.github/workflows/governance-codex-coordinator.yml", import.meta.url),
    "utf8",
  );
  assert.match(y, /needs: \[select, reserve-operations, execute, repair\]/);
  assert.match(y, /needs.certify.result == 'success'/);
  assert.equal((y.match(/max-parallel: 1/g) || []).length, 2);
  assert.doesNotMatch(y, /git push|force: true|vercel --prod|supabase db push/);
  const d = fs.readFileSync(
    new URL("../../scripts/governance-operations.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(d, /child_process|OPENAI_API_KEY/);
});
