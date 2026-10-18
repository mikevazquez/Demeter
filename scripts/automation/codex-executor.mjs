// Trusted supervisor adapter. Reuses #314's registry; never publishes or starts a service.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { reserve, publicationPlan, complete } from "../studio-flow-minimal.mjs";
import {
  claimExecution,
  verifyExecutionOwner,
  claimPublication,
  githubRequest,
} from "./execution-claim.mjs";
import { writeExecutionCheckpoint, readExecutionCheckpoint } from "./execution-checkpoint.mjs";
import {
  captureExecutionResult,
  writeExecutionResult,
  restoreExecution,
  readExecutionResult,
  verifyResultCertificate,
} from "./execution-result.mjs";
import { isTrustedStateComment, parseState } from "./continuity-lab.mjs";

const assert = (value, message) => {
  if (!value) throw new Error(message);
};
const read = (filename) => JSON.parse(fs.readFileSync(filename, "utf8"));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const FIRST_RUN = 38989415241;
const REPOSITORY = "mikevazquez/Demeter";
const LAUNCHER_TASK = "vianelis-launcher-318-v1";
const OWNED_CODE_TASK = "governance2-owned-code-318-v1";
const RESULT_RECOVERY_TASK = "governance2-result-recovery-318-v1";

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
    (task.id === continuity.taskId ||
      task.id === LAUNCHER_TASK ||
      task.id === OWNED_CODE_TASK ||
      task.id === RESULT_RECOVERY_TASK) &&
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
    (id === `continuity-315-${FIRST_RUN}` ||
      id === LAUNCHER_TASK ||
      id === OWNED_CODE_TASK ||
      id === RESULT_RECOVERY_TASK) &&
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

export function executeOnce(
  repo,
  registry,
  id,
  {
    binary = "codex",
    timeout = 120000,
    claim = claimExecution,
    checkpoint = writeExecutionCheckpoint,
    seal = writeExecutionResult,
    prepareCandidate,
  } = {},
) {
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
  const remoteClaim = claim({
    id,
    baseSha: state.task.baseSha,
    contractSha256: state.contractSha256,
    authorization: state.task.authorization,
  });
  assert(remoteClaim?.status === "acquired", "Task consumed remotely; inspect original execution");
  atomicWrite(path.join(executionDir, "remote-claim.json"), remoteClaim);
  const recovery = checkpoint(state, remoteClaim, intent);
  assert(recovery?.status === "recorded", "Durable checkpoint required before generation");
  atomicWrite(path.join(executionDir, "checkpoint.json"), recovery);
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
  if (record.status !== "candidate-ready") {
    atomicWrite(path.join(executionDir, "result.json"), record);
    return record;
  }
  atomicWrite(path.join(executionDir, "model-result.json"), record);
  return sealExistingResult(repo, registry, id, { seal, prepareCandidate });
}

// Retrying durability never invokes the model. The frozen artifact intent cannot drift.
export function sealExistingResult(
  repo,
  registry,
  id,
  { seal = writeExecutionResult, prepareCandidate } = {},
) {
  const state = context(repo, registry, id),
    dir = path.join(state.dir, "executor");
  const model = read(path.join(dir, "model-result.json"));
  assert(model.status === "candidate-ready", "Successful existing model result required");
  const filename = path.join(dir, "artifact-intent.json");
  if (!fs.existsSync(filename) && prepareCandidate) {
    // Reject changes outside the contract before invoking any trusted preparation tool.
    captureExecutionResult(repo, state, read(path.join(dir, "intent.json")), model);
    prepareCandidate(repo, state.task);
  }
  const bundle = fs.existsSync(filename)
    ? read(filename)
    : captureExecutionResult(repo, state, read(path.join(dir, "intent.json")), model);
  if (!fs.existsSync(filename)) atomicWrite(filename, bundle);
  assert(
    hash(fs.readFileSync(path.join(dir, "events.jsonl"))) === model.eventSha256,
    "Original model event bytes changed; do not seal",
  );
  const current = captureExecutionResult(repo, state, read(path.join(dir, "intent.json")), model);
  assert(
    JSON.stringify(current) === JSON.stringify(bundle),
    "Candidate changed after result intent; do not reseal",
  );
  let durableResult;
  try {
    durableResult = seal(bundle);
    assert(durableResult?.status === "recorded", "Durable model result required");
  } catch (error) {
    const blocked = {
      ...model,
      status: "uncertain",
      errorCode: "DURABILITY_PENDING",
      action: "seal-existing-result-only",
    };
    atomicWrite(path.join(dir, "result.json"), blocked);
    throw error;
  }
  const record = { ...model, durableResult };
  atomicWrite(path.join(dir, "result.json"), record);
  return record;
}

