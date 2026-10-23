import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSupervisorReceipts,
  verifySupervisorReceipt,
} from "../../scripts/automation/supervisor-evidence.mjs";

const REPO = "mikevazquez/Demeter";
const BASE = "a".repeat(40);
const CURRENT = "b".repeat(40);
const CONTRACT_HASH = "c".repeat(64);
const FINGERPRINT = "d".repeat(64);
const RECEIPT_URL = `https://github.com/${REPO}/issues/341#issuecomment-123`;
const FILE = "scripts/automation/review.mjs";
const lowerBody = (receipt) =>
  `\`\`\`governance-worker-receipt-v2\n${JSON.stringify(receipt)}\n\`\`\``;
const upperBody = (receipt) =>
  `GOVERNANCE_WORKER_RECEIPT_V2\n\n\`\`\`json\n${JSON.stringify(receipt, null, 2)}\n\`\`\``;

function fixture({ readOnly = false, withPr = false } = {}) {
  const sha = readOnly ? BASE : CURRENT;
  const task = {
    task_id: "GOV-SUPERVISOR-001-PILOT",
    contract_sha256: CONTRACT_HASH,
    contract: {
      repo: REPO,
      branch: "feat/governance-supervisor",
      base_sha: BASE,
      allowed_paths: ["scripts/automation/", "tests/automation/**", "docs/automation/review.md"],
      read_only: readOnly,
      ...(withPr ? { pr_number: 400 } : {}),
    },
  };
  const attempt = {
    attempt_id: "attempt-1",
    worker_id: "claude-code-routine-worker",
    contract_sha256: CONTRACT_HASH,
    dispatch_fingerprint: FINGERPRINT,
    base_sha: BASE,
  };
  const receipt = {
    schema: "governance-worker-receipt-v2",
    task_id: task.task_id,
    attempt_id: attempt.attempt_id,
    worker_id: attempt.worker_id,
    contract_sha256: CONTRACT_HASH,
    dispatch_fingerprint: FINGERPRINT,
    base_sha: BASE,
    current_sha: sha,
    files_changed: readOnly ? [] : [FILE],
    commands_run: ["node tests/automation/supervisor-evidence.node.mjs"],
    tests_passed: ["reported-by-worker-only"],
    blockers: [],
    remaining_work: [],
    next_action: null,
    status: "completed",
  };
  const source = {
    author: "mikevazquez",
    channel: "github_issue_comment",
    receipt_url: RECEIPT_URL,
  };
  const policy = {
    allowed_sources: [
      {
        author: "mikevazquez",
        channel: "github_issue_comment",
        receipt_url_prefix: `https://github.com/${REPO}/issues/341#issuecomment-`,
      },
    ],
    required_checks: [{ name: "supervisor-tests", app_slug: "github-actions" }],
  };
  const checks = [
    {
      id: 10,
      name: "supervisor-tests",
      app: { slug: "github-actions", id: 15368 },
      head_sha: sha,
      status: "completed",
      conclusion: "success",
      html_url: `https://github.com/${REPO}/actions/runs/600/job/700`,
    },
  ];
  const statuses = [];
  const hooks = {};
  const calls = [];
  const request = async (method, endpoint) => {
    assert.equal(method, "GET", "the verifier must never cause a write or execute code");
    assert.ok(!endpoint.startsWith("/"));
    calls.push({ method, endpoint });
    const api = `repos/${REPO}`;
    let kind;
    let response;
    if (endpoint === `${api}/issues/comments/123`) {
      kind = "comment";
      response = {
        id: 123,
        user: { login: "mikevazquez" },
        html_url: RECEIPT_URL,
        body: upperBody(receipt),
      };
    } else if (endpoint === `${api}/git/ref/heads/feat/governance-supervisor`) {
      kind = "ref";
      response = { ref: "refs/heads/feat/governance-supervisor", object: { type: "commit", sha } };
    } else if (endpoint === `${api}/git/commits/${sha}`) {
      kind = "commit";
      response = { sha, tree: { sha: "e".repeat(40) } };
    } else if (endpoint === `${api}/compare/${BASE}...${sha}`) {
      kind = "compare";
      response = {
        base_commit: { sha: BASE },
        merge_base_commit: { sha: BASE },
        status: "ahead",
        behind_by: 0,
        ahead_by: 1,
        files: [{ filename: FILE, status: "added" }],
      };
    } else if (endpoint.startsWith(`${api}/commits/${sha}/check-runs?`)) {
      kind = "checks";
      const page = Number(new URL(`https://api.github.com/${endpoint}`).searchParams.get("page"));
      response = {
        total_count: checks.length,
        check_runs: checks.slice((page - 1) * 100, page * 100),
      };
    } else if (endpoint.startsWith(`${api}/commits/${sha}/status?`)) {
      kind = "statuses";
      const page = Number(new URL(`https://api.github.com/${endpoint}`).searchParams.get("page"));
      response = {
        sha,
        total_count: statuses.length,
        statuses: statuses.slice((page - 1) * 100, page * 100),
      };
    } else if (endpoint === `${api}/pulls/400`) {
      kind = "pr";
      response = {
        number: 400,
        state: "open",
        merged: false,
        head: { sha, ref: task.contract.branch, repo: { full_name: REPO } },
        base: { repo: { full_name: REPO } },
      };
    } else {
      throw new Error(`Unexpected fixture request: ${endpoint}`);
    }
    return hooks[kind]
      ? hooks[kind](structuredClone(response), endpoint)
      : structuredClone(response);
  };
  const input = { task, attempt, receipt, source, policy, request };
  return { ...input, input, sha, checks, statuses, hooks, calls };
}

