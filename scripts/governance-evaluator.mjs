/** Pure decisions and append-only receipts. No network, shell, filesystem or credentials. */
import { createHash } from "node:crypto";

const HOUR = 3_600_000;
const ACTIVE = new Set(["queued", "pending", "waiting", "requested", "in_progress"]);
const TERMINAL = new Set(["credential", "permission", "quota", "scope", "authority"]);
const ERRORS = new Set([...TERMINAL, "timeout", "rate_limit", "server", "result"]);
const TYPES = new Set([
  "cycle",
  "failure",
  "retry_claim",
  "retry_result",
  "notice_claim",
  "notice_sent",
  "resolution",
  "execution_lease",
  "execution_outcome",
  "execution_reconciliation",
]);

export function invariant(condition, label) {
  if (!condition) throw new Error(`Invalid governance input: ${label}`);
}

export function canonical(value, depth = 0) {
  invariant(depth < 32, "JSON depth");
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    invariant(Number.isFinite(value), "finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonical(item, depth + 1)).join(",")}]`;
  }
  invariant(value && Object.getPrototypeOf(value) === Object.prototype, "plain JSON");
  const keys = Object.keys(value).sort();
  invariant(
    !keys.some((key) => ["__proto__", "constructor", "prototype"].includes(key)),
    "JSON key",
  );
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key], depth + 1)}`).join(",")}}`;
}

export function digest(value) {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function utc(value) {
  invariant(
    typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value),
    "UTC",
  );
  invariant(Number.isFinite(Date.parse(value)), "date");
  invariant(new Date(value).toISOString() === value, "calendar date");
  return Date.parse(value);
}

function id(value) {
  invariant(typeof value === "string" && /^[a-zA-Z0-9_.:/-]{1,160}$/.test(value), "identifier");
  invariant(!/^(sk-|ghp_|github_pat_)/.test(value), "credential-shaped identifier");
  return value;
}

function sha(value, length = 40) {
  invariant(typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(value), "SHA");
  return value;
}

function page(value) {
  invariant(typeof value === "string", "page ID");
  return sha(value.replaceAll("-", "").toLowerCase(), 32);
}

function array(value) {
  invariant(Array.isArray(value) && value.length <= 10000, "bounded array");
  return value;
}

function profileCheck(profile) {
  invariant(profile.version === 1, "profile version");
  id(profile.repository);
  id(profile.controlBranch);
  invariant(!["main", "master", "production"].includes(profile.controlBranch), "control branch");
  page(profile.source.pageId);
  invariant(Number.isFinite(Date.parse(profile.source.lastEditedAt)), "policy version");
  sha(profile.source.sha256, 64);
  const duration = utc(profile.source.expiresAt) - utc(profile.source.capturedAt);
  invariant(duration > 0 && duration <= 48 * HOUR, "48 hour snapshot bound");
  invariant(Number.isInteger(profile.maxTasksPerRun), "batch count");
  invariant(profile.maxTasksPerRun > 0 && profile.maxTasksPerRun <= 3, "batch limit");
  const tasks = array(profile.tasks);
  invariant(new Set(tasks.map((task) => task.id)).size === tasks.length, "duplicate task");
  invariant(
    new Set(tasks.map((task) => task.issueNumber)).size === tasks.length,
    "duplicate issue",
  );
  for (const task of tasks) {
    id(task.id);
    id(task.owner);
    sha(task.issueBodySha256, 64);
    invariant(Number.isSafeInteger(task.issueNumber) && task.issueNumber > 0, "issue number");
    invariant(Number.isFinite(Date.parse(task.issueUpdatedAt)), "issue version");
    invariant(["ready", "paused"].includes(task.status), "task status");
  }
}

export function initialState(profile) {
  profileCheck(profile);
  return {
    version: 1,
    repository: profile.repository,
    controlBranch: profile.controlBranch,
    events: [],
  };
}

