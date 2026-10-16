// Prototype only: no server, credential loader, deployment or release attestation.
// The host must authenticate callers and supply trusted authorization and durable
// atomic reservations. None of those production adapters exists in this module.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { certifySchemaParity } from "./certify-schema-parity.mjs";
import {
  SCHEMA_PRODUCTION_REF as PROD,
  SCHEMA_CANDIDATE_REF as CAND,
} from "./verify-schema-attestation.mjs";

const fingerprint = readFileSync(
  new URL("./sql/schema-fingerprint.sql", import.meta.url),
  "utf8",
)
  .trim()
  .replace(/;$/, "");
export const BROKER_SQL = `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '15s';
${fingerprint};
ROLLBACK;`;
export const BROKER_QUERY_SHA256 = createHash("sha256")
  .update(BROKER_SQL)
  .digest("hex");
const SHA = /^[0-9a-f]{40}$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const object = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const exact = (x, keys) =>
  object(x) && Object.keys(x).sort().join(",") === [...keys].sort().join(",");
const deny = () => {
  throw new Error("Metadata broker request denied");
};

export function validateBrokerRequest(
  request,
  authorization,
  now = new Date(),
) {
  if (
    !exact(request, ["version", "candidate_sha", "request_id"]) ||
    request.version !== 1 ||
    typeof request.candidate_sha !== "string" ||
    !SHA.test(request.candidate_sha) ||
    typeof request.request_id !== "string" ||
    !UUID.test(request.request_id)
  )
    deny();
  if (
    !exact(authorization, [
      "candidate_sha",
      "request_id",
      "controller_sha",
      "query_sha256",
      "expires_at",
    ]) ||
    authorization.candidate_sha !== request.candidate_sha ||
    authorization.request_id !== request.request_id ||
    typeof authorization.controller_sha !== "string" ||
    !SHA.test(authorization.controller_sha) ||
    authorization.query_sha256 !== BROKER_QUERY_SHA256 ||
    typeof authorization.expires_at !== "string" ||
    !UTC.test(authorization.expires_at)
  )
    deny();
  const remaining = Date.parse(authorization.expires_at) - now.getTime();
  if (
    !Number.isFinite(remaining) ||
    remaining <= 0 ||
    remaining > 5 * 60 * 1000
  )
    deny();
}

function sanitizeRows(rows) {
  if (
    !Array.isArray(rows) ||
    rows.length !== 7 ||
    !rows.every(
      (row) =>
        exact(row, ["kind", "object_count", "fingerprint"]) &&
        typeof row.kind === "string" &&
        Number.isSafeInteger(row.object_count) &&
        row.object_count >= 0 &&
        typeof row.fingerprint === "string" &&
        /^[0-9a-f]{32}$/.test(row.fingerprint),
    )
  )
    deny();
  certifySchemaParity(rows, rows); // Reject duplicate, unknown or missing categories.
  return rows
    .map(({ kind, object_count, fingerprint }) => ({
      kind,
      object_count,
      fingerprint,
    }))
    .sort((a, b) => a.kind.localeCompare(b.kind));
}

export async function captureBrokerDiagnostic(
  request,
  authorization,
  adapters,
) {
  // Snapshot validated input before awaiting an adapter; do not accept later mutation.
  const requested = structuredClone(request);
  const approved = structuredClone(authorization);
  const now = adapters?.now ?? (() => new Date());
  validateBrokerRequest(requested, approved, now());
  if (
    typeof adapters?.reserve !== "function" ||
    typeof adapters?.readCatalog !== "function"
  )
    deny();
  // A production reservation must persist atomically across processes/restarts.
  // Failed attempts stay consumed: retry requires a freshly authorized request.
  const binding = createHash("sha256")
    .update(JSON.stringify([requested, approved]))
    .digest("hex");
  try {
    if ((await adapters.reserve(requested.request_id, binding)) !== true)
      deny();
  } catch {
    deny();
  }
  const reports = [];
  for (const projectRef of [PROD, CAND]) {
    validateBrokerRequest(requested, approved, now());
    let rows;
    let timer;
    const controller = new AbortController();
    try {
      rows = await Promise.race([
        Promise.resolve().then(() =>
          adapters.readCatalog(
            Object.freeze({
              projectRef,
              sql: BROKER_SQL,
              signal: controller.signal,
            }),
          ),
        ),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("timeout"));
          }, 30000);
        }),
      ]);
      reports.push(sanitizeRows(rows));
    } catch {
      // Never expose raw database/adapter errors or connection details.
      deny();
    } finally {
      clearTimeout(timer);
    }
  }
  validateBrokerRequest(requested, approved, now());
  const comparison = certifySchemaParity(reports[0], reports[1]);
  return {
    version: 1,
    source: "supabase-broker-prototype-diagnostic",
    release_eligible: false,
    candidate_sha: requested.candidate_sha,
    controller_sha: approved.controller_sha,
    request_id: requested.request_id,
    query_sha256: BROKER_QUERY_SHA256,
    captured_at: now().toISOString(),
    baseline_ref: PROD,
    candidate_ref: CAND,
    baseline: reports[0],
    candidate: reports[1],
    comparison,
  };
}
