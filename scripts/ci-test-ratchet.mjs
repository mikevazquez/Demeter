import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

const baseSha = process.argv[2] ?? "";
if (!/^[a-f0-9]{40}$/i.test(baseSha)) {
  console.error("Expected the exact 40-character base commit SHA.");
  process.exit(2);
}

const root = process.cwd();
const tempRoot = mkdtempSync(join(tmpdir(), "demeter-test-ratchet-"));
const baselineDir = join(tempRoot, "baseline");
const baselineReport = join(tempRoot, "baseline-vitest.json");
const candidateReport = join(tempRoot, "candidate-vitest.json");
let worktreeAdded = false;

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: process.env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  return result;
}

function requireSuccess(command, args, cwd) {
  const result = run(command, args, cwd, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`Command failed (${result.status}): ${command} ${args.join(" ")}`);
  }
}

function runTests(cwd, reportPath) {
  const result = run(
    "npm",
    ["test", "--", "--reporter=json", `--outputFile=${reportPath}`],
    cwd,
    { stdio: "ignore" },
  );
  if (result.error) throw result.error;
  // A nonzero result is expected when the compared revision has existing failures.
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(`Vitest could not complete successfully (exit ${result.status}).`);
  }
  return readFileSync(reportPath, "utf8");
}

function failedTests(reportText, repoRoot) {
  const report = JSON.parse(reportText);
  const failures = new Set();
  for (const suite of report.testResults ?? []) {
    const file = relative(repoRoot, resolve(suite.name)).split(sep).join("/");
    const assertions = suite.assertionResults ?? [];
    for (const assertion of assertions) {
      if (assertion.status === "failed") {
        failures.add(`${file} :: ${assertion.fullName || assertion.title || "(unnamed test)"}`);
      }
    }
    if (suite.status === "failed" && assertions.length === 0) {
      failures.add(`${file} :: (suite setup or collection failure)`);
    }
  }
  return [...failures].sort();
}

try {
  requireSuccess("git", ["fetch", "--no-tags", "origin", baseSha, "--depth=1"], root);
  requireSuccess("git", ["worktree", "add", "--detach", baselineDir, baseSha], root);
  worktreeAdded = true;

  console.log(`Installing dependencies for comparison base ${baseSha.slice(0, 12)}…`);
  requireSuccess("npm", ["ci", "--prefer-offline"], baselineDir);

  console.log("Running the base revision's full Vitest suite…");
  const baseFailures = failedTests(runTests(baselineDir, baselineReport), baselineDir);

  console.log("Running the candidate's full Vitest suite…");
  const candidateFailures = failedTests(runTests(root, candidateReport), root);

  const baseSet = new Set(baseFailures);
  const newFailures = candidateFailures.filter((failure) => !baseSet.has(failure));
  const resolvedFailures = baseFailures.filter((failure) => !candidateFailures.includes(failure));

  console.log(`Base failures: ${baseFailures.length}`);
  console.log(`Candidate failures: ${candidateFailures.length}`);
  console.log(`New candidate failures: ${newFailures.length}`);
  if (resolvedFailures.length) {
    console.log(`No longer failing on candidate: ${resolvedFailures.length}`);
    for (const failure of resolvedFailures) console.log(`  ${failure}`);
  }
  if (baseFailures.length) {
    console.log("Existing failures inherited from the base (reported, not suppressed):");
    for (const failure of baseFailures) console.log(`  ${failure}`);
  }
  if (newFailures.length) {
    console.error("The candidate introduced failing tests:");
    for (const failure of newFailures) console.error(`  ${failure}`);
    process.exitCode = 1;
  } else {
    console.log("Test ratchet passed: the candidate introduces no failing tests.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (worktreeAdded) {
    const cleanup = run("git", ["worktree", "remove", "--force", baselineDir], root, { stdio: "ignore" });
    if (cleanup.status !== 0) process.exitCode = 1;
  }
  rmSync(tempRoot, { recursive: true, force: true });
}