async function outcome(f, status, reason) {
  const result = await verifySupervisorReceipt(f.input);
  assert.equal(result.status, status, JSON.stringify(result));
  if (reason) assert.equal(result.reason, reason);
  if (status !== "verified") {
    assert.equal(result.evidence, undefined);
    assert.equal(result.checkpoint, undefined);
  }
  return result;
}

test("verifies independently fetched source, exact commit, branch, scope and successful CI", async () => {
  const f = fixture({ withPr: true });
  f.receipt.commands_run = ["SECRET_TOKEN=must-never-reappear arbitrary worker command"];
  const snapshot = JSON.stringify({
    task: f.task,
    attempt: f.attempt,
    receipt: f.receipt,
    policy: f.policy,
  });
  const result = await outcome(f, "verified", "independent_evidence_verified");
  assert.equal(result.evidence.sha, CURRENT);
  assert.equal(result.evidence.pr_url, `https://github.com/${REPO}/pull/400`);
  assert.equal(result.evidence.receipt_url, RECEIPT_URL);
  assert.match(result.evidence.receipt_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.checkpoint.files_changed, [FILE]);
  assert.deepEqual(result.checkpoint.required_checks_verified, ["supervisor-tests"]);
  assert.doesNotMatch(
    JSON.stringify(result),
    /SECRET_TOKEN|must-never-reappear|reported-by-worker-only/,
  );
  assert.equal(
    JSON.stringify({ task: f.task, attempt: f.attempt, receipt: f.receipt, policy: f.policy }),
    snapshot,
  );
  assert.equal(f.calls.filter(({ endpoint }) => endpoint.includes("/git/ref/")).length, 2);
  assert.equal(f.calls.filter(({ endpoint }) => endpoint.includes("/pulls/")).length, 2);
});

test("read-only receipts require an unchanged exact base and successful independent baseline CI", async () => {
  const f = fixture({ readOnly: true });
  const result = await outcome(f, "verified");
  assert.equal(result.checkpoint.current_sha, BASE);
  assert.deepEqual(result.checkpoint.files_changed, []);
  assert.ok(!f.calls.some(({ endpoint }) => endpoint.includes("/compare/")));
});

test("read-only baseline with missing expected CI remains pending despite reported tests", async () => {
  const f = fixture({ readOnly: true });
  f.checks.length = 0;
  await outcome(f, "pending", "required_check_missing");
});

