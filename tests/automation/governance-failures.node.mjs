import test from "node:test";
import assert from "node:assert/strict";
import { digest, initialState, evaluateGovernance } from "../../scripts/governance-evaluator.mjs";
import { sealState, githubClient, REPOSITORY, BRANCH } from "../../scripts/governance-shared.mjs";
import {
  recoverRead,
  classifyReadError,
  readSourceVersion,
  ReadRecoveryBlocked,
} from "../../scripts/governance-failures.mjs";

const at = "2026-10-15T18:00:00.000Z";
const profile = () => ({
  version: 1,
  repository: REPOSITORY,
  controlBranch: BRANCH,
  source: {
    pageId: "b".repeat(32),
    lastEditedAt: at,
    capturedAt: at,
    expiresAt: "2026-10-17T18:00:00.000Z",
    sha256: "c".repeat(64),
  },
  maxTasksPerRun: 1,
  tasks: [],
});
const context = (runId = 10) => ({
  runId,
  attempt: 1,
  sourceVersion: readSourceVersion(profile()),
});
const options = {
  now: () => at,
  wait: () => {
    throw new Error("Unexpected sleep");
  },
};
const http = (status, extra = {}) =>
  Object.assign(new Error("never retain this message or secret"), { status, ...extra });

function memory() {
  let sequence = 0;
  let current = { head: "a".repeat(40), record: sealState(initialState(profile())) };
  const store = {
    commits: [],
    async read() {
      return structuredClone(current);
    },
    async commit(base, state, signature) {
      assert.equal(base.head, current.head, "stale writer");
      assert.deepEqual(
        state.events.slice(0, base.record.state.events.length),
        base.record.state.events,
      );
      const record = sealState(
        state,
        current.record.sequence + 1,
        current.record.sha256,
        signature,
      );
      current = { head: (++sequence).toString(16).padStart(40, "0"), record };
      store.commits.push(structuredClone(current));
      return structuredClone(current);
    },
  };
  return store;
}
const failure = async (promise) => {
  try {
    await promise;
    assert.fail("Expected a blocked recovery");
  } catch (error) {
    assert.ok(error instanceof ReadRecoveryBlocked);
    return error.report;
  }
};

test("READ-01 routine success writes no journal and sends no notices", async () => {
  const store = memory();
  const result = await recoverRead(store, context(), async () => ({ complete: true }), options);
  assert.equal(result.report.reason, "read-success");
  assert.equal(result.report.noticesSent, false);
  assert.equal(store.commits.length, 0);
});

test("READ-02 transient failure reserves durably before its single retry", async () => {
  const store = memory();
  let reads = 0;
  const result = await recoverRead(
    store,
    context(),
    async (current) => {
      reads++;
      if (reads === 1) throw http(503);
      assert.equal(current.record.state.events.at(-1).type, "retry_claim");
      assert.equal((await store.read()).record.state.events.at(-1).type, "retry_claim");
      return "verified source";
    },
    options,
  );
  assert.equal(reads, 2);
  assert.equal(result.value, "verified source");
  assert.equal(result.report.recovered, true);
  assert.equal(result.current.record.state.events.at(-1).data.result, "success");
  assert.equal(store.commits.length, 3);
});

test("READ-03 failed retry exhausts budget across a fresh caller", async () => {
  const store = memory();
  let reads = 0;
  const read = async () => {
    reads++;
    throw http(500);
  };
  const first = await failure(recoverRead(store, context(), read, options));
  assert.equal(first.reason, "budget_exhausted");
  assert.equal(first.notices.length, 1);
  assert.equal(first.notices[0].delivery, "artifact-only");
  const restored = await failure(recoverRead(store, context(11), read, options));
  assert.equal(restored.reason, "budget_exhausted");
  assert.deepEqual(restored.notices, []);
  assert.equal(reads, 2);
  assert.equal(
    (await store.read()).record.state.events.some((e) => e.type === "notice_sent"),
    false,
  );
});

