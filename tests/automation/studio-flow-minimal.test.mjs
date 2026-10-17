import { test } from "vitest";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { reserve, certify, publicationPlan, complete } from "../../scripts/studio-flow-minimal.mjs";

// Remote fixtures exercise the supervisor-input contract; they make no GitHub calls.
const remoteAbsent = (task) => ({
  branch: `studio-flow/minimal/${task.id}`,
  baseSha: task.baseSha,
  headSha: null,
  pullRequests: [],
});

function setup(t, checks = [[process.execPath, "--check", "change.mjs"]]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sf-minimal-test-"));
  t.onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }));
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
  const plan = publicationPlan(repo, registry, task.id, remoteAbsent(task));
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
  t.onTestFinished(() => {
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

test("reservation identity and contract corruption fail closed", (t) => {
  const { repo, registry, task, change } = setup(t);
  reserve(repo, registry, task, task.id);
  change("export {};");
  const filename = path.join(registry, task.id, "reservation.json");
  const state = JSON.parse(fs.readFileSync(filename, "utf8"));
  state.task.id = "another-task";
  fs.writeFileSync(filename, JSON.stringify(state));
  assert.throws(() => certify(repo, registry, task.id), /Invalid reservation/);
});

test("completion can resume after receipt persistence without clearing a different lock", (t) => {
  const { repo, registry, task, change } = setup(t);
  reserve(repo, registry, task, task.id);
  change("export {};");
  certify(repo, registry, task.id);
  const plan = publicationPlan(repo, registry, task.id, remoteAbsent(task));
  const receipt = {
    branch: plan.branch,
    commitSha: "a".repeat(40),
    draft: true,
    url: "https://github.com/mikevazquez/Demeter/pull/314",
  };
  complete(repo, registry, task.id, receipt);
  fs.writeFileSync(path.join(registry, "active.json"), JSON.stringify({ id: task.id }));
  assert.equal(complete(repo, registry, task.id, receipt).status, "published-draft");
  assert.equal(fs.existsSync(path.join(registry, "active.json")), false);
  fs.writeFileSync(path.join(registry, "active.json"), JSON.stringify({ id: "another-task" }));
  complete(repo, registry, task.id, receipt);
  assert.equal(JSON.parse(fs.readFileSync(path.join(registry, "active.json"))).id, "another-task");
  assert.throws(
    () => complete(repo, registry, task.id, { ...receipt, commitSha: "b".repeat(40) }),
    /Conflicting/,
  );
});

test("publication retry requires remote reconciliation and reuses the existing Draft", (t) => {
  const { repo, registry, task, change } = setup(t);
  reserve(repo, registry, task, task.id);
  change("export {};");
  certify(repo, registry, task.id);
  const plan = publicationPlan(repo, registry, task.id, remoteAbsent(task));
  assert.throws(() => publicationPlan(repo, registry, task.id), /Remote reconciliation required/);
  const remote = {
    branch: plan.branch,
    baseSha: task.baseSha,
    headSha: "a".repeat(40),
    pullRequests: [
      {
        branch: plan.branch,
        commitSha: "a".repeat(40),
        url: "https://github.com/mikevazquez/Demeter/pull/314",
        draft: true,
        state: "OPEN",
      },
    ],
  };
  assert.equal(publicationPlan(repo, registry, task.id, remote).action, "reuse-draft");
  assert.throws(
    () =>
      publicationPlan(repo, registry, task.id, {
        ...remote,
        pullRequests: [...remote.pullRequests, ...remote.pullRequests],
      }),
    /Multiple PRs/,
  );
  assert.throws(
    () =>
      publicationPlan(repo, registry, task.id, {
        ...remote,
        pullRequests: [{ ...remote.pullRequests[0], state: "CLOSED" }],
      }),
    /Existing PR/,
  );
  assert.throws(
    () => publicationPlan(repo, registry, task.id, { ...remote, headSha: "b".repeat(40) }),
    /Existing PR/,
  );
  assert.equal(
    publicationPlan(repo, registry, task.id, { ...remote, pullRequests: [] }).action,
    "verify-existing-branch",
  );
  assert.equal(
    publicationPlan(repo, registry, task.id, { ...remote, headSha: null, pullRequests: [] }).action,
    "create-draft",
  );
});

const script = fileURLToPath(new URL("../../scripts/studio-flow-minimal.mjs", import.meta.url));
function cli(...args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
}

test("two actual reserve processes admit only one task and persist its identity", async (t) => {
  const { root, repo, registry, task } = setup(t);
  const contracts = [task, { ...task, id: "another-task" }];
  const results = await Promise.all(
    contracts.map((contract, index) => {
      const filename = path.join(root, `contract-${index}.json`);
      fs.writeFileSync(filename, JSON.stringify(contract));
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [script, "reserve", repo, registry, filename], {
          env: { ...process.env, CODEX_PILOT_TASK_ID: contract.id },
          stdio: "ignore",
        });
        child.on("error", reject);
        child.on("exit", (code) => resolve({ code, id: contract.id }));
      });
    }),
  );
  assert.deepEqual(results.map((r) => r.code).sort(), [0, 1]);
  const winner = results.find((r) => r.code === 0).id;
  assert.equal(JSON.parse(fs.readFileSync(path.join(registry, "active.json"))).id, winner);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(registry, winner, "reservation.json"))).task.id,
    winner,
  );
  assert.equal(
    fs.readdirSync(registry).filter((name) => fs.statSync(path.join(registry, name)).isDirectory())
      .length,
    1,
  );
});

