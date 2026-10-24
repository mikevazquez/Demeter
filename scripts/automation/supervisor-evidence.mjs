// Independent, GET-only evidence checks. Never executes candidate code or worker commands.
import { createHash } from "node:crypto";

const SCHEMA = "governance-worker-receipt-v2";
const SHA = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const MAX_RECEIPT_BYTES = 128 * 1024;
const MAX_DIFF_FILES = 299; // GitHub compare can omit files starting at its 300-file limit.

class EvidenceError extends Error {
  constructor(reason, status = "blocked") {
    super(reason);
    this.reason = reason;
    this.resultStatus = status;
  }
}

const ensure = (value, reason, status) => {
  if (!value) throw new EvidenceError(reason, status);
};
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value, max = 2048) =>
  typeof value === "string" && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);

function jsonCopy(value, depth = 0) {
  ensure(depth <= 20, "invalid_receipt_json");
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    ensure(Number.isFinite(value), "invalid_receipt_json");
    return value;
  }
  ensure(object(value) || Array.isArray(value), "invalid_receipt_json");
  ensure(Object.getOwnPropertySymbols(value).length === 0, "invalid_receipt_json");
  ensure(
    Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype,
    "invalid_receipt_json",
  );
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Array.isArray(value)) {
    ensure(
      value.length <= 1000 && Object.keys(descriptors).length === value.length + 1,
      "invalid_receipt_json",
    );
    return Array.from({ length: value.length }, (_, index) => {
      const descriptor = descriptors[index];
      ensure(descriptor && "value" in descriptor && descriptor.enumerable, "invalid_receipt_json");
      return jsonCopy(descriptor.value, depth + 1);
    });
  }
  ensure(Object.keys(descriptors).length <= 100, "invalid_receipt_json");
  const result = Object.create(null);
  for (const name of Object.keys(descriptors).sort()) {
    const descriptor = descriptors[name];
    ensure("value" in descriptor && descriptor.enumerable, "invalid_receipt_json");
    result[name] = jsonCopy(descriptor.value, depth + 1);
  }
  return result;
}

function canonicalReceipt(value) {
  const result = JSON.stringify(jsonCopy(value));
  ensure(Buffer.byteLength(result) <= MAX_RECEIPT_BYTES, "receipt_too_large");
  return result;
}

function validateReceipt(receipt) {
  canonicalReceipt(receipt);
  ensure(object(receipt) && receipt.schema === SCHEMA, "receipt_schema_mismatch");
  for (const name of ["task_id", "attempt_id", "worker_id"])
    ensure(ID.test(receipt[name] ?? ""), "receipt_identity_invalid");
  for (const name of ["contract_sha256", "dispatch_fingerprint"])
    ensure(SHA256.test(receipt[name] ?? ""), "receipt_digest_invalid");
  for (const name of ["base_sha", "current_sha"])
    ensure(SHA.test(receipt[name] ?? ""), "receipt_commit_invalid");
  ensure(["completed", "blocked", "failed"].includes(receipt.status), "receipt_status_invalid");
  for (const name of [
    "files_changed",
    "commands_run",
    "tests_passed",
    "blockers",
    "remaining_work",
  ]) {
    ensure(
      Array.isArray(receipt[name]) &&
        receipt[name].length <= 300 &&
        receipt[name].every((entry) => text(entry)),
      "receipt_list_invalid",
    );
  }
  ensure(receipt.next_action === null || text(receipt.next_action), "receipt_next_action_invalid");
  return receipt;
}

