import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
