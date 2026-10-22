// Real local child processes with synthetic Codex JSONL. No Codex installation,
// authentication, model request, external provider, or live failover is exercised.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildCodexCommand,
  runManagedWorker,
} from "../../scripts/automation/supervisor-process.mjs";

const SESSION = "0199a213-81c0-7800-8aa1-bbab2a035a53";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const preamble = `
  const emit = (event) => require("node:fs").writeSync(1, JSON.stringify(event) + "\\n");
  emit({type:"thread.started",thread_id:${JSON.stringify(SESSION)}});
  emit({type:"turn.started"});
`;
const posix = { skip: process.platform === "win32" };

function run(code, options = {}) {
  return runManagedWorker({
    command: process.execPath,
    args: ["-e", code],
    cwd: os.tmpdir(),
    timeoutMs: 1500,
    ...options,
  });
}

async function fixtureDirectory(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "governance-managed-process-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("builds argv without shell or implicit resume; caller supplies a registered UUID", () => {
  assert.deepEqual(buildCodexCommand(), {
    command: "codex",
    args: ["exec", "--json", "--sandbox", "workspace-write", "-"],
  });
  assert.deepEqual(buildCodexCommand({ binary: "/trusted/codex", registeredSessionId: SESSION }), {
    command: "/trusted/codex",
    args: ["exec", "--json", "--sandbox", "workspace-write", "resume", SESSION, "-"],
  });
  for (const registeredSessionId of [
    "--last",
    "",
    "unregistered name",
    `${SESSION}; touch /tmp/no`,
  ]) {
    assert.throws(
      () => buildCodexCommand({ registeredSessionId }),
      /registered Codex session UUID/,
    );
  }
});

test(
  "observes live activity, independent heartbeats, and terminal plus process closure",
  posix,
  async () => {
    const events = [];
    let tick = 0;
    const result = await run(
      `${preamble}
    setTimeout(() => emit({type:"item.completed",item:{type:"agent_message",text:"working"}}), 80);
    setTimeout(() => emit({type:"turn.completed",usage:{output_tokens:1}}), 400);
  `,
      {
        timeoutMs: 1200,
        now: () => new Date(Date.UTC(2026, 9, 20, 0, 0, tick++)),
        onActivity: (event) => events.push(event),
        onCheckpoint: (state) => ({
          session_id: state.session_id,
          observed: state.terminal_observed,
        }),
      },
    );
    assert.equal(result.status, "completed");
    assert.equal(result.exit_code, 0);
    assert.equal(result.terminal_observed, true);
    assert.equal(result.process_group_closed, true);
    assert.equal(result.session_id, SESSION);
    assert.ok(events.some((event) => event.type === "heartbeat"));
    assert.ok(events.some((event) => event.type === "item.completed"));
    assert.deepEqual(result.checkpoint, { session_id: SESSION, observed: true });
    assert.match(result.last_activity_at, /^2026-10-20T/);
    assert.equal(
      events.some((event) => JSON.stringify(event).includes("working")),
      false,
    );
  },
);

test("item completion and an error message cannot forge a terminal result", posix, async () => {
  const result = await run(`${preamble}
    emit({type:"item.completed",item:{type:"agent_message",text:"Completed successfully"}});
    emit({type:"error",message:"temporary reconnect"});
  `);
  assert.equal(result.status, "unknown");
  assert.equal(result.terminal_observed, false);
  assert.equal(result.failure_class, "missing_terminal");
  assert.equal(result.process_group_closed, true);
});

test("recoverable error event followed by a completed turn remains successful", posix, async () => {
  const result = await run(`${preamble}
    emit({type:"error",message:"temporary reconnect"});
    emit({type:"turn.completed"});
  `);
  assert.equal(result.status, "completed");
  assert.equal(result.failure_class, null);
});

test("completed marker with nonzero process exit is not success", posix, async () => {
  const result = await run(`${preamble} emit({type:"turn.completed"}); process.exitCode = 7;`);
  assert.equal(result.status, "unknown");
  assert.equal(result.failure_class, "exit_mismatch");
  assert.equal(result.exit_code, 7);
  assert.equal(result.terminal_observed, true);
});

