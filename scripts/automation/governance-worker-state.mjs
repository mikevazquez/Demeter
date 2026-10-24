const MARKER = "GOVERNANCE_WORKER_STATE_V1";
const SCHEMA = "governance-worker-state-v1";
const ISSUE_PREFIX = "https://github.com/mikevazquez/Demeter/issues/389#issuecomment-";
const WORKER_STATES = new Set(["available", "no_capacity", "degraded", "disconnected"]);
const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const MAX_BODY_BYTES = 16 * 1024;

const ensure = (condition, message) => {
  if (!condition) throw new Error(message);
};

function parseBody(body) {
  ensure(
    typeof body === "string" && Buffer.byteLength(body) <= MAX_BODY_BYTES,
    "Worker state body invalid",
  );
  const markers = [...body.matchAll(/\bGOVERNANCE_WORKER_STATE_V1\b/g)];
  ensure(markers.length <= 1, "Ambiguous worker state marker");
  if (markers.length === 0) return null;
  const tail = body.slice(markers[0].index + MARKER.length).trim();
  const fenced = tail.match(/^\`\`\`(?:json)?[ \t]*\r?\n([\s\S]*?)\r?\n\`\`\`\s*$/);
  ensure(fenced, "Worker state signal requires exactly one fenced JSON object");
  let signal;
  try {
    signal = JSON.parse(fenced[1]);
  } catch {
    throw new Error("Worker state JSON invalid");
  }
  return signal;
}

function validateSignal(signal, allowedWorkers) {
  ensure(
    signal && typeof signal === "object" && !Array.isArray(signal),
    "Worker state signal object required",
  );
  const keys = Object.keys(signal).sort();
  ensure(
    JSON.stringify(keys) === JSON.stringify(["observed_at", "schema", "state", "worker_id"]),
    "Worker state signal has unexpected fields",
  );
  ensure(signal.schema === SCHEMA, "Worker state schema mismatch");
  ensure(WORKER_ID.test(signal.worker_id ?? ""), "Worker state worker_id invalid");
  ensure(WORKER_STATES.has(signal.state), "Worker state value invalid");
  ensure(
    typeof signal.observed_at === "string" && Number.isFinite(Date.parse(signal.observed_at)),
    "Worker state observed_at invalid",
  );
  ensure(
    Array.isArray(allowedWorkers) &&
      allowedWorkers.length > 0 &&
      allowedWorkers.includes(signal.worker_id),
    "Worker state references an unregistered worker",
  );
  return {
    workerId: signal.worker_id,
    state: signal.state,
    observedAt: new Date(signal.observed_at).toISOString(),
    source: "owner_worker_state_signal",
  };
}

export function parseWorkerStateComment(comment, { allowedWorkers } = {}) {
  if (typeof comment?.body !== "string" || !comment.body.trimStart().startsWith(MARKER))
    return null;
  if (comment.user?.login !== "mikevazquez") return null;
  ensure(Number.isSafeInteger(comment.id) && comment.id > 0, "Worker state comment id invalid");
  ensure(comment.html_url === `${ISSUE_PREFIX}${comment.id}`, "Worker state comment URL invalid");
  const signal = validateSignal(parseBody(comment.body), allowedWorkers);
  return {
    ...signal,
    commentId: comment.id,
    sourceUrl: comment.html_url,
  };
}

export function latestWorkerStateSignals(comments, { allowedWorkers } = {}) {
  ensure(Array.isArray(comments) && comments.length <= 1000, "Worker state comments invalid");
  const latest = new Map();
  for (const comment of comments) {
    const parsed = parseWorkerStateComment(comment, { allowedWorkers });
    if (!parsed) continue;
    const previous = latest.get(parsed.workerId);
    if (!previous || parsed.commentId > previous.commentId) latest.set(parsed.workerId, parsed);
  }
  return [...latest.values()].sort((a, b) => a.workerId.localeCompare(b.workerId));
}

export async function fetchWorkerStateSignals(request, { allowedWorkers, issueNumber = 389 } = {}) {
  ensure(typeof request === "function", "Worker state request adapter required");
  ensure(issueNumber === 389, "Worker state channel must use the reviewed issue");
  const comments = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await request(
      "GET",
      `repos/mikevazquez/Demeter/issues/${issueNumber}/comments?per_page=100&page=${page}`,
    );
    ensure(Array.isArray(batch) && batch.length <= 100, "Worker state comments response invalid");
    comments.push(...batch);
    ensure(comments.length <= 1000, "Worker state comments exceed the bounded history");
    if (batch.length < 100) break;
    ensure(page < 10, "Worker state comments exceed the bounded history");
  }
  return latestWorkerStateSignals(comments, { allowedWorkers });
}

export function applyWorkerStateSignals(workers, signals) {
  ensure(Array.isArray(workers) && workers.length > 0, "Registered workers required");
  ensure(Array.isArray(signals), "Worker state signals required");
  const byWorker = new Map(signals.map((signal) => [signal.workerId, signal]));
  return workers.map((worker) => {
    const signal = byWorker.get(worker.workerId);
    if (!signal) return { ...worker };
    if (worker.state === "disconnected" && signal.state === "available") return { ...worker };
    return {
      ...worker,
      state: signal.state,
      stateSource: signal.source,
      stateObservedAt: signal.observedAt,
    };
  });
}

export { MARKER as WORKER_STATE_MARKER, SCHEMA as WORKER_STATE_SCHEMA };
