#!/usr/bin/env node
// Supervised local handoff. No model API, queue consumer, GitHub token or deploy.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const assert = (ok, message) => {
  if (!ok) throw new Error(message);
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const read = (filename) => JSON.parse(fs.readFileSync(filename, "utf8"));
const write = (filename, value, flag = "w") =>
  fs.writeFileSync(filename, JSON.stringify(value, null, 2) + "\n", { flag });
const git = (repo, ...args) => {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  assert(r.status === 0, `git ${args[0]} failed: ${r.stderr}`);
  return r.stdout.trim();
};
function locations(registry, id) {
  assert(/^[a-z0-9][a-z0-9-]{2,79}$/.test(id ?? ""), "Invalid task ID");
  return { dir: path.join(registry, id), lock: path.join(registry, "active.json") };
}
function taskState(registry, id) {
  const loc = locations(registry, id);
  const state = read(path.join(loc.dir, "reservation.json"));
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
export function publicationPlan(repo, registry, id) {
  const state = taskState(registry, id);
  const certificate = read(path.join(state.dir, "certificate.json"));
  assert(
    certificate.passed &&
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
export function complete(repo, registry, id, receipt) {
  const plan = publicationPlan(repo, registry, id);
  assert(
    receipt.draft === true &&
      receipt.branch === plan.branch &&
      /^[a-f0-9]{40}$/.test(receipt.commitSha ?? "") &&
      /^https:\/\/github\.com\/mikevazquez\/Demeter\/pull\/\d+$/.test(receipt.url ?? ""),
    "Supervisor-verified Draft receipt required",
  );
  const loc = locations(registry, id);
  write(
    path.join(loc.dir, "published.json"),
    { ...receipt, id, recordedAt: new Date().toISOString() },
    "wx",
  );
  fs.unlinkSync(loc.lock);
  return { id, status: "published-draft", url: receipt.url };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, repo, registry, input, receipt] = process.argv.slice(2);
    let result;
    if (command === "reserve")
      result = reserve(repo, registry, read(input), process.env.CODEX_PILOT_TASK_ID);
    else if (command === "certify") result = certify(repo, registry, input);
    else if (command === "publish-plan") result = publicationPlan(repo, registry, input);
    else if (command === "complete") result = complete(repo, registry, input, read(receipt));
    else
      throw new Error(
        "Usage: reserve|certify|publish-plan|complete REPO REGISTRY TASK_FILE_OR_ID [RECEIPT]",
      );
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (error) {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  }
}