test("failed turn classification uses typed provider codes, never prose", posix, async () => {
  for (const [error, expected] of [
    [{ codexErrorInfo: "UsageLimitExceeded" }, "capacity"],
    [{ codexErrorInfo: "Unauthorized" }, "authentication"],
    [{ codexErrorInfo: { httpConnectionFailed: { httpStatusCode: 429 } } }, "capacity"],
    [{ message: "UsageLimitExceeded Unauthorized secret" }, "worker_error"],
  ]) {
    const result = await run(
      `${preamble} emit({type:"turn.failed",error:${JSON.stringify(error)}}); process.exitCode = 1;`,
    );
    assert.equal(result.status, "failed");
    assert.equal(result.failure_class, expected);
    assert.equal(result.process_group_closed, true);
  }
});

test("heartbeats do not invent worker activity in a silent process", posix, async () => {
  const events = [];
  const result = await run("setInterval(() => {}, 1000);", {
    timeoutMs: 160,
    onActivity: (event) => events.push(event),
  });
  assert.equal(result.status, "interrupted");
  assert.equal(result.failure_class, "timeout");
  assert.equal(result.last_activity_at, null);
  assert.equal(result.terminal_observed, false);
  assert.ok(events.some((event) => event.type === "heartbeat"));
  assert.equal(result.process_group_closed, true);
});

test(
  "timeout closes a real owned process group including a child ignoring SIGTERM",
  posix,
  async (t) => {
    const directory = await fixtureDirectory(t);
    const marker = path.join(directory, "child-heartbeat");
    const childScript = `
    const fs = require("node:fs");
    process.on("SIGTERM", () => {});
    setInterval(() => fs.appendFileSync(${JSON.stringify(marker)}, "x"), 20);
  `;
    const result = await run(
      `${preamble}
    const {spawn} = require("node:child_process");
    spawn(process.execPath,["-e",${JSON.stringify(childScript)}],{stdio:"ignore"});
    process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
  `,
      { timeoutMs: 350 },
    );
    assert.equal(result.status, "interrupted");
    assert.equal(result.failure_class, "timeout");
    assert.equal(result.process_group_closed, true);
    assert.equal(result.signal, "SIGKILL");
    const size = (await fs.stat(marker)).size;
    assert.ok(size > 0, "The real descendant must have executed before cancellation");
    await pause(100);
    assert.equal(
      (await fs.stat(marker)).size,
      size,
      "No descendant writes after verified shutdown",
    );
  },
);

test(
  "normal parent closure does not leave its detached-group descendants writing",
  posix,
  async (t) => {
    const directory = await fixtureDirectory(t);
    const marker = path.join(directory, "survivor-heartbeat");
    const childScript = `
    const fs = require("node:fs");
    process.on("SIGTERM", () => {});
    setInterval(() => fs.appendFileSync(${JSON.stringify(marker)}, "x"), 20);
  `;
    const result = await run(`${preamble}
    const {spawn} = require("node:child_process");
    const child = spawn(process.execPath,["-e",${JSON.stringify(childScript)}],{stdio:"ignore"});
    child.unref();
    setTimeout(() => emit({type:"turn.completed"}), 140);
  `);
    assert.equal(result.status, "completed");
    assert.equal(result.process_group_closed, true);
    const size = (await fs.stat(marker)).size;
    await pause(100);
    assert.equal((await fs.stat(marker)).size, size);
  },
);