export function validateState(state) {
  canonical(state);
  invariant(state.version === 1, "ledger version");
  id(state.repository);
  id(state.controlBranch);
  const events = array(state.events);
  invariant(new Set(events.map((event) => event.id)).size === events.length, "duplicate event");
  let previous = 0;
  for (const event of events) {
    sha(event.id, 64);
    invariant(TYPES.has(event.type), "event type");
    if (
      event.type === "execution_lease" ||
      event.type === "execution_outcome" ||
      event.type === "execution_reconciliation"
    ) {
      const d = event.data;
      const lease = event.type === "execution_lease";
      const reconciliation = event.type === "execution_reconciliation";
      const keys = lease
        ? ["taskId", "contractHash", "sourceSha", "runId", "runAttempt", "maximumStages"]
        : reconciliation
          ? [
              "taskId",
              "contractHash",
              "sourceSha",
              "runId",
              "runAttempt",
              "runStatus",
              "runConclusion",
              "observedJobIds",
              "observedStages",
              "disposition",
              "budgetReleased",
              "automaticRerun",
            ]
        : [
            "taskId",
            "stage",
            "phase",
            "sourceSha",
            "runId",
            "runAttempt",
            "jobId",
            "result",
            "modelStep",
            "cause",
            "automaticRerun",
          ];
      invariant(canonical(Object.keys(d).sort()) === canonical(keys.sort()), "operation fields");
      sha(d.sourceSha);
      for (const field of ["runId", "runAttempt"]) {
        invariant(Number.isSafeInteger(d[field]) && d[field] > 0, "operation identity");
      }
      if (lease) {
        id(d.taskId);
        sha(d.contractHash, 64);
        invariant(d.maximumStages === 2, "operation budget");
        invariant(event.id === digest([event.type, d.taskId]), "lease identity");
      } else if (reconciliation) {
        id(d.taskId);
        sha(d.contractHash, 64);
        invariant(d.runStatus === "completed", "reconciliation terminal run");
        invariant(
          [
            "success",
            "failure",
            "timed_out",
            "cancelled",
            "skipped",
            "action_required",
            "neutral",
            "stale",
            "startup_failure",
          ].includes(d.runConclusion),
          "reconciliation conclusion",
        );
        invariant(
          Array.isArray(d.observedJobIds) &&
            d.observedJobIds.every((job) => Number.isSafeInteger(job) && job > 0) &&
            new Set(d.observedJobIds).size === d.observedJobIds.length,
          "reconciliation jobs",
        );
        invariant(
          Array.isArray(d.observedStages) &&
            d.observedStages.every((stage) => stage === 1 || stage === 2) &&
            new Set(d.observedStages).size === d.observedStages.length,
          "reconciliation stages",
        );
        invariant(
          ["stage-results-recorded", "interrupted-without-stage-result"].includes(
            d.disposition,
          ),
          "reconciliation disposition",
        );
        invariant(
          d.budgetReleased === false && d.automaticRerun === false,
          "reconciliation budget",
        );
        invariant(event.id === digest([event.type, d.taskId]), "reconciliation identity");
        const owner = events.find(
          (candidate) =>
            candidate.type === "execution_lease" && candidate.data.taskId === d.taskId,
        );
        invariant(
          owner &&
            owner.data.contractHash === d.contractHash &&
            owner.data.sourceSha === d.sourceSha &&
            owner.data.runId === d.runId &&
            owner.data.runAttempt === d.runAttempt,
          "reconciliation lease",
        );
      } else {
        invariant(d.taskId === null || /^[a-zA-Z0-9_-]+$/.test(id(d.taskId)), "outcome task");
        invariant(
          [
            "select",
            "reserve-operations",
            "execute",
            "repair",
            "certify",
            "publish",
            "report",
          ].includes(d.phase),
          "outcome phase",
        );
        const results = [
          "success",
          "failure",
          "timed_out",
          "cancelled",
          "skipped",
          "action_required",
          "neutral",
          "stale",
          "startup_failure",
        ];
        invariant(
          results.includes(d.result) && [...results, "not-established"].includes(d.modelStep),
          "outcome result",
        );
        invariant(
          d.stage ===
            (d.taskId && d.phase === "execute" ? 1 : d.taskId && d.phase === "repair" ? 2 : null),
          "outcome stage",
        );
        invariant(Number.isSafeInteger(d.jobId) && d.jobId > 0, "outcome job");
        invariant(
          d.cause === "not-established-by-job-status" && d.automaticRerun === false,
          "outcome authority",
        );
        invariant(
          event.id === digest([event.type, [d.runId, d.runAttempt, d.jobId]]),
          "outcome identity",
        );
      }
    }
    const time = utc(event.at);
    invariant(time >= previous, "event chronology");
    previous = time;
  }
  return state;
}