function parseReceiptBody(body) {
  ensure(
    typeof body === "string" && Buffer.byteLength(body) <= MAX_RECEIPT_BYTES,
    "receipt_body_invalid",
  );
  const lower = [...body.matchAll(/```governance-worker-receipt-v2\s*\r?\n([\s\S]*?)\r?\n```/g)];
  const upper = [...body.matchAll(/\bGOVERNANCE_WORKER_RECEIPT_V2\b/g)];
  ensure(lower.length + upper.length <= 1, "ambiguous_receipt_body");
  let raw;
  if (lower.length === 1) raw = lower[0][1].trim();
  else if (upper.length === 1) {
    const following = body.slice(upper[0].index + upper[0][0].length).trim();
    const fenced = following.match(/^```(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n```([\s\S]*)$/);
    // The Routine bridge appends its generated-by Markdown footer. It is not receipt data.
    if (fenced)
      ensure(fenced[2].length <= 2048 && !/```|[{}]/.test(fenced[2]), "ambiguous_receipt_body");
    raw = (fenced?.[1] ?? following).trim();
  } else if (body.trim().startsWith("{")) raw = body.trim();
  else return null;
  let receipt;
  try {
    receipt = JSON.parse(raw);
  } catch {
    throw new EvidenceError("receipt_json_invalid");
  }
  if (!lower.length && !upper.length && receipt?.schema !== SCHEMA) return null;
  return validateReceipt(receipt);
}

/** Parse authenticated GitHub comment envelopes; conflicting receipts never use last-wins. */
export function parseSupervisorReceipts(comments) {
  ensure(Array.isArray(comments) && comments.length <= 1000, "receipt_comments_invalid");
  const found = new Map();
  for (const comment of comments) {
    const receipt = parseReceiptBody(comment?.body ?? "");
    if (!receipt) continue;
    const source = {
      author: comment.user?.login,
      channel: "github_issue_comment",
      receipt_url: comment.html_url,
    };
    const identity = JSON.stringify([source.author, receipt.task_id, receipt.attempt_id]);
    const previous = found.get(identity);
    if (previous) {
      ensure(
        canonicalReceipt(previous.receipt) === canonicalReceipt(receipt),
        "ambiguous_receipts",
      );
      continue;
    }
    found.set(identity, { receipt, source, comment_id: comment.id ?? null });
  }
  return [...found.values()];
}

function httpsUrl(value) {
  ensure(text(value) && value.length > 0 && !/\s/.test(value), "source_url_invalid");
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new EvidenceError("source_url_invalid");
  }
  ensure(
    url.protocol === "https:" &&
      ["github.com", "api.github.com", "claude.ai"].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.search,
    "source_url_invalid",
  );
  return url;
}

function sourceAllowed(source, policy, workerId) {
  ensure(
    object(source) &&
      text(source.author, 128) &&
      source.author.length &&
      text(source.channel, 128) &&
      source.channel.length,
    "source_identity_invalid",
  );
  const actual = httpsUrl(source.receipt_url);
  ensure(
    Array.isArray(policy.allowed_sources) &&
      policy.allowed_sources.length > 0 &&
      policy.allowed_sources.length <= 50,
    "source_policy_missing",
  );
  const allowed = policy.allowed_sources.some((entry) => {
    if (
      entry?.author !== source.author ||
      entry.channel !== source.channel ||
      (entry.worker_id && entry.worker_id !== workerId)
    )
      return false;
    if (entry.receipt_url) return httpsUrl(entry.receipt_url).href === actual.href;
    if (!entry.receipt_url_prefix) return false;
    const prefix = httpsUrl(entry.receipt_url_prefix);
    if (prefix.origin !== actual.origin) return false;
    if (prefix.hash)
      return prefix.pathname === actual.pathname && actual.hash.startsWith(prefix.hash);
    return prefix.pathname.endsWith("/")
      ? actual.pathname.startsWith(prefix.pathname)
      : actual.pathname === prefix.pathname;
  });
  ensure(allowed, "receipt_source_not_allowed");
  return actual;
}

function safePath(path) {
  return (
    text(path, 1024) &&
    path.length > 0 &&
    !path.startsWith("/") &&
    !path.endsWith("/") &&
    !/[\\*]/.test(path) &&
    !path.split("/").some((part) => !part || part === "." || part === "..")
  );
}

function pathRules(paths) {
  ensure(Array.isArray(paths) && paths.length <= 100, "allowed_paths_invalid");
  return paths.map((path) => {
    ensure(typeof path === "string", "allowed_paths_invalid");
    const prefix = path.endsWith("/**")
      ? path.slice(0, -3)
      : path.endsWith("/")
        ? path.slice(0, -1)
        : null;
    ensure(safePath(prefix ?? path), "allowed_paths_invalid");
    return { path: prefix ?? path, prefix: prefix !== null };
  });
}

function checkRules(task, policy) {
  ensure(
    Array.isArray(policy.required_checks ?? []) &&
      Array.isArray(task.contract.required_checks ?? []),
    "checks_policy_invalid",
  );
  const rules = [...(policy.required_checks ?? []), ...(task.contract.required_checks ?? [])];
  ensure(rules.length <= 100, "checks_policy_invalid");
  const normalized = rules.map((rule) => {
    const value = typeof rule === "string" ? { name: rule } : rule;
    ensure(
      object(value) && text(value.name, 160) && value.name.length > 0,
      "checks_policy_invalid",
    );
    const kind = value.kind ?? "check";
    ensure(["check", "status"].includes(kind), "checks_policy_invalid");
    if (kind === "check") {
      const appSlug = value.app_slug ?? "github-actions";
      ensure(
        text(appSlug, 100) &&
          appSlug.length &&
          (value.app_id === undefined || (Number.isSafeInteger(value.app_id) && value.app_id > 0)),
        "checks_policy_invalid",
      );
      return {
        name: value.name,
        kind,
        app_slug: appSlug,
        ...(value.app_id === undefined ? {} : { app_id: value.app_id }),
      };
    }
    const creators = value.creator ? [value.creator] : policy.allowed_status_creators;
    ensure(
      Array.isArray(creators) &&
        creators.length > 0 &&
        creators.length <= 20 &&
        creators.every((entry) => text(entry, 128) && entry.length),
      "status_producer_policy_missing",
    );
    return { name: value.name, kind, creators: [...new Set(creators)] };
  });
  return [...new Map(normalized.map((rule) => [JSON.stringify(rule), rule])).values()];
}

function validateInput(task, attempt, receipt, policy) {
  ensure(
    object(task) && object(task.contract) && object(attempt) && object(policy),
    "verification_input_invalid",
  );
  validateReceipt(receipt);
  ensure(
    ID.test(task.task_id ?? "") &&
      task.task_id === receipt.task_id &&
      (task.contract.task_id === undefined || task.contract.task_id === task.task_id),
    "receipt_task_mismatch",
  );
  ensure(
    attempt.attempt_id === receipt.attempt_id && attempt.worker_id === receipt.worker_id,
    "receipt_attempt_mismatch",
  );
  ensure(
    SHA256.test(task.contract_sha256 ?? "") &&
      attempt.contract_sha256 === task.contract_sha256 &&
      receipt.contract_sha256 === task.contract_sha256,
    "receipt_contract_mismatch",
  );
  ensure(
    SHA256.test(attempt.dispatch_fingerprint ?? "") &&
      receipt.dispatch_fingerprint === attempt.dispatch_fingerprint,
    "receipt_fingerprint_mismatch",
  );
  const contract = task.contract;
  ensure(
    SHA.test(contract.base_sha ?? "") &&
      receipt.base_sha === contract.base_sha &&
      (attempt.base_sha === undefined || attempt.base_sha === contract.base_sha),
    "receipt_base_mismatch",
  );
  ensure(
    typeof contract.repo === "string" &&
      /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}\/[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(contract.repo),
    "repository_invalid",
  );
  ensure(
    text(contract.branch, 240) &&
      safePath(contract.branch) &&
      !/[~^:?\[\]\s]/.test(contract.branch) &&
      !contract.branch.includes("..") &&
      !contract.branch.includes("@{") &&
      !contract.branch.endsWith(".lock"),
    "branch_invalid",
  );
  if (policy.repositories)
    ensure(
      Array.isArray(policy.repositories) && policy.repositories.includes(contract.repo),
      "repository_not_allowed",
    );
  const paths = pathRules(contract.allowed_paths);
  ensure(
    new Set(receipt.files_changed).size === receipt.files_changed.length &&
      receipt.files_changed.every(safePath),
    "receipt_files_invalid",
  );
  return { contract, paths, rules: checkRules(task, policy) };
}

async function verifySource({ source, url, receipt, request, repository }) {
  if (source.channel === "github_actions_run") {
    const prefix = `/${repository}/actions/runs/`;
    ensure(
      url.hostname === "github.com" &&
        url.pathname.startsWith(prefix) &&
        /^\d+$/.test(url.pathname.slice(prefix.length)) &&
        !url.hash,
      "receipt_run_url_invalid",
    );
    const id = url.pathname.slice(prefix.length);
    const remote = await request("GET", `repos/${repository}/actions/runs/${id}`);
    ensure(
      String(remote?.id) === id &&
        remote.html_url === url.href &&
        remote.repository?.full_name === repository &&
        remote.name === "Governance Supervisor" &&
        remote.head_branch === "main" &&
        ["schedule", "workflow_dispatch"].includes(remote.event) &&
        remote.status === "completed" &&
        remote.conclusion === "success",
      "receipt_run_source_mismatch",
    );
    return;
  }
  if (source.channel !== "github_issue_comment") return;
  const prefix = `/${repository}/issues/`;
  ensure(
    url.hostname === "github.com" &&
      url.pathname.startsWith(prefix) &&
      /^\d+$/.test(url.pathname.slice(prefix.length)) &&
      /^#issuecomment-\d+$/.test(url.hash),
    "receipt_comment_url_invalid",
  );
  const id = url.hash.slice("#issuecomment-".length);
  const remote = await request("GET", `repos/${repository}/issues/comments/${id}`);
  ensure(
    String(remote?.id) === id &&
      remote.user?.login === source.author &&
      remote.html_url === url.href,
    "receipt_comment_source_mismatch",
  );
  const parsed = parseReceiptBody(remote.body);
  ensure(
    parsed && canonicalReceipt(parsed) === canonicalReceipt(receipt),
    "receipt_comment_changed",
  );
}

async function paginated(request, endpoint, arrayKey, expectedSha, maxRecords) {
  const collected = [];
  const ids = new Set();
  let total;
  for (let page = 1; page <= Math.ceil(maxRecords / 100) + 1; page++) {
    const response = await request(
      "GET",
      `${endpoint}${endpoint.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
    );
    ensure(
      object(response) &&
        Number.isSafeInteger(response.total_count) &&
        response.total_count >= 0 &&
        response.total_count <= maxRecords &&
        Array.isArray(response[arrayKey]) &&
        response[arrayKey].length <= 100,
      "ci_response_invalid",
    );
    if (arrayKey === "statuses") ensure(response.sha === expectedSha, "ci_sha_mismatch");
    if (total === undefined) total = response.total_count;
    ensure(total === response.total_count, "ci_changed_during_read", "pending");
    for (const entry of response[arrayKey]) {
      ensure(
        object(entry) && Number.isSafeInteger(entry.id) && entry.id > 0 && !ids.has(entry.id),
        "ci_response_invalid",
      );
      if (arrayKey === "check_runs")
        ensure(
          entry.head_sha === expectedSha &&
            (entry.check_suite?.head_sha === undefined ||
              entry.check_suite.head_sha === expectedSha),
          "ci_sha_mismatch",
        );
      else ensure(entry.sha === undefined || entry.sha === expectedSha, "ci_sha_mismatch");
      ids.add(entry.id);
      collected.push(entry);
    }
    ensure(collected.length <= total, "ci_response_invalid");
    if (collected.length === total) return collected;
    ensure(response[arrayKey].length === 100, "ci_response_incomplete", "pending");
  }
  throw new EvidenceError("ci_response_incomplete", "pending");
}

function evidenceUrl(candidate, repo, fallback) {
  try {
    const url = httpsUrl(candidate);
    if (url.hostname === "github.com" && url.pathname.startsWith(`/${repo}/`)) return url.href;
  } catch {
    /* Never reflect an untrusted provider URL. */
  }
  return fallback;
}

async function verifyChecks({ request, api, repo, sha, rules, policy }) {
  if (!rules.length) return [];
  const maxRecords = policy.max_ci_records ?? 500;
  ensure(
    Number.isSafeInteger(maxRecords) && maxRecords > 0 && maxRecords <= 1000,
    "checks_policy_invalid",
  );
  const [checks, statuses] = await Promise.all([
    rules.some((rule) => rule.kind === "check")
      ? paginated(
          request,
          `${api}/commits/${sha}/check-runs?filter=latest`,
          "check_runs",
          sha,
          maxRecords,
        )
      : [],
    rules.some((rule) => rule.kind === "status")
      ? paginated(request, `${api}/commits/${sha}/status`, "statuses", sha, maxRecords)
      : [],
  ]);
  const verified = [];
  for (const rule of rules) {
    const matching =
      rule.kind === "check"
        ? checks.filter(
            (entry) =>
              entry.name === rule.name &&
              entry.app?.slug === rule.app_slug &&
              (rule.app_id === undefined || entry.app.id === rule.app_id),
          )
        : statuses.filter(
            (entry) => entry.context === rule.name && rule.creators.includes(entry.creator?.login),
          );
    matching.sort((left, right) => right.id - left.id);
    const latest = matching[0];
    ensure(latest, "required_check_missing", "pending");
    if (rule.kind === "check") {
      ensure(
        ["queued", "in_progress", "completed", "waiting", "requested", "pending"].includes(
          latest.status,
        ),
        "ci_response_invalid",
      );
      ensure(latest.status === "completed", "required_check_pending", "pending");
      ensure(latest.conclusion === "success", "required_check_failed");
    } else {
      ensure(
        ["success", "failure", "error", "pending"].includes(latest.state),
        "ci_response_invalid",
      );
      ensure(latest.state !== "pending", "required_check_pending", "pending");
      ensure(latest.state === "success", "required_check_failed");
    }
    verified.push({
      name: rule.name,
      kind: rule.kind,
      id: latest.id,
      url: evidenceUrl(
        latest.html_url ?? latest.details_url ?? latest.target_url,
        repo,
        `https://github.com/${repo}/commit/${sha}/checks`,
      ),
    });
  }
  return verified;
}

/** Trust boundary: task/attempt/policy and non-comment source provenance belong to the supervisor. */
export async function verifySupervisorReceipt({
  task,
  attempt,
  receipt,
  source,
  request,
  policy,
} = {}) {
  try {
    const { contract, paths, rules } = validateInput(task, attempt, receipt, policy);
    ensure(typeof request === "function", "request_adapter_missing");
    const receiptUrl = sourceAllowed(source, policy, attempt.worker_id);
    await verifySource({ source, url: receiptUrl, receipt, request, repository: contract.repo });
    if (receipt.status !== "completed")
      return { status: "blocked", reason: `worker_reported_${receipt.status}` };
    ensure(
      receipt.blockers.length === 0 && receipt.remaining_work.length === 0,
      "receipt_incomplete",
    );
    const readOnly = contract.read_only === true;
    ensure(!readOnly || receipt.current_sha === contract.base_sha, "readonly_commit_changed");
    ensure(
      rules.length > 0 || (readOnly && policy.require_baseline_ci === false),
      "verification_policy_missing_checks",
    );
    const api = `repos/${contract.repo}`;
    const sha = receipt.current_sha;
    const refPath = `${api}/git/ref/heads/${contract.branch.split("/").map(encodeURIComponent).join("/")}`;
    async function verifyHead() {
      const ref = await request("GET", refPath);
      ensure(
        ref?.ref === `refs/heads/${contract.branch}` &&
          ref.object?.type === "commit" &&
          ref.object.sha === sha,
        "branch_head_changed",
      );
    }
    await verifyHead();
    const commit = await request("GET", `${api}/git/commits/${sha}`);
    ensure(commit?.sha === sha && SHA.test(commit.tree?.sha ?? ""), "commit_evidence_invalid");
    let files = [];
    if (sha !== contract.base_sha) {
      const compare = await request("GET", `${api}/compare/${contract.base_sha}...${sha}`);
      ensure(
        compare?.base_commit?.sha === contract.base_sha &&
          compare.merge_base_commit?.sha === contract.base_sha &&
          compare.status === "ahead" &&
          compare.behind_by === 0 &&
          Number.isSafeInteger(compare.ahead_by) &&
          compare.ahead_by > 0,
        "commit_not_descendant",
      );
      ensure(
        Array.isArray(compare.files) && compare.files.length <= MAX_DIFF_FILES,
        "diff_incomplete_or_too_large",
      );
      files = compare.files;
    }
    const maxFiles = policy.max_changed_files ?? 100;
    ensure(
      Number.isSafeInteger(maxFiles) && maxFiles >= 0 && maxFiles <= MAX_DIFF_FILES,
      "diff_policy_invalid",
    );
    ensure(files.length <= maxFiles, "diff_scope_limit_exceeded");
    const matches = (path) =>
      paths.some((rule) => (rule.prefix ? path.startsWith(`${rule.path}/`) : path === rule.path));
    const names = [];
    for (const file of files) {
      ensure(
        object(file) &&
          safePath(file.filename) &&
          ["added", "removed", "modified", "renamed", "copied", "changed", "unchanged"].includes(
            file.status,
          ),
        "diff_evidence_invalid",
      );
      ensure(matches(file.filename), "diff_outside_allowed_paths");
      if (file.status === "renamed")
        ensure(safePath(file.previous_filename), "diff_evidence_invalid");
      if (file.previous_filename !== undefined)
        ensure(
          safePath(file.previous_filename) && matches(file.previous_filename),
          "diff_outside_allowed_paths",
        );
      names.push(file.filename);
    }
    ensure(new Set(names).size === names.length, "diff_evidence_invalid");
    names.sort();
    ensure(
      JSON.stringify(names) === JSON.stringify([...receipt.files_changed].sort()),
      "receipt_files_mismatch",
    );

    const prNumber = contract.pr_number ?? task.pr_number;
    let prUrl = null;
    async function verifyPr() {
      if (prNumber === undefined || prNumber === null) {
        ensure(policy.require_pr !== true, "required_pr_missing", "pending");
        return;
      }
      ensure(Number.isSafeInteger(prNumber) && prNumber > 0, "pr_identity_invalid");
      const pr = await request("GET", `${api}/pulls/${prNumber}`);
      ensure(
        pr?.number === prNumber &&
          pr.head?.sha === sha &&
          pr.head.ref === contract.branch &&
          pr.head.repo?.full_name === contract.repo &&
          pr.base?.repo?.full_name === contract.repo,
        "pr_head_mismatch",
      );
      if (policy.require_open_pr === true)
        ensure(pr.state === "open" && pr.merged !== true, "pr_not_open");
      prUrl = `https://github.com/${contract.repo}/pull/${prNumber}`;
    }
    await verifyPr();
    const checks = await verifyChecks({ request, api, repo: contract.repo, sha, rules, policy });
    // A branch/PR change while checks are read invalidates this completion snapshot.
    await verifyHead();
    if (prNumber !== undefined && prNumber !== null) await verifyPr();
    const receiptDigest = createHash("sha256").update(canonicalReceipt(receipt)).digest("hex");
    return {
      status: "verified",
      reason: rules.length
        ? "independent_evidence_verified"
        : "readonly_commit_verified_without_ci",
      evidence: {
        sha,
        pr_url: prUrl,
        ci_url: checks[0]?.url ?? null,
        receipt_url: receiptUrl.href,
        receipt_sha256: receiptDigest,
        compare_url: `https://github.com/${contract.repo}/compare/${contract.base_sha}...${sha}`,
        checks,
      },
      checkpoint: {
        task_id: task.task_id,
        attempt_id: attempt.attempt_id,
        worker_id: attempt.worker_id,
        contract_sha256: task.contract_sha256,
        base_sha: contract.base_sha,
        current_sha: sha,
        files_changed: names,
        verification_status: "verified",
        required_checks_verified: checks.map((check) => check.name),
      },
    };
  } catch (error) {
    if (error instanceof EvidenceError) return { status: error.resultStatus, reason: error.reason };
    // API bodies and exception text can contain URLs, credentials or worker output.
    return { status: "pending", reason: "evidence_unavailable" };
  }
}