test("observer rejection fails closed and still kills the real worker", posix, async () => {
  const result = await run(`${preamble} setInterval(() => {}, 1000);`, {
    onActivity: async (event) => {
      if (event.type === "thread.started") throw new Error("private observer token sk-test-secret");
    },
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.failure_class, "observer_error");
  assert.equal(result.process_group_closed, true);
  assert.equal(JSON.stringify(result).includes("sk-test-secret"), false);
});

test("checkpoint observer failure never reports successful completion", posix, async () => {
  const result = await run(`${preamble} emit({type:"turn.completed"});`, {
    onCheckpoint: () => {
      throw new Error("secret checkpoint failure");
    },
  });
  assert.equal(result.status, "unknown");
  assert.equal(result.failure_class, "observer_error");
  assert.equal(result.process_group_closed, true);
  assert.equal(JSON.stringify(result).includes("secret checkpoint"), false);
});

test(
  "observer budgets support durable-storage latency while bounded expiry still fails closed",
  posix,
  async () => {
    const code = `${preamble} emit({type:"turn.completed"});`;
    const onActivity = async (event) => {
      if (event.type === "thread.started") await pause(60);
    };
    const allowed = await run(code, { onActivity, observerTimeoutMs: 200 });
    assert.equal(allowed.status, "completed");
    assert.equal(allowed.process_group_closed, true);
    const expired = await run(code, { onActivity, observerTimeoutMs: 10 });
    assert.equal(expired.status, "unknown");
    assert.equal(expired.failure_class, "observer_error");
    assert.equal(expired.process_group_closed, true);
    await assert.rejects(run(code, { observerTimeoutMs: 60001 }), /Invalid observer timeout/);
  },
);

test("abort cancels only the managed process and confirms group closure", posix, async () => {
  const controller = new AbortController();
  const result = await run(`${preamble} setInterval(() => {}, 1000);`, {
    signal: controller.signal,
    onActivity: (event) => {
      if (event.type === "turn.started") controller.abort();
    },
  });
  assert.equal(result.status, "interrupted");
  assert.equal(result.failure_class, "cancelled");
  assert.equal(result.process_group_closed, true);
});

test(
  "redacts prompt, stderr, command output, event prose, and injected env values",
  posix,
  async () => {
    const secret = "sk-test-only-secret-should-never-return";
    const events = [];
    const result = await run(
      `${preamble}
    process.stdin.resume();
    process.stdin.on("data", chunk => require("node:fs").writeSync(2, chunk));
    require("node:fs").writeSync(2, process.env.FIXTURE_SECRET);
    emit({type:"item.completed",item:{type:"command_execution",command:process.env.FIXTURE_SECRET,aggregated_output:process.env.FIXTURE_SECRET}});
    emit({type:"error",message:process.env.FIXTURE_SECRET});
    emit({type:"turn.completed"});
  `,
      {
        input: secret,
        env: { FIXTURE_SECRET: secret },
        onActivity: (event) => events.push(event),
      },
    );
    assert.equal(result.status, "completed");
    assert.equal(JSON.stringify({ result, events }).includes(secret), false);
  },
);

test(
  "malformed or contradictory JSONL fails closed without exposing its bytes",
  posix,
  async () => {
    for (const extra of [
      'require("node:fs").writeSync(1, "private-invalid-secret\\n");',
      'emit({type:"turn.completed"}); emit({type:"turn.failed"});',
    ]) {
      const result = await run(`${preamble} ${extra}`);
      assert.equal(result.status, "unknown");
      assert.equal(result.failure_class, "protocol_error");
      assert.equal(result.process_group_closed, true);
      assert.equal(JSON.stringify(result).includes("private-invalid-secret"), false);
    }
  },
);

test(
  "spawn failure and a pre-aborted signal cannot fabricate worker execution",
  posix,
  async () => {
    const missing = await runManagedWorker({
      command: "/nonexistent/governance-fixture",
      args: [],
      cwd: os.tmpdir(),
    });
    assert.equal(missing.status, "failed");
    assert.equal(missing.failure_class, "spawn_error");
    assert.equal(missing.terminal_observed, false);
    const controller = new AbortController();
    controller.abort();
    const result = await run("throw new Error('must not run');", { signal: controller.signal });
    assert.equal(result.status, "interrupted");
    assert.equal(result.failure_class, "cancelled");
    assert.equal(result.session_id, null);
  },
);
