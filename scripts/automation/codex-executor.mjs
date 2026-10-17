// Trusted supervisor adapter. Reuses #314's registry; never publishes or starts a service.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { reserve } from "../studio-flow-minimal.mjs";
import { isTrustedStateComment, parseState } from "./continuity-lab.mjs";

const assert = (value, message) => {
  if (!value) throw new Error(message);
};
const read = (filename) => JSON.parse(fs.readFileSync(filename, "utf8"));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const FIRST_RUN = 38989415241;
const REPOSITORY = "mikevazquez/Demeter";
const LAUNCHER_TASK = "vianelis-launcher-318-v1";

// Inputs are complete REST responses obtained by the trusted supervisor, not agent output.
export function verifyContinuity(comments, runs) {
  assert(Array.isArray(comments) && Array.isArray(runs), "Complete comments and runs required");
  const states = comments
    .filter(isTrustedStateComment)
    .map((comment) => ({ id: comment.id, state: parseState(comment.body) }))
    .filter((entry) => entry.state !== null)
    .sort((a, b) => a.id - b.id);
  assert(
    states.length === 2,
    "Exactly two state transitions required; pending or duplicate history",
  );
  const [waiting, complete] = states;
  assert(Number.isSafeInteger(waiting.id) && complete.id > waiting.id, "Invalid comment identity");
  assert(
    waiting.state.phase === "waiting" &&
      waiting.state.startedBy === FIRST_RUN &&
      waiting.state.completedBy === null &&
      complete.state.phase === "complete" &&
      complete.state.startedBy === FIRST_RUN &&
      complete.state.completedBy !== FIRST_RUN,
    "Inconsistent continuity history",
  );
  const start = runs.filter((run) => run.id === FIRST_RUN);
  const finish = runs.filter((run) => run.id === complete.state.completedBy);
  assert(start.length === 1 && finish.length === 1, "Unique origin and recovery runs required");
  for (const run of [start[0], finish[0]]) {
    assert(
      run.status === "completed" &&
        run.conclusion === "success" &&
        run.repository?.full_name === REPOSITORY &&
        run.path === ".github/workflows/continuity-lab-315.yml" &&
        /^[a-f0-9]{40}$/.test(run.head_sha ?? ""),
      "Unsuccessful or unrelated workflow run",
    );
  }
  assert(
    start[0].event === "workflow_dispatch" && finish[0].event === "schedule",
    "Recovery must be a distinct schedule run",
  );
  return {
    taskId: `continuity-315-${FIRST_RUN}`,
    startedBy: FIRST_RUN,
    completedBy: finish[0].id,
    startSha: start[0].head_sha,
    recoverySha: finish[0].head_sha,
    commentIds: states.map((entry) => entry.id),
  };
}

export function reserveContinued(repo, registry, task, evidence) {
  const continuity = verifyContinuity(evidence.comments, evidence.runs);
  assert(
    (task.id === continuity.taskId || task.id === LAUNCHER_TASK) &&
      task.authorization === `https://github.com/${REPOSITORY}/issues/318`,
    "Task must bind #315 identity to #318 authorization",
  );
  return reserve(repo, registry, { ...task, continuity }, task.id);
}

// Allowlist deliberately excludes GitHub, Supabase and model API keys.
export function executorEnvironment(source) {
  const permitted = [
    "PATH",
    "HOME",
    "CODEX_HOME",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
    "no_proxy",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
    "REQUESTS_CA_BUNDLE",
  ];
  return Object.fromEntries(
    permitted.filter((key) => source[key] !== undefined).map((key) => [key, source[key]]),
  );
}

function context(repo, registry, id) {
  assert(/^[a-z0-9][a-z0-9-]{2,79}$/.test(id ?? ""), "Invalid task ID");
  const relative = path.relative(path.resolve(repo), path.resolve(registry));
  assert(
    relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
    "Registry must be outside checkout",
  );
  const dir = path.join(registry, id);
  const reservation = read(path.join(dir, "reservation.json"));
  assert(
    reservation.task.id === id &&
      reservation.contractSha256 === hash(JSON.stringify(reservation.task)),
    "Reservation identity or contract changed",
  );
  assert(
    (id === `continuity-315-${FIRST_RUN}` || id === LAUNCHER_TASK) &&
      reservation.task.authorization === `https://github.com/${REPOSITORY}/issues/318` &&
      reservation.task.continuity?.taskId === `continuity-315-${FIRST_RUN}`,
    "Verified continuity reservation required",
  );
  assert(read(path.join(registry, "active.json")).id === id, "Another task owns the registry");
  assert(
    !fs.existsSync(path.join(dir, "publication.json")) &&
      !fs.existsSync(path.join(dir, "published.json")),
    "Publication already started",
  );
  const head = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" });
  assert(
    head.status === 0 && head.stdout.trim() === reservation.task.baseSha,
    "Authorized base changed",
  );
  return { dir, ...reservation };
}

function atomicWrite(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(value) + "\n");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temporary, filename);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

