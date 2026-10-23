// Deterministic synthetic-worker proof using real, owned Node child processes.
// It exercises neither authenticated Codex, a Claude provider, nor C5 acceptance.
import fs from "node:fs/promises";
import { constants, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runManagedWorker } from "./supervisor-process.mjs";

const SCOPE = "synthetic_continuity_fixture";
const SESSION = "00000000-0000-4000-8000-000000000001";
const CHECKPOINT = {
  scope: SCOPE,
  session_id: SESSION,
  completed_step: "save_checkpoint_once",
  next_step: "finish_from_checkpoint_once",
  value: 41,
};
const ARTIFACTS = [
  "checkpoint.json",
  "completion.json",
  "first.receipt.json",
  "second.receipt.json",
  "first.started.json",
  "second.started.json",
  "second.claim.json",
  "effects.jsonl",
];
const EXPECTED_EFFECTS = [
  { worker: 1, step: "checkpoint_saved" },
  { worker: 2, step: "completion_saved" },
];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

class ProofError extends Error {
  constructor(code) {
    super(`Managed-process fixture proof: ${code}`);
    this.code = code;
  }
}

function verify(condition, code = "evidence_mismatch") {
  if (!condition) throw new ProofError(code);
}

async function syncDirectory(directory) {
  const handle = await fs.open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

// Exclusive creation is the durable launch claim. Partial files remain unresolved;
// this fixture never removes a claim or assumes a failed write means safe to retry.
async function writeJson(directory, filename, value) {
  const handle = await fs.open(path.join(directory, filename), "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(directory);
}

async function readArtifact(directory, filename) {
  const handle = await fs.open(
    path.join(directory, filename),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  try {
    const stat = await handle.stat();
    verify(stat.isFile() && stat.size <= 65536);
    const bytes = await handle.readFile();
    return { bytes, sha256: hash(bytes) };
  } finally {
    await handle.close();
  }
}

const parse = (artifact) => JSON.parse(artifact.bytes.toString("utf8"));
const matches = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function firstStopped(receipt) {
  const result = receipt.result;
  return (
    receipt.observer === "first" &&
    receipt.process_started_events === 1 &&
    receipt.checkpoint_event_observed === true &&
    result?.status === "interrupted" &&
    result.failure_class === "cancelled" &&
    result.process_group_closed === true &&
    result.terminal_observed === false &&
    result.session_id === SESSION
  );
}

function secondCompleted(receipt) {
  const result = receipt.result;
  return (
    receipt.observer === "second" &&
    receipt.process_started_events === 1 &&
    result?.status === "completed" &&
    result.failure_class === null &&
    result.exit_code === 0 &&
    result.signal === null &&
    result.process_group_closed === true &&
    result.terminal_observed === true &&
    result.session_id === SESSION
  );
}

function resultMetadata(result) {
  // Even when reading disk evidence, never return arbitrary receipt fields.
  return Object.fromEntries(
    [
      "status",
      "terminal_observed",
      "process_group_closed",
      "exit_code",
      "signal",
      "session_id",
      "failure_class",
      "last_activity_at",
    ].map((key) => [key, result[key]]),
  );
}

// All fixture output is synchronous JSONL. Prompt text and provider credentials are
// unnecessary. These scripts deliberately stay inside the supervisor-owned group.
const PRELUDE = `
  const fs = require("node:fs");
  const {createHash} = require("node:crypto");
  const hash = bytes => createHash("sha256").update(bytes).digest("hex");
  const emit = event => fs.writeSync(1, JSON.stringify(event) + "\\n");
  const read = name => fs.readFileSync(name);
  const readJson = name => JSON.parse(read(name).toString("utf8"));
  const syncDirectory = () => {
    const fd = fs.openSync(".", "r");
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  };
  const writeJson = (name, data) => {
    const fd = fs.openSync(name, "wx", 0o600);
    try {
      fs.writeSync(fd, JSON.stringify(data) + "\\n");
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    syncDirectory();
  };
  const effect = data => {
    const fd = fs.openSync("effects.jsonl", "a", 0o600);
    try {
      fs.writeSync(fd, JSON.stringify(data) + "\\n");
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    syncDirectory();
  };
  const check = condition => { if (!condition) throw new Error("Fixture evidence rejected"); };
  emit({type:"thread.started", thread_id:${JSON.stringify(SESSION)}});
  emit({type:"turn.started"});
`;

const FIRST_WORKER = `${PRELUDE}
  writeJson("first.started.json", {worker:1, pid:process.pid});
  writeJson("checkpoint.json", ${JSON.stringify(CHECKPOINT)});
  effect(${JSON.stringify(EXPECTED_EFFECTS[0])});
  setInterval(() => {}, 1000);
  emit({type:"item.completed", item:{id:"checkpoint", type:"agent_message"}});
`;

const SECOND_WORKER = `${PRELUDE}
  writeJson("second.started.json", {worker:2, pid:process.pid});
  const claim = readJson("second.claim.json");
  const receiptBytes = read("first.receipt.json");
  const prior = JSON.parse(receiptBytes.toString("utf8")).result;
  check(hash(receiptBytes) === claim.first_receipt_sha256);
  check(prior.status === "interrupted" && prior.failure_class === "cancelled");
  check(prior.process_group_closed === true && prior.terminal_observed === false);
  const checkpointBytes = read("checkpoint.json");
  check(hash(checkpointBytes) === claim.checkpoint_sha256);
  const checkpoint = JSON.parse(checkpointBytes.toString("utf8"));
  check(JSON.stringify(checkpoint) === ${JSON.stringify(JSON.stringify(CHECKPOINT))});
  writeJson("completion.json", {
    scope:${JSON.stringify(SCOPE)},
    session_id:checkpoint.session_id,
    source_checkpoint_sha256:hash(checkpointBytes),
    prior_group_closed:true,
    value:checkpoint.value + 1
  });
  effect(${JSON.stringify(EXPECTED_EFFECTS[1])});
  emit({type:"turn.completed"});
`;

async function verifyCompleted(directory, receipt) {
  verify(receipt.schema_version === 1 && receipt.scope === SCOPE);
  verify(matches(Object.keys(receipt.artifacts ?? {}).sort(), [...ARTIFACTS].sort()));
  const artifacts = Object.fromEntries(
    await Promise.all(ARTIFACTS.map(async (name) => [name, await readArtifact(directory, name)])),
  );
  for (const name of ARTIFACTS) verify(artifacts[name].sha256 === receipt.artifacts[name]);

  const checkpoint = parse(artifacts["checkpoint.json"]);
  const completion = parse(artifacts["completion.json"]);
  const first = parse(artifacts["first.receipt.json"]);
  const second = parse(artifacts["second.receipt.json"]);
  const firstStart = parse(artifacts["first.started.json"]);
  const secondStart = parse(artifacts["second.started.json"]);
  const claim = parse(artifacts["second.claim.json"]);
  const effects = artifacts["effects.jsonl"].bytes
    .toString("utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  verify(matches(checkpoint, CHECKPOINT));
  verify(
    matches(completion, {
      scope: SCOPE,
      session_id: SESSION,
      source_checkpoint_sha256: artifacts["checkpoint.json"].sha256,
      prior_group_closed: true,
      value: CHECKPOINT.value + 1,
    }),
  );
  verify(firstStopped(first) && secondCompleted(second));
  verify(
    first.result.checkpoint?.sha256 === artifacts["checkpoint.json"].sha256 &&
      claim.first_receipt_sha256 === artifacts["first.receipt.json"].sha256 &&
      claim.checkpoint_sha256 === artifacts["checkpoint.json"].sha256 &&
      claim.prior_group_closed === true,
  );
  verify(
    firstStart.worker === 1 &&
      secondStart.worker === 2 &&
      Number.isSafeInteger(firstStart.pid) &&
      firstStart.pid > 1 &&
      Number.isSafeInteger(secondStart.pid) &&
      secondStart.pid > 1 &&
      firstStart.pid !== secondStart.pid,
  );
  verify(matches(effects, EXPECTED_EFFECTS));
  return {
    schema_version: 1,
    scope: SCOPE,
    worker_kind: "real_local_node_child_processes",
    status: "passed",
    authenticated_codex_or_c5: false,
    workers_started_this_invocation: 0,
    reused_completed_receipt: true,
    first_attempt: resultMetadata(first.result),
    continuation_attempt: resultMetadata(second.result),
    checkpoint: { file: "checkpoint.json", sha256: artifacts["checkpoint.json"].sha256, value: 41 },
    completion: { file: "completion.json", sha256: artifacts["completion.json"].sha256, value: 42 },
    verification: {
      first_group_closed_before_second_started: true,
      checkpoint_loaded_from_disk: true,
      separate_worker_processes: true,
      separate_observers: true,
      total_worker_start_events: first.process_started_events + second.process_started_events,
      checkpoint_writes: effects.filter((effect) => effect.step === "checkpoint_saved").length,
      completion_writes: effects.filter((effect) => effect.step === "completion_saved").length,
      repeated_request_started_workers: 0,
      duplicate_execution_suppressed: true,
    },
  };
}

async function executeProof(directory) {
  verify(
    typeof directory === "string" && path.isAbsolute(directory),
    "absolute_directory_required",
  );
  verify(process.platform !== "win32", "posix_required");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(directory);
  verify(stat.isDirectory() && !stat.isSymbolicLink(), "dedicated_directory_required");
  const existing = await fs.readdir(directory);
  if (existing.includes("proof.claim.json")) {
    verify(existing.includes("proof.complete.json"), "prior_execution_unresolved");
    const claim = parse(await readArtifact(directory, "proof.claim.json"));
    verify(claim.scope === SCOPE && claim.schema_version === 1);
    return verifyCompleted(directory, parse(await readArtifact(directory, "proof.complete.json")));
  }
  verify(existing.length === 0, "dedicated_directory_required");
  try {
    await writeJson(directory, "proof.claim.json", { schema_version: 1, scope: SCOPE });
  } catch (error) {
    if (error.code === "EEXIST") throw new ProofError("prior_execution_unresolved");
    throw error;
  }

  let workersStarted = 0;
  const abort = new AbortController();
  const firstObserver = {
    observer: "first",
    process_started_events: 0,
    checkpoint_event_observed: false,
  };
  const first = await runManagedWorker({
    command: process.execPath,
    args: ["-e", FIRST_WORKER],
    cwd: directory,
    env: {},
    timeoutMs: 3000,
    signal: abort.signal,
    onActivity: (event) => {
      if (event.type === "process.started") {
        firstObserver.process_started_events++;
        workersStarted++;
      }
      if (event.type === "item.completed") {
        firstObserver.checkpoint_event_observed = true;
        abort.abort();
      }
    },
    onCheckpoint: async (result) => {
      if (!result.process_group_closed) return;
      const artifact = await readArtifact(directory, "checkpoint.json");
      verify(matches(parse(artifact), CHECKPOINT));
      return { file: "checkpoint.json", sha256: artifact.sha256 };
    },
  });
  await writeJson(directory, "first.receipt.json", { ...firstObserver, result: first });

  // A new observer loads the old closure receipt and checkpoint from disk. No
  // successor is launched unless the managed wrapper actually closed the old group.
  const firstReceipt = await readArtifact(directory, "first.receipt.json");
  verify(firstStopped(parse(firstReceipt)), "first_group_not_confirmed_closed");
  const checkpoint = await readArtifact(directory, "checkpoint.json");
  verify(matches(parse(checkpoint), CHECKPOINT));
  verify(first.checkpoint?.sha256 === checkpoint.sha256);
  await writeJson(directory, "second.claim.json", {
    scope: SCOPE,
    prior_group_closed: true,
    first_receipt_sha256: firstReceipt.sha256,
    checkpoint_sha256: checkpoint.sha256,
  });

  const secondObserver = { observer: "second", process_started_events: 0 };
  const second = await runManagedWorker({
    command: process.execPath,
    args: ["-e", SECOND_WORKER],
    cwd: directory,
    env: {},
    timeoutMs: 3000,
    onActivity: (event) => {
      if (event.type === "process.started") {
        secondObserver.process_started_events++;
        workersStarted++;
      }
    },
  });
  await writeJson(directory, "second.receipt.json", { ...secondObserver, result: second });
  verify(secondCompleted({ ...secondObserver, result: second }), "continuation_not_completed");

  const receipt = {
    schema_version: 1,
    scope: SCOPE,
    artifacts: Object.fromEntries(
      await Promise.all(
        ARTIFACTS.map(async (name) => [name, (await readArtifact(directory, name)).sha256]),
      ),
    ),
  };
  await verifyCompleted(directory, receipt);
  await writeJson(directory, "proof.complete.json", receipt);

  // Exercise the same public entry point again. A verified completion reuses its
  // receipt; a launch claim without completion is deliberately never retried.
  const repeated = await executeProof(directory);
  verify(repeated.workers_started_this_invocation === 0 && workersStarted === 2);
  return {
    ...repeated,
    workers_started_this_invocation: workersStarted,
    reused_completed_receipt: false,
  };
}

/**
 * Run an isolated fixture in an empty, dedicated absolute directory. Successful
 * repeated calls validate saved evidence and launch zero workers. Any partial or
 * ambiguous previous execution remains blocked; use a fresh directory for a new
 * fixture. Result JSON contains only fixed fixture data and sanitized process facts.
 */
export async function runProcessContinuityProof({ directory } = {}) {
  try {
    return await executeProof(directory);
  } catch (error) {
    if (error instanceof ProofError) throw error;
    throw new ProofError("fixture_io_or_evidence_error");
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2);
    verify(args.length === 2 && args[0] === "--directory", "directory_argument_required");
    const result = await runProcessContinuityProof({ directory: args[1] });
    writeSync(1, `${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    writeSync(
      2,
      `${JSON.stringify({ scope: SCOPE, status: "failed", failure_class: error instanceof ProofError ? error.code : "proof_failed" })}\n`,
    );
    process.exitCode = 1;
  }
}