test("SIGKILL during recertification invalidates old success and resumes in a fresh process", (t) => {
  const { root, repo, registry, task, change } = setup(t);
  const marker = path.join(root, "interrupt-check");
  task.checks = [
    [
      process.execPath,
      "-e",
      `const fs = require('node:fs'); const marker = ${JSON.stringify(marker)}; if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === 'interrupt') { fs.writeFileSync(marker, 'interrupted'); process.kill(process.ppid, 'SIGKILL'); }`,
    ],
  ];
  reserve(repo, registry, task, task.id);
  change("export {};\n");
  assert.equal(cli("certify", repo, registry, task.id).status, 0);
  fs.writeFileSync(marker, "interrupt");
  const killed = cli("certify", repo, registry, task.id);
  assert.equal(killed.signal, "SIGKILL");
  assert.equal(fs.readFileSync(marker, "utf8"), "interrupted");
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(registry, task.id, "certificate.json"))).passed,
    false,
  );
  assert.throws(() => publicationPlan(repo, registry, task.id), /Successful/);
  assert.equal(cli("certify", repo, registry, task.id).status, 0);
  const remoteFile = path.join(root, "remote.json");
  fs.writeFileSync(remoteFile, JSON.stringify(remoteAbsent(task)));
  const planned = cli("publish-plan", repo, registry, task.id, remoteFile);
  assert.equal(planned.status, 0, planned.stderr);
  assert.equal(JSON.parse(planned.stdout).id, task.id);
  const retry = cli("publish-plan", repo, registry, task.id);
  assert.equal(retry.status, 1);
  assert.match(retry.stderr, /Remote reconciliation required/);
  assert.throws(() => certify(repo, registry, task.id), /Publication pending/);
});

test("incomplete or inconsistent local records block publication without consuming another ID", (t) => {
  for (const broken of [
    "reservation",
    "contract",
    "missing-lock",
    "wrong-lock",
    "certificate",
    "intent",
    "published",
    "incomplete-certificate",
    "incomplete-receipt",
  ]) {
    const { repo, registry, task, change } = setup(t);
    reserve(repo, registry, task, task.id);
    change("export {};");
    certify(repo, registry, task.id);
    const dir = path.join(registry, task.id);
    if (broken === "reservation") fs.writeFileSync(path.join(dir, "reservation.json"), "{");
    if (broken === "contract") {
      const filename = path.join(dir, "reservation.json");
      const state = JSON.parse(fs.readFileSync(filename));
      state.task.goal = "unexpected replacement";
      fs.writeFileSync(filename, JSON.stringify(state));
    }
    if (broken === "missing-lock") fs.unlinkSync(path.join(registry, "active.json"));
    if (broken === "wrong-lock")
      fs.writeFileSync(path.join(registry, "active.json"), '{"id":"another-task"}');
    if (broken === "certificate") fs.writeFileSync(path.join(dir, "certificate.json"), "{");
    if (broken === "intent") fs.writeFileSync(path.join(dir, "publication.json"), "{");
    if (broken === "published") fs.writeFileSync(path.join(dir, "published.json"), "{");
    if (broken === "incomplete-certificate") {
      const filename = path.join(dir, "certificate.json");
      const certificate = JSON.parse(fs.readFileSync(filename));
      delete certificate.checks;
      fs.writeFileSync(filename, JSON.stringify(certificate));
    }
    if (broken === "incomplete-receipt") {
      const state = JSON.parse(fs.readFileSync(path.join(dir, "reservation.json")));
      fs.writeFileSync(
        path.join(dir, "published.json"),
        JSON.stringify({ id: task.id, contractSha256: state.contractSha256 }),
      );
      assert.throws(() => complete(repo, registry, task.id, {}), /Conflicting/);
      assert.equal(fs.existsSync(path.join(registry, "active.json")), true);
    }
    assert.throws(
      () => publicationPlan(repo, registry, task.id, remoteAbsent(task)),
      undefined,
      broken,
    );
    fs.unlinkSync(path.join(repo, "change.mjs"));
    const other = { ...task, id: "replacement-task" };
    assert.throws(() => reserve(repo, registry, other, other.id), undefined, broken);
    assert.equal(fs.existsSync(path.join(registry, other.id)), false);
  }
});