export function executionStatus(repo, registry, id) {
  const state = context(repo, registry, id);
  const executionDir = path.join(state.dir, "executor");
  assert(fs.statSync(executionDir).isDirectory(), "Execution directory required");
  const intentPath = path.join(executionDir, "intent.json");
  if (!fs.existsSync(intentPath))
    return { id, status: "uncertain", action: "inspect-existing-candidate" };
  const intent = read(intentPath);
  assert(
    intent.id === id && intent.contractSha256 === state.contractSha256,
    "Execution identity changed",
  );
  const resultPath = path.join(state.dir, "executor", "result.json");
  if (!fs.existsSync(resultPath))
    return { id, status: "uncertain", action: "inspect-existing-candidate" };
  const result = read(resultPath);
  assert(
    result.id === id && result.contractSha256 === state.contractSha256,
    "Result identity changed",
  );
  return result;
}

export function executeOnce(repo, registry, id, { binary = "codex", timeout = 120000 } = {}) {
  const state = context(repo, registry, id);
  const executionDir = path.join(state.dir, "executor");
  if (!fs.existsSync(executionDir)) {
    const clean = spawnSync("git", ["-C", repo, "status", "--porcelain", "--untracked-files=all"], {
      encoding: "utf8",
    });
    assert(
      clean.status === 0 && clean.stdout.trim() === "",
      "Generation must start with a clean candidate",
    );
    assert(
      !fs.existsSync(path.join(state.dir, "certificate.json")),
      "Candidate already entered certification",
    );
  }
  // Atomic exclusive directory consumes the generation attempt before spawning anything.
  // An empty directory after SIGKILL is uncertain too, never permission to regenerate.
  try {
    fs.mkdirSync(executionDir);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    return executionStatus(repo, registry, id);
  }
  const intent = {
    id,
    contractSha256: state.contractSha256,
    baseSha: state.task.baseSha,
    continuity: state.task.continuity,
    startedAt: new Date().toISOString(),
    mode: "supervised-cli",
  };
  atomicWrite(path.join(executionDir, "intent.json"), intent);
  const stdout = fs.openSync(path.join(executionDir, "events.jsonl"), "wx", 0o600);
  const stderr = fs.openSync(path.join(executionDir, "stderr.log"), "wx", 0o600);
  const prompt = `Implement only this authorized task. Do not commit, publish, use services, read credentials or change tests outside scope.\n${JSON.stringify(state.task)}\nAllowed files are exact. Report the result; the supervisor certifies independently.`;
  let result;
  try {
    result = spawnSync(
      binary,
      [
        "exec",
        "--ignore-user-config",
        "--sandbox",
        "workspace-write",
        "-c",
        'shell_environment_policy.inherit="none"',
        "--json",
        "-",
      ],
      {
        cwd: repo,
        env: executorEnvironment(process.env),
        input: prompt,
        stdio: ["pipe", stdout, stderr],
        timeout,
        killSignal: "SIGKILL",
      },
    );
  } finally {
    fs.closeSync(stdout);
    fs.closeSync(stderr);
  }
  const logPath = path.join(executionDir, "events.jsonl");
  assert(fs.statSync(logPath).size <= 8 * 1024 * 1024, "Oversized event log; inspect manually");
  const events = fs
    .readFileSync(logPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { type: "invalid" };
      }
    });
  const completed = events.some((event) => event.type === "turn.completed");
  const failed = events.some((event) => ["turn.failed", "error", "invalid"].includes(event.type));
  const record = {
    id,
    contractSha256: state.contractSha256,
    status: result.status === 0 && completed && !failed ? "candidate-ready" : "blocked",
    exitCode: result.status,
    signal: result.signal,
    errorCode: result.error?.code ?? null,
    sessionId: events.find((event) => event.type === "thread.started")?.thread_id ?? null,
    eventSha256: hash(fs.readFileSync(logPath)),
    finishedAt: new Date().toISOString(),
    action: "inspect-and-certify-existing-candidate",
    mode: "supervised-cli",
  };
  atomicWrite(path.join(executionDir, "result.json"), record);
  return record;
}

// Remote reads stay in the supervisor; the child receives no publication token.
export function collectContinuity(request) {
  const gh =
    request ??
    ((...args) => {
      const r = spawnSync("gh", ["api", ...args], {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
      });
      assert(r.status === 0, "GitHub lookup failed; never interpret failure as empty state");
      return JSON.parse(r.stdout);
    });
  const comments = [];
  for (let page = 1; ; page++) {
    assert(page <= 100, "Comment pagination bound exceeded");
    const batch = gh(`repos/${REPOSITORY}/issues/315/comments?per_page=100&page=${page}`);
    assert(Array.isArray(batch), "Invalid comments response");
    comments.push(...batch);
    if (batch.length < 100) break;
  }
  const records = comments
    .filter(isTrustedStateComment)
    .map((c) => parseState(c.body))
    .filter(Boolean);
  const ids = [...new Set([FIRST_RUN, ...records.map((s) => s.completedBy).filter(Boolean)])];
  const runs = ids.map((id) => gh(`repos/${REPOSITORY}/actions/runs/${id}`));
  return { comments, runs };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, repo, registry, input] = process.argv.slice(2);
    let result;
    if (command === "verify-continuity") {
      const evidence = collectContinuity();
      result = verifyContinuity(evidence.comments, evidence.runs);
    } else if (command === "reserve")
      result = reserveContinued(repo, registry, read(input), collectContinuity());
    else if (command === "execute") result = executeOnce(repo, registry, input);
    else if (command === "status") result = executionStatus(repo, registry, input);
    else
      throw new Error(
        "Usage: verify-continuity | reserve|execute|status REPO REGISTRY TASK_FILE_OR_ID",
      );
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