test("a missing verification policy cannot be green by default", async () => {
  for (const readOnly of [true, false]) {
    const f = fixture({ readOnly });
    f.policy.required_checks = [];
    await outcome(f, "blocked", "verification_policy_missing_checks");
  }
});

test("read-only checks cannot waive a changed commit", async () => {
  const f = fixture();
  f.task.contract.read_only = true;
  await outcome(f, "blocked", "readonly_commit_changed");
});

for (const [field, value, reason] of [
  ["task_id", "another-task", "receipt_task_mismatch"],
  ["attempt_id", "another-attempt", "receipt_attempt_mismatch"],
  ["worker_id", "unregistered-worker", "receipt_attempt_mismatch"],
  ["contract_sha256", "f".repeat(64), "receipt_contract_mismatch"],
  ["dispatch_fingerprint", "f".repeat(64), "receipt_fingerprint_mismatch"],
  ["base_sha", "f".repeat(40), "receipt_base_mismatch"],
]) {
  test(`blocks a receipt whose ${field} does not match its admitted attempt`, async () => {
    const f = fixture();
    f.receipt[field] = value;
    await outcome(f, "blocked", reason);
    assert.equal(f.calls.length, 0);
  });
}

test("rejects abbreviated SHAs and legacy receipt schemas", async () => {
  const f = fixture();
  f.receipt.current_sha = CURRENT.slice(0, 7);
  await outcome(f, "blocked", "receipt_commit_invalid");
  f.receipt.current_sha = CURRENT;
  f.receipt.schema = "governance-worker-receipt-v1";
  await outcome(f, "blocked", "receipt_schema_mismatch");
  assert.equal(f.calls.length, 0);
});

for (const [field, value] of [
  ["author", "attacker"],
  ["channel", "untrusted_chat"],
  ["receipt_url", `https://github.com/${REPO}/issues/3410#issuecomment-123`],
  [
    "receipt_url",
    "https://github.com.evil.example/mikevazquez/Demeter/issues/341#issuecomment-123",
  ],
  ["receipt_url", `${RECEIPT_URL.split("#")[0]}?token=secret#issuecomment-123`],
]) {
  test(`blocks non-allowlisted provenance: ${field} ${value}`, async () => {
    const f = fixture();
    f.source[field] = value;
    await outcome(f, "blocked");
    assert.equal(f.calls.length, 0);
  });
}

test("an allowed envelope cannot spoof the actual GitHub comment author", async () => {
  const f = fixture();
  f.hooks.comment = (response) => ({ ...response, user: { login: "attacker" } });
  await outcome(f, "blocked", "receipt_comment_source_mismatch");
  assert.equal(f.calls.length, 1);
});

test("changed or ambiguous GitHub comment bodies do not verify a previously parsed receipt", async () => {
  const f = fixture();
  f.hooks.comment = (response) => ({
    ...response,
    body: upperBody({ ...f.receipt, commands_run: ["different report"] }),
  });
  await outcome(f, "blocked", "receipt_comment_changed");
  f.hooks.comment = (response) => ({
    ...response,
    body: `${upperBody(f.receipt)}\n${lowerBody(f.receipt)}`,
  });
  await outcome(f, "blocked", "ambiguous_receipt_body");
});

test("blocked, failed or incomplete reports never become verified", async () => {
  for (const status of ["blocked", "failed"]) {
    const f = fixture();
    f.receipt.status = status;
    await outcome(f, "blocked", `worker_reported_${status}`);
  }
  for (const field of ["blockers", "remaining_work"]) {
    const f = fixture();
    f.receipt[field] = ["still unresolved"];
    await outcome(f, "blocked", "receipt_incomplete");
  }
});

test("a moved remote branch invalidates the receipt before looking at CI", async () => {
  const f = fixture();
  f.hooks.ref = (response) => ({
    ...response,
    object: { ...response.object, sha: "f".repeat(40) },
  });
  await outcome(f, "blocked", "branch_head_changed");
  assert.ok(!f.calls.some(({ endpoint }) => endpoint.includes("/check-runs")));
});