for (const [error, kind] of [
  [http(401), "credential"],
  [http(403), "permission"],
  [http(429, { code: "QUOTA" }), "quota"],
  [http(404), "result"],
])
  test(`READ-04 ${kind} never authorizes another read`, async () => {
    const store = memory();
    let reads = 0;
    const read = async () => {
      reads++;
      throw error;
    };
    const first = await failure(recoverRead(store, context(), read, options));
    const next = await failure(recoverRead(store, context(11), read, options));
    assert.equal(first.kind, kind);
    assert.equal(first.retryExecuted, false);
    assert.equal(reads, 1);
    assert.deepEqual(next.notices, []);
    assert.equal(JSON.stringify(await store.read()).includes(error.message), false);
    const p = profile();
    const decision = evaluateGovernance(
      p,
      {
        repository: REPOSITORY,
        controlBranch: BRANCH,
        cycleId: "notice-dedup-check",
        capturedAt: at,
        controlSha: "a".repeat(40),
        queueBlobSha: "b".repeat(40),
        policy: {
          complete: true,
          pageId: p.source.pageId,
          lastEditedAt: p.source.lastEditedAt,
          snapshotSha256: p.source.sha256,
        },
        issues: { complete: true, items: [] },
        pullRequests: { complete: true, items: [] },
        runs: { complete: true, items: [] },
      },
      (await store.read()).record.state,
    );
    assert.deepEqual(
      decision.notices,
      [],
      "shared evaluator must not duplicate the recovery outbox",
    );
  });

test("READ-05 Retry-After defers beyond the current window and survives another caller", async () => {
  const store = memory();
  let reads = 0;
  const first = await failure(
    recoverRead(
      store,
      context(),
      async () => {
        reads++;
        throw http(429, { retryAfterMs: 60000 });
      },
      options,
    ),
  );
  assert.equal(first.reason, "retry_after");
  assert.equal(first.retryExecuted, false);
  assert.deepEqual(first.notices, []);
  const result = await recoverRead(
    store,
    context(11),
    async () => {
      reads++;
      return "recovered";
    },
    { ...options, now: () => "2026-10-15T18:01:00.000Z" },
  );
  assert.equal(result.report.recovered, true);
  assert.equal(reads, 2);
});

test("READ-06 bounded waiting respects the deadline before reserving", async () => {
  const store = memory();
  let clock = Date.parse(at),
    reads = 0,
    waited = 0;
  const result = await recoverRead(
    store,
    context(),
    async () => {
      if (++reads === 1) throw http(429, { retryAfterMs: 1000 });
      return "ok";
    },
    {
      now: () => new Date(clock).toISOString(),
      wait: async (ms) => {
        waited += ms;
        clock += ms;
      },
    },
  );
  assert.equal(waited, 1000);
  assert.equal(result.report.recovered, true);
});

test("READ-07 failed claim write prevents the retry", async () => {
  const store = memory(),
    commit = store.commit;
  let writes = 0,
    reads = 0;
  store.commit = async (...args) => {
    if (++writes === 2) throw new Error("journal unavailable");
    return commit(...args);
  };
  await assert.rejects(
    recoverRead(
      store,
      context(),
      async () => {
        reads++;
        throw http(503);
      },
      options,
    ),
    /journal unavailable/,
  );
  assert.equal(reads, 1);
});

test("READ-08 crash after persisted reservation is not blindly retried", async () => {
  const store = memory(),
    commit = store.commit;
  let writes = 0,
    reads = 0;
  store.commit = async (...args) => {
    const saved = await commit(...args);
    if (++writes === 2) throw new Error("lost claim response");
    return saved;
  };
  const read = async () => {
    reads++;
    throw http(503);
  };
  await assert.rejects(recoverRead(store, context(), read, options), /lost claim/);
  store.commit = commit;
  const blocked = await failure(recoverRead(store, context(11), read, options));
  assert.equal(blocked.reason, "reconcile_interruption");
  assert.equal(reads, 1);
});

test("READ-09 retry result write failure never reports verified recovery", async () => {
  const store = memory(),
    commit = store.commit;
  let writes = 0,
    reads = 0;
  store.commit = async (...args) => {
    if (++writes === 3) throw new Error("cannot certify result");
    return commit(...args);
  };
  await assert.rejects(
    recoverRead(
      store,
      context(),
      async () => {
        if (++reads === 1) throw http(502);
        return "ok";
      },
      options,
    ),
    /cannot certify/,
  );
  store.commit = commit;
  const next = await failure(
    recoverRead(
      store,
      context(11),
      async () => {
        reads++;
        return "ok";
      },
      options,
    ),
  );
  assert.equal(next.reason, "reconcile_interruption");
  assert.equal(reads, 2);
});