// Existing #314 owns local certification/intent/receipt; this adapter guards the remote write.
export function publishDraftOnce(
  repo,
  registry,
  id,
  metadata,
  { request = githubRequest, nonce = randomUUID() } = {},
) {
  assert(
    !fs.existsSync(path.join(registry, "verification-only.json")),
    "Verification registry cannot publish",
  );
  assert(/^[a-z0-9][a-z0-9-]{2,79}$/.test(id ?? ""), "Invalid publication task ID");
  const relative = path.relative(path.resolve(repo), path.resolve(registry));
  assert(
    relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
    "Registry must be outside checkout",
  );
  const dir = path.join(registry, id);
  const state = read(path.join(dir, "reservation.json"));
  assert(
    state.task.id === id && state.contractSha256 === hash(JSON.stringify(state.task)),
    "Publication reservation changed",
  );
  assert(
    typeof metadata?.baseBranch === "string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9_./-]{0,199}$/.test(metadata.baseBranch) &&
      !metadata.baseBranch.split("/").some((x) => !x || x === "." || x === ".."),
    "Reviewed publication base branch required",
  );
  assert(
    typeof metadata.title === "string" &&
      metadata.title.trim().length > 0 &&
      metadata.title.length <= 256 &&
      typeof metadata.body === "string" &&
      metadata.body.length <= 60000,
    "Reviewed publication title and body required",
  );
  const task = {
    id,
    baseSha: state.task.baseSha,
    contractSha256: state.contractSha256,
    authorization: state.task.authorization,
  };
  const owner = read(path.join(dir, "executor", "remote-claim.json"));
  const options = { request };
  verifyExecutionOwner(task, owner, options);
  const branch = `studio-flow/minimal/${id}`;
  const api = `repos/${REPOSITORY}`;
  const snapshot = () => {
    const base = request("GET", `${api}/git/ref/heads/${metadata.baseBranch}`);
    assert(base?.object?.sha === task.baseSha, "Remote target changed from authorized base");
    const head = request("GET", `${api}/git/ref/heads/${branch}`);
    assert(
      /^[a-f0-9]{40}$/.test(head?.object?.sha ?? ""),
      "Existing remote candidate branch required",
    );
    const prs = [];
    const filter = encodeURIComponent(`mikevazquez:${branch}`);
    for (let page = 1; ; page++) {
      assert(page <= 100, "Publication PR pagination limit exceeded");
      const batch = request(
        "GET",
        `${api}/pulls?state=all&head=${filter}&per_page=100&page=${page}`,
      );
      assert(Array.isArray(batch), "Complete publication PR lookup required");
      prs.push(...batch);
      if (batch.length < 100) break;
    }
    assert(prs.length <= 1, "Multiple remote PRs; do not create another");
    const pullRequests = prs.map((p) => {
      assert(
        p.head?.ref === branch &&
          p.head?.repo?.full_name === REPOSITORY &&
          p.base?.ref === metadata.baseBranch &&
          p.base?.repo?.full_name === REPOSITORY,
        "Unrelated remote PR",
      );
      return {
        branch,
        commitSha: p.head.sha,
        draft: p.draft,
        url: p.html_url,
        state: p.state?.toUpperCase(),
      };
    });
    return { branch, baseSha: task.baseSha, headSha: head.object.sha, pullRequests };
  };
  const verifyRemote = (remote) => {
    const certificate = read(path.join(dir, "certificate.json"));
    assert(
      certificate.passed &&
        certificate.contractSha256 === task.contractSha256 &&
        certificate.baseSha === task.baseSha,
      "Matching publication certificate required",
    );
    if (
      id === RESULT_RECOVERY_TASK ||
      fs.existsSync(path.join(dir, "executor", "model-result.json"))
    ) {
      verifyResultCertificate(certificate, readExecutionResult(id, task, { request }));
    }
    const commit = request("GET", `${api}/git/commits/${remote.headSha}`);
    assert(
      commit?.sha === remote.headSha &&
        commit.parents?.length === 1 &&
        commit.parents[0].sha === task.baseSha,
      "Remote candidate parent mismatch",
    );
    const comparison = request("GET", `${api}/compare/${task.baseSha}...${remote.headSha}`);
    assert(
      Array.isArray(comparison?.files) &&
        JSON.stringify(comparison.files.map((f) => f.filename).sort()) ===
          JSON.stringify(certificate.files.map((f) => f.path).sort()),
      "Remote changed paths differ from certificate",
    );
    const tree = request("GET", `${api}/git/trees/${commit.tree.sha}?recursive=1`);
    assert(tree?.truncated === false && Array.isArray(tree.tree), "Complete remote tree required");
    for (const file of certificate.files) {
      const entry = tree.tree.find((e) => e.path === file.path);
      if (file.deleted) {
        assert(!entry, "Remote deletion mismatch");
        continue;
      }
      assert(entry?.type === "blob" && entry.mode === file.mode, "Remote file mode mismatch");
      const blob = request("GET", `${api}/git/blobs/${entry.sha}`);
      assert(
        blob?.encoding === "base64" &&
          typeof blob.content === "string" &&
          hash(Buffer.from(blob.content, "base64")) === file.sha256,
        "Remote file bytes mismatch",
      );
    }
  };
  const finish = (remote) => {
    assert(remote.pullRequests.length === 1, "Draft not observed; never repeat creation");
    const receipt = remote.pullRequests[0];
    assert(
      receipt.state === "OPEN" && receipt.draft === true && receipt.commitSha === remote.headSha,
      "Matching open Draft required",
    );
    return complete(repo, registry, id, receipt);
  };
  let remote = snapshot();
  verifyRemote(remote);
  if (fs.existsSync(path.join(dir, "published.json"))) return finish(remote);
  const plan = publicationPlan(repo, registry, id, remote);
  if (plan.action === "reuse-draft") return finish(remote);
  const digest = hash(
    JSON.stringify({
      id,
      baseSha: task.baseSha,
      headSha: remote.headSha,
      files: plan.files,
      baseBranch: metadata.baseBranch,
    }),
  );
  const claim = claimPublication(task, owner, digest, { request, nonce });
  if (claim.status !== "acquired")
    return { id, status: "blocked-publication", action: "reconcile-existing-attempt" };
  atomicWrite(path.join(dir, "publication-claim.json"), claim);
  // Fresh owner and state immediately before the only create call. No adoption/transfer.
  verifyExecutionOwner(task, owner, options);
  const current = snapshot();
  assert(current.headSha === remote.headSha, "Remote candidate changed after publication claim");
  if (current.pullRequests.length) {
    publicationPlan(repo, registry, id, current);
    return finish(current);
  }
  atomicWrite(path.join(dir, "publication-attempt.json"), {
    id,
    headSha: remote.headSha,
    claimObjectSha: claim.objectSha,
    metadataSha256: hash(JSON.stringify(metadata)),
    startedAt: new Date().toISOString(),
  });
  try {
    request("POST", `${api}/pulls`, {
      base: metadata.baseBranch,
      head: branch,
      title: metadata.title,
      body: metadata.body,
      draft: true,
    });
  } catch (error) {
    // Even a timeout after GitHub accepts the request must never cause another POST.
    throw new Error("Draft creation uncertain; recover by remote reconciliation only", {
      cause: error,
    });
  }
  remote = snapshot();
  assert(remote.headSha === current.headSha, "Remote candidate changed during creation");
  verifyRemote(remote);
  publicationPlan(repo, registry, id, remote);
  return finish(remote);
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
    const [command, repo, registry, input, metadata] = process.argv.slice(2);
    let result;
    if (command === "verify-continuity") {
      const evidence = collectContinuity();
      result = verifyContinuity(evidence.comments, evidence.runs);
    } else if (command === "recover-remote")
      result = readExecutionCheckpoint(repo, { baseSha: registry, contractSha256: input });
    else if (command === "reserve")
      result = reserveContinued(repo, registry, read(input), collectContinuity());
    else if (command === "restore-result")
      result = restoreExecution(repo, registry, input, read(metadata));
    else if (command === "seal-result") result = sealExistingResult(repo, registry, input);
    else if (command === "execute") result = executeOnce(repo, registry, input);
    else if (command === "status") result = executionStatus(repo, registry, input);
    else if (command === "publish-draft")
      result = publishDraftOnce(repo, registry, input, read(metadata));
    else
      throw new Error(
        "Usage: verify-continuity | restore-result REPO REGISTRY ID EXPECTED_JSON | seal-result REPO REGISTRY ID | recover-remote ID BASE_SHA CONTRACT_SHA256 | reserve|execute|status REPO REGISTRY TASK_FILE_OR_ID | publish-draft REPO REGISTRY ID METADATA_JSON",
      );
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