test("a branch moved while evidence was being checked invalidates the snapshot", async () => {
  const f = fixture();
  let reads = 0;
  f.hooks.ref = (response) =>
    ++reads === 1 ? response : { ...response, object: { ...response.object, sha: BASE } };
  await outcome(f, "blocked", "branch_head_changed");
  assert.equal(reads, 2);
  assert.ok(f.calls.some(({ endpoint }) => endpoint.includes("/check-runs")));
});

test("the GitHub commit object must prove the requested full SHA exists", async () => {
  const f = fixture();
  f.hooks.commit = (response) => ({ ...response, sha: BASE });
  await outcome(f, "blocked", "commit_evidence_invalid");
});

test("current commit must descend from the admitted base without divergence", async () => {
  for (const changed of [
    { merge_base_commit: { sha: "f".repeat(40) } },
    { base_commit: { sha: CURRENT } },
    { status: "diverged", behind_by: 1 },
    { ahead_by: 0 },
  ]) {
    const f = fixture();
    f.hooks.compare = (response) => ({ ...response, ...changed });
    await outcome(f, "blocked", "commit_not_descendant");
  }
});

test("scope checks use actual remote files, including outside paths and prefix lookalikes", async () => {
  for (const filename of [
    "src/app/page.tsx",
    "scripts/automation-extra/run.mjs",
    "docs/automation/review.md.bak",
  ]) {
    const f = fixture();
    f.hooks.compare = (response) => ({ ...response, files: [{ filename, status: "modified" }] });
    await outcome(f, "blocked", "diff_outside_allowed_paths");
  }
});

test("renaming a file from outside the allowed scope is also blocked", async () => {
  const f = fixture();
  f.hooks.compare = (response) => ({
    ...response,
    files: [{ filename: FILE, previous_filename: "src/secret.ts", status: "renamed" }],
  });
  await outcome(f, "blocked", "diff_outside_allowed_paths");
});

test("literal files, slash prefixes and trailing double-star prefixes are supported safely", async () => {
  const f = fixture();
  f.receipt.files_changed = ["tests/automation/review.node.mjs", "docs/automation/review.md"];
  f.hooks.compare = (response) => ({
    ...response,
    files: f.receipt.files_changed.map((filename) => ({ filename, status: "added" })),
  });
  await outcome(f, "verified");
  for (const rule of [
    "**",
    "scripts/*.mjs",
    "scripts/../src/",
    "/scripts/",
    "scripts\\automation\\",
  ]) {
    const invalid = fixture();
    invalid.task.contract.allowed_paths = [rule];
    await outcome(invalid, "blocked", "allowed_paths_invalid");
    assert.equal(invalid.calls.length, 0);
  }
});

test("a worker file list must exactly match the remote diff", async () => {
  const f = fixture();
  f.receipt.files_changed = [];
  await outcome(f, "blocked", "receipt_files_mismatch");
});

test("comparison at the GitHub 300-file truncation boundary is blocked", async () => {
  const f = fixture();
  f.policy.max_changed_files = 299;
  f.hooks.compare = (response) => ({
    ...response,
    files: Array.from({ length: 300 }, (_, index) => ({
      filename: `scripts/automation/${index}.mjs`,
      status: "added",
    })),
  });
  await outcome(f, "blocked", "diff_incomplete_or_too_large");
});

test("a per-task file limit is enforced even within allowed directories", async () => {
  const f = fixture();
  f.policy.max_changed_files = 0;
  await outcome(f, "blocked", "diff_scope_limit_exceeded");
});

test("a green check from a different commit is blocked", async () => {
  const f = fixture();
  f.checks[0].head_sha = BASE;
  await outcome(f, "blocked", "ci_sha_mismatch");
  f.checks[0].head_sha = CURRENT;
  f.checks[0].check_suite = { head_sha: BASE };
  await outcome(f, "blocked", "ci_sha_mismatch");
});

