/** Bounded read recovery. No message sender, model, task admission or publisher. */
import {
  digest,
  invariant,
  initialState,
  recordFailure,
  reserveRetry,
  finishRetry,
  claimNotice,
} from "./governance-evaluator.mjs";

const TRANSIENT = new Set(["timeout", "rate_limit", "server"]);
const TERMINAL = new Set(["credential", "permission", "quota", "scope", "authority"]);
const OBJECT = "governance/observation";
const isReadError = (error) =>
  Number.isInteger(error?.status) ||
  ["QUOTA", "TRANSPORT_UNKNOWN", "TIMEOUT"].includes(error?.code);

export function readSourceVersion(profile) {
  initialState(profile);
  invariant(
    profile.repository === "mikevazquez/Demeter" &&
      profile.controlBranch === "chore/governance-autonomous-coordinator-20261015",
    "read profile scope",
  );
  return digest({
    repository: profile.repository,
    branch: profile.controlBranch,
    pageId: profile.source.pageId,
    version: profile.source.lastEditedAt,
    snapshot: profile.source.sha256,
    tasks: profile.tasks,
  });
}

export class ReadRecoveryBlocked extends Error {
  constructor(report) {
    super(`Governance read recovery blocked: ${report.reason}`);
    this.report = report;
  }
}

export function classifyReadError(error) {
  error ||= {};
  let kind = "result";
  if (error.code === "QUOTA") kind = "quota";
  else if (error.status === 401) kind = "credential";
  else if (error.status === 403 && error.rateLimited !== true) kind = "permission";
  else if (error.retryAfterUnsupported !== true) {
    if (error.status === 429 || error.status === 403) kind = "rate_limit";
    else if (error.status >= 500 && error.status <= 599) kind = "server";
    else if (["TRANSPORT_UNKNOWN", "TIMEOUT"].includes(error.code)) kind = "timeout";
  }
  const retryAfterMs = error.retryAfterMs ?? 0;
  invariant(
    Number.isFinite(retryAfterMs) && retryAfterMs >= 0 && retryAfterMs <= 168 * 3600000,
    "bounded Retry-After",
  );
  return { kind, retryAfterMs, retryable: TRANSIENT.has(kind) };
}

const defaultNow = () => new Date().toISOString();
const defaultWait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Persist the reservation before the only retry. Never retry a journal write.
 * sourceVersion must be stable across journal commits and snapshot-date refreshes.
 * read is a trusted collector, not a command or function supplied by an issue.
 */
