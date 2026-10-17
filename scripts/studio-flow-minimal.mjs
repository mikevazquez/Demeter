#!/usr/bin/env node
// Supervised local handoff. No model API, queue consumer, GitHub token or deploy.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const read = (filename) => JSON.parse(fs.readFileSync(filename, "utf8"));
// Publish complete JSON in one filesystem operation; a killed writer cannot truncate it.
const write = (filename, value, flag = "w") => {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temporary, "wx", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    if (flag === "wx") fs.linkSync(temporary, filename);
    else fs.renameSync(temporary, filename);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
};
const git = (repo, ...args) => {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  assert(r.status === 0, `git ${args[0]} failed: ${r.stderr}`);
  return r.stdout.trim();
};
function locations(registry, id) {
  assert(/^[a-z0-9][a-z0-9-]{2,79}$/.test(id ?? ""), "Invalid task ID");
  return { dir: path.join(registry, id), lock: path.join(registry, "active.json") };
}
const validReceipt = (receipt, branch) =>
  receipt?.draft === true &&
  receipt.branch === branch &&
  /^[a-f0-9]{40}$/.test(receipt.commitSha ?? "") &&
  /^https:\/\/github\.com\/mikevazquez\/Demeter\/pull\/\d+$/.test(receipt.url ?? "");
