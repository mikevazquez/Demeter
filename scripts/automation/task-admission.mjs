// Trusted supervisor inputs only. This module never starts a model or writes registry state.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const REPOSITORY = "mikevazquez/Demeter";
const AUTHORIZATION = `https://github.com/${REPOSITORY}/issues/318`;
const SCHEMA = "governance2-task-catalog-v1";
const PROOF = "governance2-task-admission-v1";
const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const digest = (value) => hash(JSON.stringify(value));
const exact = (value, keys) =>
  value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).sort().join() === keys.slice().sort().join();
const sha256 = (value) => /^[a-f0-9]{64}$/.test(value ?? "");
const protectedPaths = new Set([
  "package.json",
  "package-lock.json",
  "AGENTS.md",
  "scripts/studio-flow-minimal.mjs",
  "scripts/automation/task-admission.mjs",
  "scripts/automation/registry-authority.mjs",
  "scripts/automation/verify-registry-authority-ci.mjs",
  "scripts/automation/verify-receipt-proof.mjs",
  "scripts/automation/registry-migration.mjs",
  "docs/automation/registry-authority.md",
  "docs/automation/registry-authority-318.json",
  "scripts/automation/codex-executor.mjs",
  "scripts/automation/execution-claim.mjs",
  "scripts/automation/execution-checkpoint.mjs",
  "scripts/automation/execution-result.mjs",
  "scripts/automation/execution-terminal.mjs",
  "docs/automation/governance2-operation.md",
  "docs/automation/task-admission.md",
  "docs/automation/task-catalog.example.json",
  "scripts/automation/verify-result-recovery-ci.mjs",
  "scripts/automation/verify-recovery-proof.mjs",
  "scripts/automation/continuity-lab.mjs",
]);
function safePath(p) {
  return (
    typeof p === "string" &&
    /^[A-Za-z0-9_./-]+$/.test(p) &&
    !p.startsWith("/") &&
    !p.split("/").some((x) => ["", ".", "..", ".git", "node_modules"].includes(x))
  );
}
function allowedPath(p) {
  return (
    safePath(p) &&
    !protectedPaths.has(p) &&
    !p.startsWith(".github/") &&
    !p
      .split("/")
      .some(
        (x) =>
          x.startsWith(".env") ||
          [".npmrc", ".netrc", ".ssh", ".codex", ".config"].includes(x) ||
          x === "AGENTS.md" ||
          /^(auth|credentials|secrets)(\.|$)/i.test(x),
      )
  );
}
function argvOK(argv) {
  return (
    Array.isArray(argv) &&
    argv.length >= 2 &&
    argv.length <= 16 &&
    argv[0] === "node" &&
    typeof argv[1] === "string" &&
    /\.(mjs|cjs|js)$/.test(argv[1]) &&
    !argv[1].startsWith("/") &&
    !argv[1].split("/").some((x) => ["", ".", "..", ".git"].includes(x)) &&
    argv.every(
      (x) =>
        typeof x === "string" && x.length > 0 && x.length <= 300 && /^[A-Za-z0-9_./=-]+$/.test(x),
    )
  );
}
function core(task) {
  return {
    id: task.id,
    goal: task.goal,
    authorization: task.authorization,
    baseSha: task.baseSha,
    allowedPaths: task.allowedPaths.slice().sort(),
    checks: task.checks,
  };
}
function validateCore(task) {
  assert(
    task.authorization === AUTHORIZATION && /^[a-f0-9]{40}$/.test(task.baseSha ?? ""),
    "Admission authorization or immutable base invalid",
  );
  assert(
    typeof task.goal === "string" && task.goal.trim().length > 0 && task.goal.length <= 8000,
    "Admission goal invalid",
  );
  assert(
    Array.isArray(task.allowedPaths) &&
      task.allowedPaths.length > 0 &&
      task.allowedPaths.length <= 10 &&
      new Set(task.allowedPaths).size === task.allowedPaths.length &&
      task.allowedPaths.every(allowedPath),
    "Admission exact paths required; protected or unsafe path",
  );
  assert(
    Array.isArray(task.checks) &&
      task.checks.length > 0 &&
      task.checks.length <= 10 &&
      task.checks.every(argvOK),
    "Admission reviewed Node argv checks required",
  );
}
function validDeadline(value) {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}
function validateLimits(limits, task) {
  assert(
    exact(limits, ["provider", "maxModelInvocations", "timeoutMs", "maxFiles", "maxTotalBytes"]) &&
      limits.provider === "codex-cli-chatgpt" &&
      limits.maxModelInvocations === 1 &&
      Number.isSafeInteger(limits.timeoutMs) &&
      limits.timeoutMs >= 1000 &&
      limits.timeoutMs <= 240000 &&
      Number.isSafeInteger(limits.maxFiles) &&
      limits.maxFiles >= 1 &&
      limits.maxFiles <= task.allowedPaths.length &&
      Number.isSafeInteger(limits.maxTotalBytes) &&
      limits.maxTotalBytes >= 1 &&
      limits.maxTotalBytes <= 256 * 1024,
    "Admission execution limits invalid",
  );
}
function validateIndependent(checks, task) {
  assert(
    Array.isArray(checks) &&
      checks.length > 0 &&
      checks.length <= task.checks.length &&
      checks.every(
        (c) =>
          exact(c, ["argv", "sourceSha256"]) &&
          argvOK(c.argv) &&
          safePath(c.argv[1]) &&
          !task.allowedPaths.includes(c.argv[1]) &&
          sha256(c.sourceSha256) &&
          task.checks.some((argv) => JSON.stringify(argv) === JSON.stringify(c.argv)),
      ),
    "Independent acceptance must be pinned outside candidate scope",
  );
}
export function taskIdForWork(workKey) {
  assert(/^[a-z][a-z0-9-]{2,63}$/.test(workKey ?? ""), "Stable work key required");
  return `g2-${hash(`${REPOSITORY}:${workKey}`).slice(0, 40)}`;
}
function fingerprint(task) {
  const { id: ignored, ...rest } = core(task);
  void ignored;
  return digest(rest);
}
export function validateAdmissionProof(task) {
  validateCore(task);
  const proof = task.admission;
  assert(
    exact(proof, [
      "schema",
      "catalogSha256",
      "workKey",
      "taskSha256",
      "startBefore",
      "baseBranch",
      "limits",
      "independentChecks",
    ]) &&
      proof.schema === PROOF &&
      safePath(proof.baseBranch) &&
      sha256(proof.catalogSha256) &&
      proof.taskSha256 === digest(core(task)) &&
      task.id === taskIdForWork(proof.workKey) &&
      validDeadline(proof.startBefore),
    "Admission proof or stable identity invalid",
  );
  assert(
    Object.keys(task).every((k) =>
      ["id", "goal", "authorization", "baseSha", "allowedPaths", "checks", "admission"].includes(k),
    ),
    "Unexpected admitted task field",
  );
  validateCore(task);
  validateLimits(proof.limits, task);
  validateIndependent(proof.independentChecks, task);
  return proof;
}
function noLinks(filename) {
  for (let at = path.resolve(filename); ; at = path.dirname(at)) {
    const stat = fs.lstatSync(at);
    assert(!stat.isSymbolicLink(), "Catalog symlinks forbidden");
    if (at === path.dirname(at)) break;
  }
}
function readCatalog(repo, trustedCatalog) {
  assert(
    exact(trustedCatalog, ["path", "sha256"]) &&
      typeof trustedCatalog.path === "string" &&
      sha256(trustedCatalog.sha256),
    "Supervisor catalog path and trusted SHA256 required",
  );
  const relative = path.relative(path.resolve(repo), path.resolve(trustedCatalog.path));
  assert(
    relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative),
    "Trusted catalog must be outside candidate",
  );
  noLinks(trustedCatalog.path);
  const stat = fs.lstatSync(trustedCatalog.path);
  assert(
    stat.isFile() && stat.nlink === 1 && stat.size <= 1024 * 1024,
    "Unsafe or oversized catalog file",
  );
  const bytes = fs.readFileSync(trustedCatalog.path);
  assert(hash(bytes) === trustedCatalog.sha256, "Trusted catalog hash changed");
  let catalog;
  try {
    catalog = JSON.parse(bytes);
  } catch {
    throw new Error("Invalid catalog JSON");
  }
  assert(
    exact(catalog, ["schema", "repository", "authorization", "tasks"]) &&
      catalog.schema === SCHEMA &&
      catalog.repository === REPOSITORY &&
      catalog.authorization === AUTHORIZATION &&
      Array.isArray(catalog.tasks) &&
      catalog.tasks.length <= 100,
    "Reviewed catalog identity or schema invalid",
  );
  const ids = new Set(),
    prints = new Set();
  return catalog.tasks.map((entry) => {
    assert(
      exact(entry, [
        "workKey",
        "baseBranch",
        "goal",
        "baseSha",
        "allowedPaths",
        "checks",
        "independentChecks",
        "limits",
        "startBefore",
      ]),
      "Unexpected catalog entry field",
    );
    const task = {
      id: taskIdForWork(entry.workKey),
      goal: entry.goal,
      authorization: AUTHORIZATION,
      baseSha: entry.baseSha,
      allowedPaths: entry.allowedPaths,
      checks: entry.checks,
    };
    validateCore(task);
    assert(safePath(entry.baseBranch), "Reviewed target branch required");
    task.allowedPaths.sort();
    validateLimits(entry.limits, task);
    validateIndependent(entry.independentChecks, task);
    assert(validDeadline(entry.startBefore), "Admission start deadline required");
    assert(
      !ids.has(task.id) && !prints.has(fingerprint(task)),
      "Duplicate work identity or renamed duplicate contract",
    );
    ids.add(task.id);
    prints.add(fingerprint(task));
    task.admission = {
      schema: PROOF,
      catalogSha256: trustedCatalog.sha256,
      workKey: entry.workKey,
      taskSha256: digest(core(task)),
      startBefore: entry.startBefore,
      baseBranch: entry.baseBranch,
      limits: entry.limits,
      independentChecks: entry.independentChecks,
    };
    assert(
      Buffer.byteLength(JSON.stringify(task)) <= 24000,
      "Admission contract exceeds checkpoint budget",
    );
    return task;
  });
}
export function assertAdmissionWorkspace(repo) {
  const scan = spawnSync(
    "git",
    ["-C", repo, "ls-files", "--others", "--ignored", "--exclude-standard", "-z"],
    { maxBuffer: 1024 * 1024 },
  );
  assert(
    scan.status === 0 && scan.stdout.length === 0,
    "Admitted candidate must not contain ignored output or dependencies; certify separately",
  );
}

