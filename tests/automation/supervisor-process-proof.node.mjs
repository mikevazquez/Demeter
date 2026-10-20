// Actual Node child processes, synthetic work and Codex-compatible events only.
// These tests provide no evidence of authenticated Codex, provider failover, or C5.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { runProcessContinuityProof } from "../../scripts/automation/supervisor-process-proof.mjs";

const execFileAsync = promisify(execFile);
const posix = { skip: process.platform === "win32" };
const sha = (value) => createHash("sha256").update(value).digest("hex");

async function fixtureDirectory(t, prefix = "governance-continuity-proof-") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function snapshot(directory) {
  const names = (await fs.readdir(directory)).sort();
  return Object.fromEntries(
    await Promise.all(
      names.map(async (name) => [name, sha(await fs.readFile(path.join(directory, name)))]),
    ),
  );
}

test("real interrupted worker resumes its durable checkpoint exactly once", posix, async (t) => {
  const directory = await fixtureDirectory(t);
  const evidence = await runProcessContinuityProof({ directory });
  assert.equal(evidence.status, "passed");
  assert.equal(evidence.scope, "synthetic_continuity_fixture");
  assert.equal(evidence.authenticated_codex_or_c5, false);
  assert.equal(evidence.workers_started_this_invocation, 2);
  assert.equal(evidence.reused_completed_receipt, false);
  assert.equal(evidence.first_attempt.status, "interrupted");
  assert.equal(evidence.first_attempt.failure_class, "cancelled");
  assert.equal(evidence.first_attempt.terminal_observed, false);
  assert.equal(evidence.first_attempt.process_group_closed, true);
  assert.equal(evidence.first_attempt.signal, "SIGTERM");
  assert.equal(evidence.continuation_attempt.status, "completed");
  assert.equal(evidence.continuation_attempt.exit_code, 0);
  assert.equal(evidence.continuation_attempt.process_group_closed, true);
  assert.equal(evidence.continuation_attempt.terminal_observed, true);
  assert.deepEqual(evidence.verification, {
    first_group_closed_before_second_started: true,
    checkpoint_loaded_from_disk: true,
    separate_worker_processes: true,
    separate_observers: true,
    total_worker_start_events: 2,
    checkpoint_writes: 1,
    completion_writes: 1,
    repeated_request_started_workers: 0,
    duplicate_execution_suppressed: true,
  });
  const checkpointBytes = await fs.readFile(path.join(directory, "checkpoint.json"));
  const completion = JSON.parse(await fs.readFile(path.join(directory, "completion.json"), "utf8"));
  assert.equal(evidence.checkpoint.sha256, sha(checkpointBytes));
  assert.equal(JSON.parse(checkpointBytes).value, 41);
  assert.equal(completion.value, 42);
  assert.equal(completion.source_checkpoint_sha256, sha(checkpointBytes));

  const beforeRepeat = await snapshot(directory);
  const repeated = await runProcessContinuityProof({ directory });
  assert.equal(repeated.reused_completed_receipt, true);
  assert.equal(repeated.workers_started_this_invocation, 0);
  assert.equal(repeated.verification.total_worker_start_events, 2);
  assert.deepEqual(
    await snapshot(directory),
    beforeRepeat,
    "Repeat must not rewrite any side effect or claim",
  );
});

test(
  "corrupt saved checkpoint blocks replay instead of starting a replacement",
  posix,
  async (t) => {
    const directory = await fixtureDirectory(t);
    await runProcessContinuityProof({ directory });
    await fs.writeFile(path.join(directory, "checkpoint.json"), '{"value":9000}\n');
    const beforeRepeat = await snapshot(directory);
    await assert.rejects(runProcessContinuityProof({ directory }), { code: "evidence_mismatch" });
    assert.deepEqual(await snapshot(directory), beforeRepeat);
  },
);

test(
  "a prior launch claim without a verified completion never authorizes another worker",
  posix,
  async (t) => {
    const directory = await fixtureDirectory(t);
    await fs.writeFile(
      path.join(directory, "proof.claim.json"),
      JSON.stringify({ schema_version: 1, scope: "synthetic_continuity_fixture" }),
    );
    const beforeRepeat = await snapshot(directory);
    await assert.rejects(runProcessContinuityProof({ directory }), {
      code: "prior_execution_unresolved",
    });
    assert.deepEqual(await snapshot(directory), beforeRepeat);
  },
);

test("proof refuses unrelated directory contents and relative paths", posix, async (t) => {
  const directory = await fixtureDirectory(t);
  await fs.writeFile(path.join(directory, "keep.txt"), "user content");
  await assert.rejects(runProcessContinuityProof({ directory }), {
    code: "dedicated_directory_required",
  });
  assert.deepEqual(await fs.readdir(directory), ["keep.txt"]);
  assert.equal(await fs.readFile(path.join(directory, "keep.txt"), "utf8"), "user content");
  await assert.rejects(runProcessContinuityProof({ directory: "relative" }), {
    code: "absolute_directory_required",
  });
});

test("CLI emits readable sanitized proof JSON from actual processes", posix, async (t) => {
  const secret = "fixture-secret-not-a-real-credential";
  const directory = await fixtureDirectory(t, `${secret}-`);
  const script = fileURLToPath(
    new URL("../../scripts/automation/supervisor-process-proof.mjs", import.meta.url),
  );
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [script, "--directory", directory],
    { env: { FIXTURE_SECRET: secret }, timeout: 10000, maxBuffer: 65536 },
  );
  const evidence = JSON.parse(stdout);
  assert.equal(evidence.status, "passed");
  assert.equal(evidence.workers_started_this_invocation, 2);
  assert.equal(stderr, "");
  assert.equal(stdout.includes(secret), false);
  assert.equal(stdout.includes(directory), false);
  assert.ok(stdout.includes('\n  "scope":'), "Output should be readable JSON");
});