function reservation(registry, id) {
  const loc = locations(registry, id);
  const state = read(path.join(loc.dir, "reservation.json"));
  assert(
    state.task?.id === id && state.contractSha256 === hash(JSON.stringify(state.task)),
    "Invalid reservation identity or contract hash; inspect registry and authorization issue",
  );
  return { task: state.task, contractSha256: state.contractSha256, ...loc };
}
function taskState(registry, id) {
  const state = reservation(registry, id);
  const loc = locations(registry, id);
  assert(read(loc.lock).id === id, "Another task owns the registry");
  assert(!fs.existsSync(path.join(loc.dir, "published.json")), "Task already published");
  return { ...loc, ...state };
}
export function reserve(repo, registry, task, selectedId) {
  assert(selectedId === task.id, "CODEX_PILOT_TASK_ID must exactly match the one task");
  const loc = locations(registry, task.id);
  assert(
    task.goal?.trim() &&
      /^https:\/\/github\.com\/mikevazquez\/Demeter\/issues\/\d+$/.test(task.authorization ?? ""),
    "Goal and authorization issue required",
  );
  assert(/^[a-f0-9]{40}$/.test(task.baseSha ?? ""), "Immutable base SHA required");
  assert(
    git(repo, "rev-parse", "HEAD") === task.baseSha,
    "Checkout must start at the authorized base",
  );
  assert(
    git(repo, "status", "--porcelain", "--untracked-files=all") === "",
    "Start with a clean checkout",
  );
  assert(
    Array.isArray(task.allowedPaths) && task.allowedPaths.length > 0,
    "Exact allowed paths required",
  );
  for (const p of task.allowedPaths) {
    assert(
      typeof p === "string" &&
        /^[A-Za-z0-9_./-]+$/.test(p) &&
        !p.startsWith("/") &&
        !p.split("/").some((v) => !v || v === "." || v === ".." || v === ".git"),
      "Unsafe allowed path",
    );
  }
  assert(new Set(task.allowedPaths).size === task.allowedPaths.length, "Duplicate allowed path");
  assert(
    Array.isArray(task.checks) &&
      task.checks.length > 0 &&
      task.checks.every(
        (c) => Array.isArray(c) && c.length > 0 && c.every((v) => typeof v === "string"),
      ),
    "Reviewed check argv arrays required",
  );
  const absRegistry = path.resolve(registry);
  const relative = path.relative(path.resolve(repo), absRegistry);
  assert(
    relative.startsWith(".." + path.sep) || path.isAbsolute(relative),
    "Registry must be outside the checkout",
  );
  fs.mkdirSync(registry, { recursive: true });
  assert(!fs.existsSync(loc.dir), "Task ID already consumed, including failed or published tasks");
  write(loc.lock, { id: task.id }, "wx");
  try {
    // A lost active.json must not silently permit a second unfinished task.
    for (const entry of fs.readdirSync(registry, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const prior = reservation(registry, entry.name);
      const published = read(path.join(prior.dir, "published.json"));
      assert(
        published.id === entry.name &&
          published.contractSha256 === prior.contractSha256 &&
          validReceipt(published, `studio-flow/minimal/${entry.name}`),
        "Unresolved registry entry; reconcile history before reserving another task",
      );
    }
    fs.mkdirSync(loc.dir);
    write(
      path.join(loc.dir, "reservation.json"),
      { task, contractSha256: hash(JSON.stringify(task)), reservedAt: new Date().toISOString() },
      "wx",
    );
  } catch (error) {
    fs.unlinkSync(loc.lock);
    throw error;
  }
  return { id: task.id, status: "reserved", selected: 1 };
}
function snapshot(repo, task) {
  assert(git(repo, "rev-parse", "HEAD") === task.baseSha, "HEAD changed from authorized base");
  const names = new Set(
    [
      ...git(repo, "diff", "--name-only", "--no-renames", "-z", task.baseSha).split("\0"),
      ...git(repo, "ls-files", "--others", "--exclude-standard", "-z").split("\0"),
    ].filter(Boolean),
  );
  assert(names.size > 0, "No deliverable changes");
  return [...names].sort().map((p) => {
    assert(task.allowedPaths.includes(p), `Out of scope: ${p}`);
    let current = repo;
    for (const component of p.split("/")) {
      current = path.join(current, component);
      try {
        assert(!fs.lstatSync(current).isSymbolicLink(), `Symlink forbidden: ${p}`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    if (!fs.existsSync(current)) return { path: p, deleted: true };
    const stat = fs.lstatSync(current);
    assert(stat.isFile(), `Regular file required: ${p}`);
    return {
      path: p,
      mode: stat.mode & 0o111 ? "100755" : "100644",
      sha256: hash(fs.readFileSync(current)),
    };
  });
}
export function certify(repo, registry, id) {
  const state = taskState(registry, id);
  assert(
    !fs.existsSync(path.join(state.dir, "publication.json")),
    "Publication pending; reconcile remotely before changing the candidate",
  );
  // Invalidate any previous success before executing checks that may be interrupted.
  write(path.join(state.dir, "certificate.json"), { id, passed: false, status: "certifying" });
  const before = snapshot(repo, state.task);
  // Checks are reviewed supervisor inputs, never inferred from generated text.
  // Run this command in an offline sandbox for untrusted candidate code.
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "sf-check-"));
  let checks;
  try {
    checks = state.task.checks.map((argv) => {
      const r = spawnSync(argv[0], argv.slice(1), {
        cwd: repo,
        env: { PATH: process.env.PATH, HOME: temporary, TMPDIR: temporary },
        encoding: "utf8",
        timeout: 120000,
        maxBuffer: 1024 * 1024,
      });
      return {
        argv,
        exitCode: r.status,
        signal: r.signal,
        error: r.error?.message ?? null,
        stdout: r.stdout ?? "",
        stderr: r.stderr ?? "",
      };
    });
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  const after = snapshot(repo, state.task);
  const certificate = {
    id,
    contractSha256: state.contractSha256,
    baseSha: state.task.baseSha,
    files: after,
    checks,
    passed:
      checks.every((c) => c.exitCode === 0 && !c.error) &&
      JSON.stringify(before) === JSON.stringify(after),
    certifiedAt: new Date().toISOString(),
    mode: "supervised-local",
  };
  write(path.join(state.dir, "certificate.json"), certificate);
  assert(certificate.passed, "Certification failed; inspect certificate.json");
  return certificate;
}
function certifiedPlan(repo, registry, id) {
  const state = taskState(registry, id);
  const certificate = read(path.join(state.dir, "certificate.json"));
  assert(
    certificate.passed === true &&
      certificate.mode === "supervised-local" &&
      typeof certificate.certifiedAt === "string" &&
      Number.isFinite(Date.parse(certificate.certifiedAt)) &&
      Array.isArray(certificate.checks) &&
      certificate.checks.length === state.task.checks.length &&
      certificate.checks.every(
        (check, index) =>
          check?.exitCode === 0 &&
          check.signal === null &&
          !check.error &&
          JSON.stringify(check.argv) === JSON.stringify(state.task.checks[index]),
      ) &&
      certificate.baseSha === state.task.baseSha &&
      certificate.id === id &&
      certificate.contractSha256 === state.contractSha256,
    "Successful matching certificate required",
  );
  assert(
    JSON.stringify(snapshot(repo, state.task)) === JSON.stringify(certificate.files),
    "Candidate changed after certification",
  );
  return {
    id,
    draft: true,
    baseSha: state.task.baseSha,
    branch: `studio-flow/minimal/${id}`,
    files: certificate.files,
    authorization: state.task.authorization,
  };
}
// The trusted supervisor obtains this snapshot through its existing GitHub connection.
// It is reviewed input, not independent proof that a remote lookup actually happened.
export function publicationPlan(repo, registry, id, remote) {
  const plan = certifiedPlan(repo, registry, id);
  const filename = path.join(locations(registry, id).dir, "publication.json");
  const retry = fs.existsSync(filename);
  if (retry) {
    assert(
      JSON.stringify(read(filename)) === JSON.stringify(plan),
      "Inconsistent publication intent",
    );
  }
  assert(remote, "Remote reconciliation required before planning or retrying publication");
  let action = "create-draft";
  let existing = null;
  if (remote) {
    assert(
      remote.branch === plan.branch &&
        remote.baseSha === plan.baseSha &&
        (remote.headSha === null || /^[a-f0-9]{40}$/.test(remote.headSha ?? "")) &&
        Array.isArray(remote.pullRequests),
      "Matching remote branch, base and all-state PR lookup required",
    );
    assert(remote.pullRequests.length <= 1, "Multiple PRs found; supervisor intervention required");
    if (remote.pullRequests.length) {
      existing = remote.pullRequests[0];
      assert(
        existing.state === "OPEN" &&
          existing.draft === true &&
          existing.branch === plan.branch &&
          existing.commitSha === remote.headSha &&
          /^https:\/\/github\.com\/mikevazquez\/Demeter\/pull\/\d+$/.test(existing.url ?? ""),
        "Existing PR must be the matching open Draft; never create a replacement",
      );
      action = "reuse-draft";
    } else if (remote.headSha !== null) action = "verify-existing-branch";
  }
  if (!retry) write(filename, plan, "wx");
  return { ...plan, action, existing };
}
const receiptMatches = (a, b) =>
  ["branch", "commitSha", "draft", "url"].every((key) => a[key] === b[key]);
export function complete(repo, registry, id, receipt) {
  const state = reservation(registry, id);
  const filename = path.join(state.dir, "published.json");
  if (fs.existsSync(filename)) {
    const published = read(filename);
    assert(
      published.id === id &&
        published.contractSha256 === state.contractSha256 &&
        validReceipt(published, `studio-flow/minimal/${id}`) &&
        receiptMatches(published, receipt),
      "Conflicting published receipt",
    );
    // A crash after persisting the receipt may have left the old task's lock.
    // Never release another task's reservation during an idempotent retry.
    if (fs.existsSync(state.lock) && read(state.lock).id === id) fs.unlinkSync(state.lock);
    return { id, status: "published-draft", url: published.url };
  }
  const plan = certifiedPlan(repo, registry, id);
  assert(validReceipt(receipt, plan.branch), "Supervisor-verified Draft receipt required");
  assert(
    JSON.stringify(read(path.join(state.dir, "publication.json"))) === JSON.stringify(plan),
    "Matching publication intent required",
  );
  write(
    filename,
    { ...receipt, id, contractSha256: state.contractSha256, recordedAt: new Date().toISOString() },
    "wx",
  );
  fs.unlinkSync(state.lock);
  return { id, status: "published-draft", url: receipt.url };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, repo, registry, input, receipt] = process.argv.slice(2);
    let result;
    if (command === "reserve")
      result = reserve(repo, registry, read(input), process.env.CODEX_PILOT_TASK_ID);
    else if (command === "certify") result = certify(repo, registry, input);
    else if (command === "publish-plan")
      result = publicationPlan(repo, registry, input, receipt ? read(receipt) : undefined);
    else if (command === "complete") result = complete(repo, registry, input, read(receipt));
    else
      throw new Error(
        "Usage: reserve|certify|publish-plan|complete REPO REGISTRY TASK_FILE_OR_ID [REMOTE_SNAPSHOT_OR_RECEIPT]",
      );
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (error) {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  }
}