function append(state, type, key, at, data) {
  validateState(state);
  utc(at);
  const event = { id: digest([type, key]), type, at, data };
  const old = state.events.find((item) => item.id === event.id);
  if (old) {
    invariant(canonical(old.data) === canonical(data), "conflicting receipt");
    return structuredClone(state);
  }
  invariant(!state.events.length || utc(at) >= utc(state.events.at(-1).at), "event time");
  return validateState({ ...structuredClone(state), events: [...state.events, event] });
}

function failureKey(failure) {
  return digest([id(failure.objectId), id(failure.sourceVersion)]);
}

export function recordFailure(state, failure) {
  const key = failureKey(failure);
  id(failure.attemptId);
  invariant(["read", "generation"].includes(failure.operation), "operation");
  invariant(ERRORS.has(failure.kind), "error kind");
  const delay = failure.retryAfterMs ?? 0;
  invariant(Number.isFinite(delay) && delay >= 0 && delay <= 168 * HOUR, "Retry-After");
  const data = {
    key,
    attemptId: failure.attemptId,
    operation: failure.operation,
    kind: failure.kind,
    notBefore: new Date(utc(failure.at) + delay).toISOString(),
  };
  const prior = state.events.filter((event) => event.data.key === key);
  invariant(
    prior.every((event) => !event.data.operation || event.data.operation === data.operation),
    "operation drift",
  );
  return append(state, "failure", [key, failure.attemptId], failure.at, data);
}

function failureEvents(state, key) {
  return state.events.filter((event) => event.data.key === key);
}

function unresolved(state, key) {
  const all = failureEvents(state, key);
  const resolved = all.findLastIndex((event) => event.type === "resolution");
  const events = all.slice(resolved + 1);
  if (events.some((event) => TERMINAL.has(event.data.kind))) return true;
  const last = events.at(-1);
  return !!last && !(last.type === "retry_result" && last.data.result === "success");
}

/** Persist the returned state before performing a retry. A claim is not execution. */
export function reserveRetry(state, key, attemptId, at) {
  validateState(state);
  sha(key, 64);
  id(attemptId);
  utc(at);
  const events = failureEvents(state, key);
  invariant(
    events.some((event) => event.type === "failure"),
    "failure required",
  );
  const deny = (reason) => ({ state: structuredClone(state), permitted: false, reason });
  if (!unresolved(state, key)) return deny("already_verified");
  if (events.some((event) => TERMINAL.has(event.data.kind))) return deny("terminal");
  const claims = events.filter((event) => event.type === "retry_claim");
  const results = events.filter((event) => event.type === "retry_result");
  if (
    claims.some(
      (claim) => !results.some((result) => result.data.attemptId === claim.data.attemptId),
    )
  ) {
    return deny("reconcile_interruption");
  }
  const attempts = new Set(events.map((event) => event.data.attemptId));
  if (attempts.has(attemptId) || attempts.size >= 2) return deny("budget_exhausted");
  const deadline = Math.max(...events.map((event) => Date.parse(event.data.notBefore || event.at)));
  if (utc(at) < deadline) return deny("retry_after");
  const next = append(state, "retry_claim", [key, attemptId], at, { key, attemptId });
  return { state: next, permitted: true, reason: "reserved_not_executed" };
}

export function finishRetry(state, key, attemptId, at, result, evidenceId, kind = null) {
  validateState(state);
  id(evidenceId);
  invariant(["success", "failure", "unknown"].includes(result), "retry result");
  const claim = state.events.find(
    (event) =>
      event.type === "retry_claim" && event.data.key === key && event.data.attemptId === attemptId,
  );
  invariant(claim && utc(at) >= utc(claim.at), "claim required");
  if (result === "unknown") return structuredClone(state);
  invariant(result !== "failure" || ERRORS.has(kind), "failure classification");
  return append(state, "retry_result", [key, attemptId], at, {
    key,
    attemptId,
    result,
    evidenceId,
    kind,
  });
}

