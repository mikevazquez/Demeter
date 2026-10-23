// Observes only a process launched by this supervisor. It never discovers chats or reads auth.
import { spawn } from "node:child_process";
import fs from "node:fs/promises";

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_EVENT_BYTES = 1024 * 1024;
const OBSERVER_TIMEOUT_MS = 2000;
const TERM_GRACE_MS = 250;
const KILL_GRACE_MS = 750;
const CLOSE_GRACE_MS = 250;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function check(value, message) {
  if (!value) throw new TypeError(message);
}

// registeredSessionId must come from the caller's durable, authorized task registry.
// This function validates syntax; it cannot establish the provenance of an arbitrary ID.
export function buildCodexCommand({ binary = "codex", registeredSessionId } = {}) {
  check(
    typeof binary === "string" && binary.length > 0 && !binary.includes("\0"),
    "Invalid binary",
  );
  check(
    registeredSessionId === undefined ||
      (typeof registeredSessionId === "string" && SESSION_ID.test(registeredSessionId)),
    "A registered Codex session UUID is required for resume",
  );
  const args = ["exec", "--json", "--sandbox", "workspace-write"];
  if (registeredSessionId !== undefined) args.push("resume", registeredSessionId);
  args.push("-");
  return { command: binary, args };
}

function runtimeEnvironment() {
  const keys = [
    "PATH",
    "HOME",
    "CODEX_HOME",
    "TMPDIR",
    "LANG",
    "LC_ALL",
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
  ];
  return Object.fromEntries(
    keys.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]),
  );
}

// No classification based on assistant prose, command output, stderr, or an error message.
function failureClass(error) {
  if (!error || typeof error !== "object") return "worker_error";
  const info = error.codexErrorInfo ?? error.code ?? error.type;
  let code = typeof info === "string" ? info : info?.type;
  let http = info?.httpStatusCode ?? error.httpStatusCode;
  if (info && typeof info === "object" && !code) {
    const variant = Object.keys(info).find((key) => key !== "httpStatusCode");
    code = variant;
    http ??= info[variant]?.httpStatusCode;
  }
  const normalized = typeof code === "string" ? code.replace(/[^a-z]/gi, "").toLowerCase() : "";
  if (
    ["usagelimitexceeded", "ratelimitexceeded", "ratelimiterror"].includes(normalized) ||
    http === 429
  )
    return "capacity";
  if (
    ["unauthorized", "authenticationerror", "permissionerror"].includes(normalized) ||
    http === 401 ||
    http === 403
  )
    return "authentication";
  return "worker_error";
}

async function bounded(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("Operation deadline exceeded")), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// Only the detached process group created by spawn() is signalled. On Linux, zombies
// cannot execute or write, but can keep kill(-pgid, 0) succeeding until their reaper runs.
// Escaped/daemonized descendants require runner/container isolation; a POSIX group alone
// is not containment for a worker that deliberately creates a different session/group.
async function groupState(pgid) {
  try {
    process.kill(-pgid, 0);
  } catch (error) {
    return error.code === "ESRCH" ? "closed" : "unknown";
  }
  if (process.platform !== "linux") return "alive";
  let members = 0;
  let inaccessible = false;
  try {
    const entries = await fs.readdir("/proc");
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      let stat;
      try {
        stat = await fs.readFile(`/proc/${entry}/stat`, "utf8");
      } catch (error) {
        if (error.code !== "ENOENT" && error.code !== "ESRCH") inaccessible = true;
        continue;
      }
      const fields = stat
        .slice(stat.lastIndexOf(")") + 1)
        .trim()
        .split(/\s+/);
      if (Number(fields[2]) !== pgid) continue;
      members++;
      if (fields[0] !== "Z" && fields[0] !== "X") return "alive";
    }
    if (members > 0 && !inaccessible) return "closed";
  } catch {
    return "unknown";
  }
  try {
    process.kill(-pgid, 0);
    return "unknown";
  } catch (error) {
    return error.code === "ESRCH" ? "closed" : "unknown";
  }
}

async function closeGroup(pgid) {
  let state = await groupState(pgid);
  if (state === "closed") return true;
  for (const [signal, grace] of [
    ["SIGTERM", TERM_GRACE_MS],
    ["SIGKILL", KILL_GRACE_MS],
  ]) {
    try {
      process.kill(-pgid, signal);
    } catch (error) {
      if (error.code === "ESRCH") return true;
      return false;
    }
    const deadline = Date.now() + grace;
    do {
      state = await groupState(pgid);
      if (state === "closed") return true;
      await delay(25);
    } while (Date.now() < deadline);
  }
  return false;
}

/**
 * Run one owned POSIX process and reduce its Codex-compatible JSONL events.
 * onActivity receives sanitized metadata, including periodic supervisor heartbeats.
 * last_activity_at changes only on a recognized worker event, never a heartbeat.
 * observerTimeoutMs bounds each observer (default 2s, configurable through 60s for
 * remote durable storage); timeout still fails closed and shuts down the owned group.
 * onCheckpoint runs once after shutdown and observer drainage; its return value is a
 * caller-owned JSON checkpoint, not a model output or a verified-completion certificate.
 * No stdout, stderr, prompt, command string, environment, or callback error text is returned.
 */
