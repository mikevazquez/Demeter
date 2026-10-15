import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const path = ".github/workflows/sf-gov-production-approval-rehearsal.yml";
const workflow = readFileSync(path, "utf8");

test("B02 approval rehearsal requires a Production environment review and no secrets", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /environment:\s*\n\s+name: Production/);
  assert.match(workflow, /permissions:\s*\{\}/);
  assert.match(workflow, /needs: preflight/);
  assert.match(workflow, /refs\/heads\/main/);
  assert.match(workflow, /GIT_ACTOR/);
  assert.match(workflow, /GIT_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /"\$RELEASE_SHA" != "\$GIT_SHA"/);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(workflow, /NO_DEPLOY/);
  for (const forbidden of [
    "vercel promote",
    "supabase db push",
    "supabase functions deploy",
    "git push",
    "gh pr merge",
    "GITHUB_TOKEN:",
    "SUPABASE_SERVICE_ROLE_KEY",
    "VERCEL_TOKEN",
  ]) {
    assert.equal(
      workflow.includes(forbidden),
      false,
      `unexpected production-capable command: ${forbidden}`,
    );
  }
});

test("approval input alone is not authorization, and cannot bypass Production reviewers", () => {
  assert.equal(workflow.includes("authorization_phrase"), false);
  assert.equal(workflow.includes("skip-review"), false);
  assert.equal(workflow.includes("environment:\n      name: Production"), true);
});

const preflight = workflow.match(/        run: \|\n([\s\S]*?)\n\n  owner-review:/)?.[1];
assert.ok(preflight, "expected a dedicated preflight script");
const script = preflight
  .split("\n")
  .map((line) => line.replace(/^          /, ""))
  .join("\n");

const goodSha = "a".repeat(40);
function runPreflight(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sf-gov-approval-"));
  try {
    const outputFile = join(dir, "out");
    const result = spawnSync("bash", ["-e", "-c", script], {
      env: {
        ...process.env,
        GIT_REF: "refs/heads/main",
        GIT_ACTOR: "mikevazquez",
        GIT_SHA: goodSha,
        RELEASE_SHA: goodSha,
        RELEASE_SCOPE: "studio-flow:governance",
        GITHUB_OUTPUT: outputFile,
        ...overrides,
      },
      encoding: "utf8",
    });
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      output: result.status === 0 ? readFileSync(outputFile, "utf8") : "",
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("preflight accepts only the exact reviewed main SHA, owner and bounded scope", () => {
  const result = runPreflight();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, `sha=${goodSha}\n`);
});

test("preflight rejects all untrusted release requests without approval checkpoint", () => {
  for (const override of [
    { GIT_REF: "refs/heads/feature" },
    { GIT_ACTOR: "external-user" },
    { RELEASE_SHA: "b".repeat(40) },
    { RELEASE_SHA: "malformed" },
    { RELEASE_SCOPE: "" },
    { RELEASE_SCOPE: "studio-flow\nINJECTED=true" },
    { RELEASE_SCOPE: "a".repeat(121) },
  ]) {
    const result = runPreflight(override);
    assert.equal(result.status, 1, JSON.stringify(override));
    assert.match(result.stdout, /DENY/);
    assert.equal(result.output, "");
  }
});