/** A trusted adapter may record positive evidence; this never resets retry history. */
export function resolveFailure(state, key, at, evidence) {
  validateState(state);
  sha(key, 64);
  invariant(
    state.events.some((event) => event.type === "failure" && event.data.key === key),
    "known failure",
  );
  sha(evidence.controlSha);
  invariant(Number.isSafeInteger(evidence.runId) && evidence.runId > 0, "resolution run");
  invariant(Number.isSafeInteger(evidence.attempt) && evidence.attempt > 0, "resolution attempt");
  const receipt = {
    controlSha: evidence.controlSha,
    runId: evidence.runId,
    attempt: evidence.attempt,
  };
  return append(state, "resolution", [key, receipt], at, { key, evidence: receipt });
}

/** A claimed but unacknowledged notice must be reconciled, not blindly resent. */
export function claimNotice(state, notice, at) {
  validateState(state);
  sha(notice.key, 64);
  const exists = state.events.some(
    (event) => event.type === "notice_claim" && event.data.key === notice.key,
  );
  if (exists) return { state: structuredClone(state), permitted: false };
  return {
    state: append(state, "notice_claim", notice.key, at, { key: notice.key }),
    permitted: true,
  };
}

export function finishNotice(state, key, at, receipt) {
  id(receipt);
  invariant(
    state.events.some((event) => event.type === "notice_claim" && event.data.key === key),
    "notice claim",
  );
  return append(state, "notice_sent", key, at, { key, receipt });
}

