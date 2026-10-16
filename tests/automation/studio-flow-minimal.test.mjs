import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { reserve, certify, publicationPlan, complete } from "../../scripts/studio-flow-minimal.mjs";

function setup(t, checks = [[process.execPath, "--check", "change.mjs"]]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sf-minimal-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  const registry = path.join(root, "registry");
  fs.mkdirSync(repo);
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();
  git("init", "-q");
  git(
    "-c",
    "user.name=Test",
    "-c",
    "user.email=test@example.invalid",
    "commit",
    "--allow-empty",
    "-qm",
    "base",
  );
  const task = {
    id: "minimal-test-v1",
    goal: "One useful change",
    authorization: "https://github.com/mikevazquez/Demeter/issues/313",
    baseSha: git("rev-parse", "HEAD"),
    allowedPaths: ["change.mjs"],
    checks,
  };
  const change = (text) => fs.writeFileSync(path.join(repo, "change.mjs"), text);
  return { root, repo, registry, task, change };
}
test("one explicit task reaches a Draft plan and cannot be reserved again", (t) => {
  const { repo, registry, task, change } = setup(t);
  assert.equal(reserve(repo, registry, task, task.id).selected, 1);
  change("export const result = 42;\n");
  assert.equal(certify(repo, registry, task.id).passed, true);
  const plan = publicationPlan(repo, registry, task.id);
  assert.equal(plan.draft, true);
  assert.deepEqual(
    plan.files.map((f) => f.path),
    ["change.mjs"],
  );
  complete(repo, registry, task.id, {
    branch: plan.branch,
    commitSha: "a".repeat(40),
    draft: true,
    url: "https://github.com/mikevazquez/Demeter/pull/314",
  });
  fs.unlinkSync(path.join(repo, "change.mjs"));
  assert.throws(() => reserve(repo, registry, task, task.id), /already consumed/);
  assert.throws(() => publicationPlan(repo, registry, task.id));
});
test("missing or different selector reserves nothing", (t) => {
  const { repo, registry, task } = setup(t);
  for (const id of [undefined, "another-task"])
    assert.throws(() => reserve(repo, registry, task, id), /exactly match/);
  assert.equal(fs.existsSync(registry), false);
});
test("parallel second task and replay are blocked", (t) => {
  const { repo, registry, task } = setup(t);
  reserve(repo, registry, task, task.id);
  assert.throws(() => reserve(repo, registry, task, task.id), /already consumed/);
  const other = { ...task, id: "another-task" };
  assert.throws(() => reserve(repo, registry, other, other.id), /EEXIST/);
  assert.equal(fs.existsSync(path.join(registry, other.id)), false);
});
test("invalid base, traversal and dirty starting checkout are rejected", (t) => {
  const { repo, registry, task, change } = setup(t);
  assert.throws(
    () => reserve(repo, registry, { ...task, baseSha: "b".repeat(40) }, task.id),
    /authorized base/,
  );
  assert.throws(
    () => reserve(repo, registry, { ...task, allowedPaths: ["../outside"] }, task.id),
    /Unsafe/,
  );
  change("export {};");
  assert.throws(() => reserve(repo, registry, task, task.id), /clean checkout/);
});
test("out-of-scope files cannot be certified", (t) => {
  const { repo, registry, task, change } = setup(t);
  reserve(repo, registry, task, task.id);
  change("export {};");
  fs.writeFileSync(path.join(repo, "unexpected.txt"), "outside");
  assert.throws(() => certify(repo, registry, task.id), /Out of scope/);
  assert.throws(() => publicationPlan(repo, registry, task.id));
});
test("failed check prevents publication and can be corrected within the reserved task", (t) => {
  const { repo, registry, task, change } = setup(t);
  reserve(repo, registry, task, task.id);
  change("this is invalid javascript !");
  assert.throws(() => certify(repo, registry, task.id), /Certification failed/);
  assert.throws(() => publicationPlan(repo, registry, task.id), /Successful/);
  change("export {};");
  assert.equal(certify(repo, registry, task.id).passed, true);
});
test("mutation after certification and symlink candidates are blocked", (t) => {
  const { repo, registry, task, change } = setup(t);
  reserve(repo, registry, task, task.id);
  change("export {};");
  certify(repo, registry, task.id);
  change("export const changed = true;");
  assert.throws(() => publicationPlan(repo, registry, task.id), /changed after/);
  fs.unlinkSync(path.join(repo, "change.mjs"));
  fs.symlinkSync("/etc/passwd", path.join(repo, "change.mjs"));
  assert.throws(() => certify(repo, registry, task.id), /Symlink forbidden/);
});
test("checks cannot change certified bytes", (t) => {
  const { repo, registry, task, change } = setup(t, [
    [
      process.execPath,
      "-e",
      "require('node:fs').writeFileSync('change.mjs', 'export const changed = true;')",
    ],
  ]);
  reserve(repo, registry, task, task.id);
  change("export {};");
  assert.throws(() => certify(repo, registry, task.id), /Certification failed/);
  assert.throws(() => publicationPlan(repo, registry, task.id), /Successful/);
});
test("check process receives no inherited credential variable", (t) => {
  const prior = process.env.SF_TEST_SECRET;
  process.env.SF_TEST_SECRET = "test-only-sentinel";
  t.after(() => {
    if (prior === undefined) delete process.env.SF_TEST_SECRET;
    else process.env.SF_TEST_SECRET = prior;
  });
  const { repo, registry, task, change } = setup(t, [
    [process.execPath, "-e", "if (process.env.SF_TEST_SECRET) process.exit(1)"],
  ]);
  reserve(repo, registry, task, task.id);
  change("export {};");
  assert.equal(certify(repo, registry, task.id).passed, true);
});
test("non-Draft completion is rejected and reservation stays active", (t) => {
  const { repo, registry, task, change } = setup(t);
  reserve(repo, registry, task, task.id);
  change("export {};");
  certify(repo, registry, task.id);
  assert.throws(() => complete(repo, registry, task.id, { draft: false }), /Draft receipt/);
  assert.equal(fs.existsSync(path.join(registry, "active.json")), true);
});
