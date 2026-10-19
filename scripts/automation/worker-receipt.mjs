const MARKER = "GOVERNANCE_WORKER_RECEIPT_V1";

const assert = (value, message) => {
  if (!value) throw new Error(message);
};

export function serializeWorkerReceipt(receipt) {
  validateWorkerReceipt(receipt);
  return `${MARKER}\n${JSON.stringify(receipt)}`;
}

export function validateWorkerReceipt(receipt) {
  assert(receipt && typeof receipt === "object" && !Array.isArray(receipt), "Receipt required");
  for (const field of [
    "task_id",
    "worker_id",
    "dispatch_fingerprint",
    "status",
    "base_sha",
  ]) {
    assert(typeof receipt[field] === "string" && receipt[field].length > 0, `${field} required`);
  }
  assert(/^[a-f0-9]{64}$/.test(receipt.dispatch_fingerprint), "Invalid dispatch fingerprint");
  assert(/^[a-f0-9]{40}$/.test(receipt.base_sha), "Invalid base SHA");
  if (receipt.current_sha !== null && receipt.current_sha !== undefined) {
    assert(/^[a-f0-9]{40}$/.test(receipt.current_sha), "Invalid current SHA");
  }
  assert(["completed", "blocked", "failed"].includes(receipt.status), "Invalid receipt status");
  assert(Array.isArray(receipt.files_changed ?? []), "files_changed must be an array");
  assert(Array.isArray(receipt.commands_run ?? []), "commands_run must be an array");
  assert(Array.isArray(receipt.tests_passed ?? []), "tests_passed must be an array");
  assert(Array.isArray(receipt.blockers ?? []), "blockers must be an array");
  assert(Array.isArray(receipt.remaining_work ?? []), "remaining_work must be an array");
  return receipt;
}

export function parseWorkerReceipt(body) {
  if (typeof body !== "string") return null;
  const markerIndex = body.indexOf(MARKER);
  if (markerIndex === -1) return null;
  const after = body.slice(markerIndex + MARKER.length).trim();
  const firstLine = after.split("\n")[0].trim();
  if (!firstLine.startsWith("{")) return null;
  let parsed;
  try {
    parsed = JSON.parse(firstLine);
  } catch {
    return null;
  }
  return validateWorkerReceipt(parsed);
}

export function findMatchingWorkerReceipt(comments, expected) {
  assert(Array.isArray(comments), "Comments array required");
  assert(typeof expected?.task_id === "string", "expected.task_id required");
  assert(
    /^[a-f0-9]{64}$/.test(expected.dispatch_fingerprint ?? ""),
    "expected.dispatch_fingerprint required",
  );

  const matches = [];
  for (const comment of comments) {
    let receipt;
    try {
      receipt = parseWorkerReceipt(comment?.body);
    } catch {
      continue;
    }
    if (
      receipt &&
      receipt.task_id === expected.task_id &&
      receipt.dispatch_fingerprint === expected.dispatch_fingerprint
    ) {
      matches.push({
        comment_id: comment.id ?? null,
        author: comment.user?.login ?? null,
        receipt,
      });
    }
  }

  if (matches.length === 0) return null;
  matches.sort((a, b) => Number(a.comment_id ?? 0) - Number(b.comment_id ?? 0));
  return matches.at(-1);
}

export { MARKER as WORKER_RECEIPT_MARKER };