export async function recoverRead(store, context, read, options = {}) {
  invariant(/^[a-f0-9]{64}$/.test(context.sourceVersion), "read source version");
  invariant(
    Number.isSafeInteger(context.runId) &&
      context.runId > 0 &&
      Number.isSafeInteger(context.attempt) &&
      context.attempt > 0,
    "read run identity",
  );
  const now = options.now || defaultNow;
  const wait = options.wait || defaultWait;
  const maxWaitMs = options.maxWaitMs ?? 10000;
  invariant(Number.isFinite(maxWaitMs) && maxWaitMs >= 0 && maxWaitMs <= 30000, "read wait bound");
  let current = await store.read();
  const key = digest([OBJECT, context.sourceVersion]);
  const report = {
    version: 1,
    objectId: OBJECT,
    sourceVersion: context.sourceVersion,
    runId: context.runId,
    attempt: context.attempt,
    failureKey: key,
    retryExecuted: false,
    recovered: false,
    notices: [],
    noticesSent: false,
    revision: current.record.sha256,
    sequence: current.record.sequence,
  };
  const commit = async (state) => {
    const signature = digest({
      previous: current.record.signature,
      operation: "read-recovery",
      events: state.events.map((event) => event.id),
    });
    current = await store.commit(current, state, signature);
    report.revision = current.record.sha256;
    report.sequence = current.record.sequence;
  };
  const block = async (reason, kind) => {
    report.reason = reason;
    report.kind = kind;
    if (TERMINAL.has(kind) || ["budget_exhausted", "reconcile_interruption"].includes(reason)) {
      const notice = {
        key: TERMINAL.has(kind) ? digest([key, kind]) : digest([key, reason, kind]),
        reason,
      };
      const claim = claimNotice(current.record.state, notice, now());
      if (claim.permitted) {
        await commit(claim.state);
        report.notices.push({ ...notice, kind, delivery: "artifact-only", sent: false });
      }
    }
    report.revision = current.record.sha256;
    report.sequence = current.record.sequence;
    throw new ReadRecoveryBlocked(report);
  };
  let events = current.record.state.events.filter((event) => event.data.key === key);
  const lastResolution = events.findLastIndex((event) => event.type === "resolution");
  const outstanding = events.slice(lastResolution + 1);
  const lastOutcome = outstanding.findLast((event) =>
    ["failure", "retry_claim", "retry_result"].includes(event.type),
  );
  let failure = outstanding.findLast((event) => event.type === "failure")?.data;
  const interrupted = outstanding.some(
    (event) =>
      event.type === "retry_claim" &&
      !outstanding.some(
        (result) =>
          result.type === "retry_result" && result.data.attemptId === event.data.attemptId,
      ),
  );
  // A completed read permits routine observations, but never resets its retry budget.
  if (
    !failure ||
    (lastOutcome?.type === "retry_result" &&
      lastOutcome.data.result === "success" &&
      !interrupted &&
      !outstanding.some((event) => TERMINAL.has(event.data.kind)))
  ) {
    try {
      const value = await read(current);
      return { value, current, report: { ...report, reason: "read-success" } };
    } catch (error) {
      if (!isReadError(error)) throw error;
      const classified = classifyReadError(error);
      const at = now();
      const failed = recordFailure(current.record.state, {
        objectId: OBJECT,
        sourceVersion: context.sourceVersion,
        operation: "read",
        kind: classified.kind,
        retryAfterMs: classified.retryAfterMs,
        at,
        attemptId: `run/${context.runId}/attempt/${context.attempt}/read-1`,
      });
      await commit(failed);
      events = current.record.state.events.filter((event) => event.data.key === key);
      failure = events.findLast((event) => event.type === "failure").data;
    }
  }
  const terminal = events.find((event) => TERMINAL.has(event.data.kind));
  if (terminal) return block("terminal", terminal.data.kind);
  if (!TRANSIENT.has(failure.kind)) return block("unclassified-result", failure.kind);
  const deadline = Math.max(...events.map((event) => Date.parse(event.data.notBefore || event.at)));
  const delay = Math.max(0, deadline - Date.parse(now()));
  if (delay > maxWaitMs) return block("retry_after", failure.kind);
  if (delay > 0) await wait(delay);
  const attemptId = `run/${context.runId}/attempt/${context.attempt}/read-2`;
  const reservation = reserveRetry(current.record.state, key, attemptId, now());
  if (!reservation.permitted) return block(reservation.reason, failure.kind);
  await commit(reservation.state);
  report.retryExecuted = true;
  let value;
  try {
    value = await read(current);
  } catch (error) {
    const classified = classifyReadError(error);
    await commit(
      finishRetry(
        current.record.state,
        key,
        attemptId,
        now(),
        "failure",
        `run/${context.runId}/attempt/${context.attempt}`,
        classified.kind,
      ),
    );
    return block(TERMINAL.has(classified.kind) ? "terminal" : "budget_exhausted", classified.kind);
  }
  // If this write has an uncertain outcome, leave the reservation for reconciliation.
  await commit(
    finishRetry(
      current.record.state,
      key,
      attemptId,
      now(),
      "success",
      `run/${context.runId}/attempt/${context.attempt}`,
    ),
  );
  return { value, current, report: { ...report, recovered: true, reason: "read-recovered" } };
}