test("self-reported tests cannot replace missing CI", async () => {
  const f = fixture();
  f.checks.length = 0;
  f.receipt.tests_passed = ["all tests passed, trust me"];
  await outcome(f, "pending", "required_check_missing");
});

test("a check with the expected name from an unexpected app cannot verify", async () => {
  const f = fixture();
  f.checks[0].app.slug = "untrusted-app";
  await outcome(f, "pending", "required_check_missing");
  f.checks[0].app.slug = "github-actions";
  f.policy.required_checks[0].app_id = 99999;
  await outcome(f, "pending", "required_check_missing");
});

test("newer queued or failed checks override older successful checks at the same SHA", async () => {
  const f = fixture();
  f.checks.push({ ...f.checks[0], id: 11, status: "in_progress", conclusion: null });
  await outcome(f, "pending", "required_check_pending");
  f.checks[1].status = "completed";
  f.checks[1].conclusion = "failure";
  await outcome(f, "blocked", "required_check_failed");
});

test("neutral, skipped, cancelled and failed CI conclusions are not success", async () => {
  for (const conclusion of ["neutral", "skipped", "cancelled", "timed_out", "failure", null]) {
    const f = fixture();
    f.checks[0].conclusion = conclusion;
    await outcome(f, "blocked", "required_check_failed");
  }
});

test("status contexts require an explicitly pinned producer and exact combined SHA", async () => {
  const f = fixture();
  f.policy.required_checks = [{ name: "baseline", kind: "status", creator: "trusted-ci" }];
  f.statuses.push({
    id: 20,
    context: "baseline",
    state: "success",
    creator: { login: "trusted-ci" },
  });
  await outcome(f, "verified");
  f.hooks.statuses = (response) => ({ ...response, sha: BASE });
  await outcome(f, "blocked", "ci_sha_mismatch");
  delete f.hooks.statuses;
  f.statuses[0].creator.login = "untrusted-ci";
  await outcome(f, "pending", "required_check_missing");
  delete f.policy.required_checks[0].creator;
  await outcome(f, "blocked", "status_producer_policy_missing");
});

test("all contract and policy check requirements apply; one cannot override the other", async () => {
  const f = fixture();
  f.task.contract.required_checks = ["security-check"];
  await outcome(f, "pending", "required_check_missing");
  f.checks.push({ ...f.checks[0], id: 11, name: "security-check" });
  const result = await outcome(f, "verified");
  assert.deepEqual(result.checkpoint.required_checks_verified, [
    "supervisor-tests",
    "security-check",
  ]);
});

test("malformed check policy is blocked before making provider requests", async () => {
  const f = fixture();
  f.policy.required_checks = 123;
  await outcome(f, "blocked", "checks_policy_invalid");
  assert.equal(f.calls.length, 0);
});

test("CI pagination is complete before the expected check can pass", async () => {
  const f = fixture();
  const wanted = f.checks[0];
  f.checks.splice(
    0,
    1,
    ...Array.from({ length: 100 }, (_, index) => ({
      ...wanted,
      id: 1000 + index,
      name: `other-${index}`,
    })),
    wanted,
  );
  await outcome(f, "verified");
  assert.equal(f.calls.filter(({ endpoint }) => endpoint.includes("/check-runs")).length, 2);
  f.hooks.checks = (response, endpoint) =>
    endpoint.endsWith("page=2") ? { ...response, total_count: 102 } : response;
  await outcome(f, "pending", "ci_changed_during_read");
});

test("an incomplete CI response cannot be mistaken for the complete list", async () => {
  const f = fixture();
  f.hooks.checks = (response) => ({ ...response, total_count: 2 });
  await outcome(f, "pending", "ci_response_incomplete");
});