export function admitTask(repo, trustedCatalog, workKey) {
  const tasks = readCatalog(repo, trustedCatalog),
    task = tasks.find((t) => t.admission.workKey === workKey);
  assert(task, "Work item not in approved catalog");
  validateAdmissionProof(task);
  assertAdmissionWorkspace(repo);
  const head = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" });
  assert(
    head.status === 0 && head.stdout.trim() === task.baseSha,
    "Admission checkout base changed",
  );
  assert(Date.now() < Date.parse(task.admission.startBefore), "Admission start deadline expired");
  for (const check of task.admission.independentChecks) {
    const x = spawnSync("git", ["-C", repo, "show", `${task.baseSha}:${check.argv[1]}`], {
      maxBuffer: 1024 * 1024,
    });
    assert(
      x.status === 0 && hash(x.stdout) === check.sourceSha256,
      "Independent acceptance source differs from reviewed base",
    );
    const at = path.join(repo, check.argv[1]);
    noLinks(at);
    assert(
      hash(fs.readFileSync(at)) === check.sourceSha256,
      "Independent acceptance checkout changed",
    );
  }
  const clean = spawnSync("git", ["-C", repo, "status", "--porcelain", "--untracked-files=all"], {
    encoding: "utf8",
  });
  assert(clean.status === 0 && clean.stdout.trim() === "", "Admission requires a clean candidate");
  return task;
}
export function verifyTaskAdmission(repo, task, trustedCatalog) {
  const proof = validateAdmissionProof(task),
    approved = admitTask(repo, trustedCatalog, proof.workKey);
  assert(
    JSON.stringify(approved) === JSON.stringify(task),
    "Reserved task differs from approved catalog",
  );
  return proof;
}
export function assertUnconsumedWork(registry, task) {
  validateAdmissionProof(task);
  assert(
    !fs.existsSync(path.join(registry, "verification-only.json")),
    "Verification registry cannot admit tasks",
  );
  if (!fs.existsSync(registry)) return;
  for (const entry of fs.readdirSync(registry, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === ".mutation-lock") continue;
    const state = JSON.parse(fs.readFileSync(path.join(registry, entry.name, "reservation.json")));
    assert(state.contractSha256 === digest(state.task), "Invalid admission registry history");
    assert(
      state.task.id !== task.id &&
        state.task.admission?.workKey !== task.admission.workKey &&
        fingerprint(state.task) !== fingerprint(task),
      "Work identity already consumed; never rename or retry an uncertain attempt",
    );
  }
}
export function validateAdmissionOutput(task, files) {
  if (!task.admission) return;
  const proof = validateAdmissionProof(task);
  assert(files.length <= proof.limits.maxFiles, "Admitted output file limit exceeded");
  const total = files.reduce(
    (sum, f) => sum + (f.deleted ? 0 : Buffer.from(f.contentBase64, "base64").length),
    0,
  );
  assert(total <= proof.limits.maxTotalBytes, "Admitted output byte limit exceeded");
}
