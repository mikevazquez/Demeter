import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { certifySchemaParity } from "./certify-schema-parity.mjs";
import {
  SCHEMA_CANDIDATE_REF,
  SCHEMA_PRODUCTION_REF,
  signSchemaPayload,
} from "./verify-schema-attestation.mjs";

// This file and its SQL must run from a reviewed, immutable controller checkout.
// Never run candidate code in a job holding database or signing credentials.
const fingerprint = readFileSync(new URL("./sql/schema-fingerprint.sql", import.meta.url), "utf8")
  .trim()
  .replace(/;$/, "");
export const CAPTURE_SQL = `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL statement_timeout = '15s';
SELECT json_build_object(
  'role', current_user,
  'safe', NOT (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls),
  'memberships', (SELECT count(*) FROM pg_auth_members WHERE member = r.oid),
  'readonly', current_setting('transaction_read_only'),
  'database', current_database()
) FROM pg_roles r WHERE rolname = current_user;
SELECT coalesce(json_agg(f ORDER BY kind), '[]'::json) FROM (${fingerprint}) f;
ROLLBACK;`;

export function connectionEnvironment(connection, projectRef) {
  let url;
  try {
    url = new URL(connection);
  } catch {
    throw new Error("Invalid capture connection configuration");
  }
  if (
    ![SCHEMA_PRODUCTION_REF, SCHEMA_CANDIDATE_REF].includes(projectRef) ||
    url.protocol !== "postgresql:" ||
    url.hostname !== `db.${projectRef}.supabase.co` ||
    (url.port && url.port !== "5432") ||
    url.pathname !== "/postgres" ||
    url.username !== "sf_gov_schema_reader" ||
    !url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("Capture requires the exact direct project endpoint and dedicated reader");
  }
  return {
    PGHOST: url.hostname,
    PGPORT: "5432",
    PGDATABASE: "postgres",
    PGUSER: "sf_gov_schema_reader",
    PGPASSWORD: decodeURIComponent(url.password),
    PGSSLMODE: "verify-full",
    PGSSLROOTCERT: "system",
    PGCONNECT_TIMEOUT: "10",
    PGOPTIONS: "-c default_transaction_read_only=on -c search_path=pg_catalog",
    LC_ALL: "C",
  };
}

export function captureProject(connection, ref, run = spawnSync) {
  const env = connectionEnvironment(connection, ref);
  const result = run("/usr/bin/psql", ["-X", "-w", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"], {
    env,
    input: CAPTURE_SQL,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 1024 * 1024,
  });
  // Raw stderr/error may contain credentials or server information. Never forward it.
  if (result.error || result.status !== 0) throw new Error("Read-only schema capture failed");
  let role;
  let rows;
  try {
    const lines = result.stdout.trim().split(/\r?\n/);
    if (lines.length !== 2) throw new Error();
    [role, rows] = lines.map((line) => JSON.parse(line));
  } catch {
    throw new Error("Invalid schema capture response");
  }
  if (
    role?.role !== "sf_gov_schema_reader" ||
    role.safe !== true ||
    role.memberships !== 0 ||
    role.readonly !== "on" ||
    role.database !== "postgres"
  ) {
    throw new Error("Capture reader identity or privilege check failed");
  }
  certifySchemaParity(rows, rows); // Refuse incomplete results even when both sides match.
  return rows;
}

export function captureAttestation(config, run = spawnSync) {
  if (!/^[0-9a-f]{40}$/.test(config.candidateSha ?? "")) {
    throw new Error("An immutable candidate SHA is required");
  }
  // Validate both destinations and key before making any connection.
  connectionEnvironment(config.productionConnection, SCHEMA_PRODUCTION_REF);
  connectionEnvironment(config.candidateConnection, SCHEMA_CANDIDATE_REF);
  signSchemaPayload({}, config.key);
  const capturedAt = new Date().toISOString();
  const baseline = captureProject(config.productionConnection, SCHEMA_PRODUCTION_REF, run);
  const candidate = captureProject(config.candidateConnection, SCHEMA_CANDIDATE_REF, run);
  const parity = certifySchemaParity(baseline, candidate);
  if (!parity.certified) throw new Error("Schema parity denied; no attestation issued");
  const payload = {
    version: 1,
    source: "supabase-readonly",
    baseline_ref: SCHEMA_PRODUCTION_REF,
    candidate_ref: SCHEMA_CANDIDATE_REF,
    candidate_sha: config.candidateSha,
    captured_at: capturedAt,
    baseline,
    candidate,
  };
  return { ...payload, signature: signSchemaPayload(payload, config.key) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error("Expected candidate SHA and new output path");
    const evidence = captureAttestation({
      candidateSha: process.argv[2],
      productionConnection: process.env.SF_GOV_PRODUCTION_READER_URL,
      candidateConnection: process.env.SF_GOV_CANDIDATE_READER_URL,
      key: process.env.SF_GOV_SCHEMA_ATTESTATION_KEY,
    });
    writeFileSync(process.argv[3], JSON.stringify(evidence, null, 2) + "\n", {
      flag: "wx",
      mode: 0o600,
    });
    console.log("PASS: capture signed; production authorization not implied");
  } catch {
    console.error("DENIED: capture not certified; no release authorization");
    process.exitCode = 1;
  }
}