/** Complete observations come from a trusted adapter; input text grants no authority. */
export function evaluateGovernance(profile, observation, previous = initialState(profile)) {
  profileCheck(profile);
  validateState(previous);
  canonical(observation);
  invariant(
    previous.repository === profile.repository && previous.controlBranch === profile.controlBranch,
    "ledger scope",
  );
  invariant(
    observation.repository === profile.repository &&
      observation.controlBranch === profile.controlBranch,
    "observation scope",
  );
  id(observation.cycleId);
  const now = utc(observation.capturedAt);
  sha(observation.controlSha);
  sha(observation.queueBlobSha);
  invariant(utc(profile.source.capturedAt) <= now, "future snapshot");
  const cycleKey = digest(["cycle", observation.cycleId]);
  const inputHash = digest([profile, observation]);
  const old = previous.events.find((event) => event.id === cycleKey);
  if (old) {
    invariant(old.data.inputHash === inputHash, "cycle ID reused");
    return { state: structuredClone(previous), proposals: [], notices: [], replay: true };
  }
  let state = structuredClone(previous);
  for (const failure of array(observation.failures || [])) {
    invariant(utc(failure.at) <= now, "future failure");
    state = recordFailure(state, failure);
  }
  const findings = [];
  const proposals = [];
  const delivered = new Set(previous.events.flatMap((event) => event.data.delivered || []));
  const missing = ["policy", "issues", "pullRequests", "runs"].filter(
    (name) => observation[name]?.complete !== true,
  );
  let allowed = missing.length === 0;
  if (missing.length) findings.push({ rule: "G01", status: "unknown", sources: missing });
  const eligible = [];
  if (allowed) {
    const policy = observation.policy;
    const same =
      page(policy.pageId) === page(profile.source.pageId) &&
      policy.lastEditedAt === profile.source.lastEditedAt &&
      policy.snapshotSha256 === profile.source.sha256;
    findings.push({ rule: "G02", status: same ? "verified" : "blocked", versionMatches: same });
    allowed = same;
    const runs = array(observation.runs.items);
    const unknown = runs.some(
      (run) =>
        ![...ACTIVE, "completed"].includes(run.status) ||
        run.repository !== profile.repository ||
        run.controlBranch !== profile.controlBranch,
    );
    const active = runs.some((run) => ACTIVE.has(run.status));
    allowed = allowed && !unknown && !active;
    findings.push({ rule: "G06", status: unknown ? "unknown" : active ? "blocked" : "verified" });
    const prs = array(observation.pullRequests.items);
    for (const pr of prs) {
      invariant(pr.repository === profile.repository, "PR repository");
      invariant(pr.headBranch === `automation/codex/${id(pr.taskId)}`, "PR branch");
      invariant(["open", "closed", "merged"].includes(pr.state), "PR state");
      invariant(Number.isSafeInteger(pr.number) && pr.number > 0, "PR number");
      delivered.add(pr.taskId);
    }
    const duplicatePRs = prs.some(
      (pr) => prs.filter((other) => other.taskId === pr.taskId).length > 1,
    );
    if (duplicatePRs) {
      allowed = false;
      findings.push({ rule: "G06", status: "blocked", reason: "duplicate_publication" });
    }
    const issues = array(observation.issues.items);
    invariant(
      new Set(issues.map((issue) => issue.number)).size === issues.length,
      "duplicate observed issue",
    );
    for (const task of profile.tasks) {
      if (delivered.has(task.id)) continue;
      const issue = issues.find((item) => item.number === task.issueNumber);
      const matches =
        issue &&
        issue.state === "open" &&
        issue.bodySha256 === task.issueBodySha256 &&
        issue.updatedAt === task.issueUpdatedAt;
      if (matches && task.status === "ready") eligible.push(task.id);
      else findings.push({ rule: "G04", taskId: task.id, status: "blocked" });
    }
    for (const issue of issues.filter(
      (item) => !profile.tasks.some((task) => task.issueNumber === item.number),
    )) {
      invariant(Number.isSafeInteger(issue.number) && issue.number > 0, "candidate number");
      findings.push({ rule: "G04", issueNumber: issue.number, status: "candidate_not_admitted" });
    }
  }
  for (const check of array(observation.checks || [])) {
    id(check.objectId);
    sha(check.sha);
    invariant(["success", "failure", "unknown", "not_run"].includes(check.result), "check result");
    invariant(typeof check.artifactAvailable === "boolean", "artifact availability");
    invariant(Number.isSafeInteger(check.runId) && check.runId > 0, "run ID");
    invariant(Number.isSafeInteger(check.attempt) && check.attempt > 0, "attempt number");
    const verified =
      check.result === "success" && check.artifactAvailable && check.sha === observation.controlSha;
    findings.push({
      rule: "G08",
      objectId: check.objectId,
      sha: check.sha,
      runId: check.runId,
      attempt: check.attempt,
      status: verified ? "technical_verified" : "unverified",
      acceptance: "not_asserted",
      promotion: "not_authorized",
    });
  }
  const keys = new Set(
    state.events.filter((event) => event.type === "failure").map((event) => event.data.key),
  );
  const notices = [];
  for (const key of keys) {
    if (!unresolved(state, key)) continue;
    allowed = false;
    const events = failureEvents(state, key);
    const terminal = events.find((event) => TERMINAL.has(event.data.kind));
    const exhausted = new Set(events.map((event) => event.data.attemptId)).size >= 2;
    findings.push({
      rule: "G09",
      key,
      status: "blocked",
      reason: terminal?.data.kind || (exhausted ? "budget_exhausted" : "retry_pending"),
    });
    if (terminal && ["credential", "permission", "quota"].includes(terminal.data.kind)) {
      const notice = { key: digest([key, terminal.data.kind]), reason: terminal.data.kind };
      if (
        !state.events.some(
          (event) => event.type === "notice_claim" && event.data.key === notice.key,
        )
      )
        notices.push(notice);
    }
  }
  const refresh = !profile.hostedController || utc(profile.source.expiresAt) - now < 24 * HOUR;
  if (allowed && (refresh || eligible.length)) {
    proposals.push({
      type: "refresh_snapshot",
      repository: profile.repository,
      branch: profile.controlBranch,
      expectedQueueBlobSha: observation.queueBlobSha,
      expectedControlSha: observation.controlSha,
      admittedSourceVersion: profile.source.lastEditedAt,
      capturedAt: observation.capturedAt,
      expiresAt: new Date(now + 48 * HOUR).toISOString(),
      eligibleTaskIds: eligible.slice(0, profile.maxTasksPerRun),
    });
  }
  const lastCycle = previous.events.findLast((event) => event.type === "cycle");
  const gapObserved = !!lastCycle && now - utc(lastCycle.at) > 12 * HOUR;
  state = append(state, "cycle", observation.cycleId, observation.capturedAt, {
    inputHash,
    controlSha: observation.controlSha,
    queueBlobSha: observation.queueBlobSha,
    policyVersion: profile.source.lastEditedAt,
    findings,
    delivered: [...delivered].sort(),
    gapObserved,
    outcome: proposals.length ? "proposal_only" : allowed ? "idle" : "blocked",
  });
  return { state, proposals, notices, replay: false };
}