export async function runManagedWorker({
  command,
  args = [],
  cwd,
  input = "",
  onActivity,
  onCheckpoint,
  signal,
  timeoutMs = 120000,
  observerTimeoutMs = OBSERVER_TIMEOUT_MS,
  now = () => new Date(),
  env,
} = {}) {
  check(
    typeof command === "string" && command.length > 0 && !command.includes("\0"),
    "Invalid command",
  );
  check(
    Array.isArray(args) && args.every((arg) => typeof arg === "string" && !arg.includes("\0")),
    "Invalid arguments",
  );
  check(
    typeof cwd === "string" && cwd.length > 0 && !cwd.includes("\0"),
    "A working directory is required",
  );
  check(typeof input === "string" || Buffer.isBuffer(input), "Invalid worker input");
  check(
    Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 86400000,
    "Invalid timeout",
  );
  check(
    Number.isSafeInteger(observerTimeoutMs) && observerTimeoutMs > 0 && observerTimeoutMs <= 60000,
    "Invalid observer timeout",
  );
  check(typeof now === "function", "Invalid clock");
  check(onActivity === undefined || typeof onActivity === "function", "Invalid activity observer");
  check(
    onCheckpoint === undefined || typeof onCheckpoint === "function",
    "Invalid checkpoint observer",
  );
  check(
    signal === undefined ||
      (typeof signal.aborted === "boolean" && typeof signal.addEventListener === "function"),
    "Invalid abort signal",
  );
  check(
    env === undefined ||
      (env !== null &&
        typeof env === "object" &&
        !Array.isArray(env) &&
        Object.values(env).every((value) => typeof value === "string")),
    "Invalid worker environment",
  );
  const firstTime = new Date(now()).toISOString();
  const empty = {
    status: "unknown",
    terminal_observed: false,
    process_group_closed: true,
    exit_code: null,
    signal: null,
    session_id: null,
    failure_class: null,
    last_activity_at: null,
  };
  if (signal?.aborted) return { ...empty, status: "interrupted", failure_class: "cancelled" };
  if (process.platform === "win32")
    return { ...empty, status: "failed", failure_class: "unsupported_platform" };

  let sessionId = null;
  let lastActivity = null;
  let latestTime = firstTime;
  let terminal = null;
  let workerFailure = "worker_error";
  let stopReason = null;
  let observerFailed = false;
  let protocolFailed = false;
  let spawnFailed = false;
  let parentClosed = false;
  let exitCode = null;
  let exitSignal = null;
  let stdoutBuffer = "";
  let observerChain = Promise.resolve();
  let pendingObservers = 0;
  let resolveStop;
  let resolveExit;
  let resolveClose;
  const stopRequested = new Promise((resolve) => {
    resolveStop = resolve;
  });
  const exited = new Promise((resolve) => {
    resolveExit = resolve;
  });
  const closed = new Promise((resolve) => {
    resolveClose = resolve;
  });
  function stop(reason) {
    stopReason ??= reason;
    resolveStop();
  }
  function stamp() {
    try {
      latestTime = new Date(now()).toISOString();
    } catch {
      observerFailed = true;
      stop("observer_error");
    }
    return latestTime;
  }
  function metadata(type) {
    return {
      type,
      at: stamp(),
      session_id: sessionId,
      terminal_observed: terminal !== null,
      phase: stopReason ? "stopping" : terminal ? "finishing" : sessionId ? "running" : "starting",
    };
  }
  function observe(type) {
    if (!onActivity || observerFailed) return;
    if (++pendingObservers > 256) {
      observerFailed = true;
      stop("observer_error");
      return;
    }
    const event = metadata(type);
    observerChain = observerChain.then(async () => {
      if (observerFailed) return;
      try {
        await bounded(
          Promise.resolve().then(() => onActivity(event)),
          observerTimeoutMs,
        );
      } catch {
        observerFailed = true;
        stop("observer_error");
      } finally {
        pendingObservers--;
      }
    });
  }
  function invalidProtocol() {
    protocolFailed = true;
    stop("protocol_error");
  }
  function parseLine(line) {
    if (!line.trim() || protocolFailed) return;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      invalidProtocol();
      return;
    }
    if (
      !event ||
      typeof event !== "object" ||
      Array.isArray(event) ||
      typeof event.type !== "string"
    ) {
      invalidProtocol();
      return;
    }
    const recognized = [
      "thread.started",
      "turn.started",
      "turn.completed",
      "turn.failed",
      "item.started",
      "item.updated",
      "item.completed",
      "error",
    ].includes(event.type);
    if (!recognized) return;
    if (event.type === "thread.started") {
      if (
        typeof event.thread_id !== "string" ||
        !SESSION_ID.test(event.thread_id) ||
        (sessionId !== null && event.thread_id !== sessionId)
      ) {
        invalidProtocol();
        return;
      }
      sessionId = event.thread_id;
    }
    if (event.type === "turn.completed" || event.type === "turn.failed") {
      if (terminal !== null) {
        invalidProtocol();
        return;
      }
      terminal = event.type === "turn.completed" ? "completed" : "failed";
      if (terminal === "failed") workerFailure = failureClass(event.error);
    }
    lastActivity = stamp();
    observe(event.type);
  }
  function consume(chunk) {
    stdoutBuffer += chunk;
    let newline;
    while ((newline = stdoutBuffer.indexOf("\n")) !== -1) {
      const line = stdoutBuffer.slice(0, newline);
      stdoutBuffer = stdoutBuffer.slice(newline + 1);
      if (Buffer.byteLength(line) > MAX_EVENT_BYTES) invalidProtocol();
      else parseLine(line);
    }
    if (Buffer.byteLength(stdoutBuffer) > MAX_EVENT_BYTES) {
      stdoutBuffer = "";
      invalidProtocol();
    }
  }

  let child;
  try {
    child = spawn(command, args, {
      cwd,
      env: env ?? runtimeEnvironment(),
      shell: false,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    return { ...empty, status: "failed", failure_class: "spawn_error" };
  }
  child.on("spawn", () => observe("process.started"));
  child.on("error", () => {
    spawnFailed = !child.pid;
    stop(spawnFailed ? "spawn_error" : "process_error");
    resolveExit();
  });
  child.on("exit", (code, emittedSignal) => {
    exitCode = Number.isInteger(code) ? code : null;
    exitSignal = emittedSignal ?? null;
    resolveExit();
  });
  child.on("close", (code, emittedSignal) => {
    parentClosed = true;
    exitCode = Number.isInteger(code) ? code : exitCode;
    exitSignal = emittedSignal ?? exitSignal;
    resolveExit();
    resolveClose();
  });
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", consume);
  child.stdout.on("end", () => {
    if (stdoutBuffer) parseLine(stdoutBuffer);
    stdoutBuffer = "";
  });
  child.stdout.on("error", () => stop("process_error"));
  // Drain without storing or classifying stderr: it can contain secrets and tool output.
  child.stderr.resume();
  child.stderr.on("error", () => stop("process_error"));
  child.stdin.on("error", (error) => {
    if (error.code !== "EPIPE") stop("process_error");
  });
  const onAbort = () => stop("cancelled");
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  const timeout = setTimeout(() => stop("timeout"), timeoutMs);
  const heartbeat = setInterval(
    () => observe("heartbeat"),
    Math.max(25, Math.min(1000, Math.floor(timeoutMs / 4))),
  );
  let groupClosed = false;
  let forcedPipeClose = false;
  try {
    child.stdin.end(input);
    await Promise.race([exited, stopRequested]);
    groupClosed = child.pid ? await closeGroup(child.pid) : true;
    try {
      await bounded(closed, CLOSE_GRACE_MS);
    } catch {
      // An inherited pipe still open outside the group is not evidence of containment.
      forcedPipeClose = true;
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
    }
  } finally {
    clearTimeout(timeout);
    clearInterval(heartbeat);
    signal?.removeEventListener("abort", onAbort);
  }
  await observerChain;
  const result = {
    ...empty,
    terminal_observed: terminal !== null,
    process_group_closed: groupClosed && parentClosed && !forcedPipeClose,
    exit_code: exitCode,
    signal: exitSignal,
    session_id: sessionId,
    last_activity_at: lastActivity,
  };
  if (spawnFailed) {
    result.status = "failed";
    result.failure_class = "spawn_error";
  } else if (observerFailed) {
    result.failure_class = "observer_error";
  } else if (!result.process_group_closed) {
    result.failure_class = "process_group_unconfirmed";
  } else if (stopReason === "cancelled" || stopReason === "timeout") {
    result.status = "interrupted";
    result.failure_class = stopReason;
  } else if (protocolFailed || stopReason) {
    result.failure_class = protocolFailed ? "protocol_error" : stopReason;
  } else if (terminal === "completed" && exitCode === 0 && !exitSignal) {
    result.status = "completed";
  } else if (terminal === "failed") {
    result.status = "failed";
    result.failure_class = workerFailure;
  } else if (terminal === "completed") {
    result.failure_class = "exit_mismatch";
  } else if (exitSignal) {
    result.status = "interrupted";
    result.failure_class = "process_signal";
  } else {
    result.failure_class = "missing_terminal";
  }
  if (onCheckpoint) {
    try {
      const checkpoint = await bounded(
        Promise.resolve().then(() => onCheckpoint({ ...result })),
        observerTimeoutMs,
      );
      if (checkpoint !== undefined) {
        const serialized = JSON.stringify(checkpoint);
        check(typeof serialized === "string" && serialized.length <= 65536, "Invalid checkpoint");
        result.checkpoint = JSON.parse(serialized);
      }
    } catch {
      result.status = "unknown";
      result.failure_class = "observer_error";
    }
  }
  return result;
}