test("READ-10 missing journal cannot become an empty history or authorize reads", async () => {
  let reads = 0;
  const store = {
    read: async () => {
      throw http(404);
    },
    commit: () => assert.fail("write"),
  };
  await assert.rejects(
    recoverRead(
      store,
      context(),
      () => {
        reads++;
      },
      options,
    ),
  );
  assert.equal(reads, 0);
});

test("READ-11 source version excludes capture dates but binds policy and admitted tasks", () => {
  const p = profile(),
    version = readSourceVersion(p);
  p.source.capturedAt = "2026-10-15T19:00:00.000Z";
  p.source.expiresAt = "2026-10-17T19:00:00.000Z";
  p.hostedController = { notionCheckedAt: p.source.capturedAt };
  assert.equal(readSourceVersion(p), version);
  p.source.sha256 = "d".repeat(64);
  assert.notEqual(readSourceVersion(p), version);
  p.controlBranch = "main";
  assert.throws(() => readSourceVersion(p), /control branch/);
});

test("READ-12 a successful retry never resets the budget for a later incident", async () => {
  const store = memory();
  let reads = 0;
  await recoverRead(
    store,
    context(),
    async () => {
      if (++reads === 1) throw http(503);
      return "ok";
    },
    options,
  );
  const report = await failure(
    recoverRead(
      store,
      context(11),
      async () => {
        reads++;
        throw http(503);
      },
      options,
    ),
  );
  assert.equal(report.reason, "budget_exhausted");
  await failure(
    recoverRead(
      store,
      context(12),
      async () => {
        reads++;
      },
      options,
    ),
  );
  assert.equal(reads, 3);
});

test("READ-13 terminal retry failure cannot be downgraded into another transient retry", async () => {
  const store = memory();
  let reads = 0;
  const result = await failure(
    recoverRead(
      store,
      context(),
      async () => {
        if (++reads === 1) throw http(503);
        throw http(401);
      },
      options,
    ),
  );
  assert.equal(result.kind, "credential");
  const next = await failure(
    recoverRead(
      store,
      context(11),
      async () => {
        reads++;
        throw http(503);
      },
      options,
    ),
  );
  assert.equal(next.kind, "credential");
  assert.equal(reads, 2);
});

test("READ-14 validation errors never authorize a retry or journal write", async () => {
  const store = memory();
  await assert.rejects(
    recoverRead(
      store,
      context(),
      () => {
        throw new Error("Invalid governance input: identity");
      },
      options,
    ),
    /identity/,
  );
  assert.equal(store.commits.length, 0);
});

for (const [status, headers, kind] of [
  [401, {}, "credential"],
  [403, {}, "permission"],
  [429, {}, "rate_limit"],
  [403, { "retry-after": "30" }, "rate_limit"],
  [403, { "x-ratelimit-remaining": "0" }, "rate_limit"],
  [503, { "retry-after": "invalid" }, "result"],
  [503, { "retry-after": "999999999" }, "result"],
])
  test(`READ-15 HTTP ${status} ${JSON.stringify(headers)} classified without response contents`, async () => {
    const api = githubClient(
      "never-log-this-token",
      async () => new Response("secret body", { status, headers }),
    );
    await assert.rejects(api("GET", `/repos/${REPOSITORY}/issues/1`), (error) => {
      assert.equal(classifyReadError(error).kind, kind);
      assert.equal(error.message.includes("secret"), false);
      assert.equal(error.message.includes("token"), false);
      if (headers["retry-after"] === "30") assert.equal(error.retryAfterMs, 30000);
      return true;
    });
  });

test("READ-16 read recovery exposes no task executor, model, sender or branch writer", () => {
  const p = profile();
  assert.equal(
    context().sourceVersion,
    digest({
      repository: p.repository,
      branch: p.controlBranch,
      pageId: p.source.pageId,
      version: p.source.lastEditedAt,
      snapshot: p.source.sha256,
      tasks: [],
    }),
  );
  assert.throws(() => classifyReadError({ status: 503, retryAfterMs: -1 }), /Retry-After/);
});