test("optional PR evidence must match the same repository, branch and exact SHA", async () => {
  for (const head of [
    { sha: BASE },
    { ref: "main" },
    { repo: { full_name: "attacker/Demeter" } },
  ]) {
    const f = fixture({ withPr: true });
    f.hooks.pr = (response) => ({ ...response, head: { ...response.head, ...head } });
    await outcome(f, "blocked", "pr_head_mismatch");
  }
  const f = fixture();
  f.policy.require_pr = true;
  await outcome(f, "pending", "required_pr_missing");
});

test("untrusted CI URLs are replaced with the verified commit checks link", async () => {
  const f = fixture();
  f.checks[0].html_url = "https://attacker.example/collect?token=secret";
  const result = await outcome(f, "verified");
  assert.equal(result.evidence.ci_url, `https://github.com/${REPO}/commit/${CURRENT}/checks`);
  assert.doesNotMatch(JSON.stringify(result), /attacker|token=secret/);
});

test("provider failures return pending without exposing exception secrets", async () => {
  const f = fixture();
  f.hooks.checks = () => {
    throw new Error("request failed: authorization=SECRET_TOKEN");
  };
  const result = await outcome(f, "pending", "evidence_unavailable");
  assert.deepEqual(result, { status: "pending", reason: "evidence_unavailable" });
});

test("receipt parser supports both marker formats and raw schema v2 JSON", () => {
  const f = fixture();
  for (const body of [lowerBody(f.receipt), upperBody(f.receipt), JSON.stringify(f.receipt)]) {
    const parsed = parseSupervisorReceipts([
      { id: 123, body, user: { login: "mikevazquez" }, html_url: RECEIPT_URL },
    ]);
    assert.equal(parsed.length, 1);
    assert.deepEqual(parsed[0].receipt, f.receipt);
    assert.deepEqual(parsed[0].source, f.source);
  }
  assert.deepEqual(
    parseSupervisorReceipts([
      { body: "GOVERNANCE_WORKER_RECEIPT_V1\n```json\n{}\n```" },
      { body: '{"unrelated":true}' },
      { body: "ordinary progress" },
    ]),
    [],
  );
});

test("the actual Claude Routine footer is accepted without accepting a second JSON block", async () => {
  const f = fixture();
  const footer = "\n\n---\n_Generated by [Claude Code](https://claude.ai/code)_";
  f.hooks.comment = (response) => ({ ...response, body: `${upperBody(f.receipt)}${footer}` });
  await outcome(f, "verified");
  f.hooks.comment = (response) => ({
    ...response,
    body: `${upperBody(f.receipt)}\n\n\`\`\`json\n{}\n\`\`\``,
  });
  await outcome(f, "blocked", "ambiguous_receipt_body");
});

test("exact duplicate receipts collapse; conflicting same-attempt receipts are rejected", () => {
  const f = fixture();
  const comment = {
    id: 123,
    body: upperBody(f.receipt),
    user: { login: "mikevazquez" },
    html_url: RECEIPT_URL,
  };
  const reordered = Object.fromEntries(Object.entries(f.receipt).reverse());
  assert.equal(
    parseSupervisorReceipts([comment, { ...comment, id: 124, body: lowerBody(reordered) }]).length,
    1,
  );
  assert.throws(
    () =>
      parseSupervisorReceipts([
        comment,
        { ...comment, body: upperBody({ ...f.receipt, status: "failed" }) },
      ]),
    /ambiguous_receipts/,
  );
  assert.throws(
    () => parseSupervisorReceipts([{ ...comment, body: `${comment.body}\n${comment.body}` }]),
    /ambiguous_receipt_body/,
  );
});

test("oversized, nested or non-JSON receipt values are rejected without running a getter", async () => {
  const f = fixture();
  f.receipt.commands_run = ["x".repeat(2049)];
  await outcome(f, "blocked", "receipt_list_invalid");
  f.receipt.commands_run = [];
  let invoked = false;
  Object.defineProperty(f.receipt, "secret", {
    enumerable: true,
    get() {
      invoked = true;
      return "never";
    },
  });
  await outcome(f, "blocked", "invalid_receipt_json");
  assert.equal(invoked, false);
});
