import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { verifySchemaAttestation } from "./verify-schema-attestation.mjs";

const COMMIT = /^[0-9a-f]{40}$/i;
const CHECKSUM = /^[0-9a-f]{64}$/i;
const CHANGE_ID = /^SF-[A-Z0-9-]+-\d{2,4}$/;
const SAFE_URL =
  /^https:\/\/(?:github\.com\/mikevazquez\/Demeter\/(?:pull|actions\/runs)\/\d+|app\.notion\.com\/p\/[0-9a-f]+(?:\?[^\s]*)?)$/i;
const SECRET_PROPERTY =
  /(?:password|secret|token|private.key|credential|authorization.header|access.key|apikey|api_key)/i;

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function uniqueNames(value) {
  return Array.isArray(value) && value.every(text) && new Set(value).size === value.length;
}

export function validateReleaseManifest(
  manifest,
  { checkedOutSha, schemaAttestation, schemaAttestationKey, now } = {},
) {
  if (!object(manifest)) return ["Expected a manifest JSON object"];
  const errors = [];

  if (!CHANGE_ID.test(manifest.change_id ?? "")) errors.push("change_id must follow SF-MODULE-NNN");
  if (!COMMIT.test(manifest.baseline_sha ?? ""))
    errors.push("baseline_sha must be a full commit SHA");
  if (!COMMIT.test(manifest.candidate_sha ?? ""))
    errors.push("candidate_sha must be a full commit SHA");
  if (!["sandbox-candidate", "production-staged"].includes(manifest.target))
    errors.push("target is not an approved environment");
  if (!uniqueNames(manifest.modules) || manifest.modules.length === 0)
    errors.push("modules must contain unique names");
  if (!uniqueNames(manifest.uat_case_ids) || manifest.uat_case_ids.length === 0)
    errors.push("uat_case_ids must contain unique IDs");
  if (
    !Array.isArray(manifest.migrations) ||
    !manifest.migrations.every(
      (entry) =>
        object(entry) &&
        /^supabase\/migrations\/\d+_[\w-]+\.sql$/.test(entry.path ?? "") &&
        CHECKSUM.test(entry.sha256 ?? ""),
    )
  )
    errors.push("migrations require versioned path and SHA256 checksum");
  if (!uniqueNames(manifest.edge_functions)) errors.push("edge_functions must be unique slugs");
  if (!text(manifest.impact)) errors.push("impact is required");
  if (!text(manifest.rollback_plan)) errors.push("rollback_plan is required");
  if (
    !object(manifest.references) ||
    !SAFE_URL.test(manifest.references.pr ?? "") ||
    !SAFE_URL.test(manifest.references.notion ?? "")
  )
    errors.push("references require valid GitHub PR and Notion URLs");

  const evidence = manifest.uat_evidence;
  if (
    !Array.isArray(evidence) ||
    !evidence.every(
      (item) =>
        object(item) &&
        text(item.case_id) &&
        ["pending", "passed", "failed", "blocked"].includes(item.result) &&
        (item.result !== "passed" || SAFE_URL.test(item.evidence_url ?? "")),
    )
  )
    errors.push("uat_evidence must contain result and proof for passed cases");

  if (Array.isArray(evidence) && Array.isArray(manifest.uat_case_ids)) {
    const listed = new Set(manifest.uat_case_ids);
    if (
      new Set(evidence.map((x) => x.case_id)).size !== evidence.length ||
      evidence.some((x) => !listed.has(x.case_id))
    )
      errors.push("uat_evidence contains duplicate or unlisted case IDs");
  }

  if (manifest.target === "production-staged") {
    if (
      evidence?.length !== manifest.uat_case_ids?.length ||
      evidence?.some((item) => item.result !== "passed")
    )
      errors.push("production-staged requires passing evidence for every UAT");
    if (!text(manifest.sandbox_candidate_run))
      errors.push("production-staged requires sandbox_candidate_run");
    const attestationErrors = verifySchemaAttestation(schemaAttestation, {
      key: schemaAttestationKey,
      checkedOutSha: checkedOutSha ?? manifest.candidate_sha,
      now,
    });
    errors.push(...attestationErrors.map((error) => "schema_attestation: " + error));
  }

  if (
    checkedOutSha &&
    (!COMMIT.test(checkedOutSha) ||
      checkedOutSha.toLowerCase() !== manifest.candidate_sha?.toLowerCase())
  )
    errors.push("checked-out SHA differs from manifest candidate SHA");

  function checkSecretFields(value, parent = "manifest") {
    if (Array.isArray(value))
      return value.forEach((item, index) => checkSecretFields(item, parent + "[" + index + "]"));
    if (!object(value)) return;
    for (const [key, child] of Object.entries(value)) {
      if (SECRET_PROPERTY.test(key)) errors.push(parent + "." + key + ": secrets are prohibited");
      else checkSecretFields(child, parent + "." + key);
    }
  }
  checkSecretFields(manifest);

  // JSON is self-attested and cannot prove consent. Production release requires
  // a separate platform-enforced protected-environment reviewer tied to the SHA.
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = process.argv[2];
  if (!path) {
    console.error(
      "Usage: node scripts/validate-release-manifest.mjs <file.json> [SHA] [schema-attestation.json]",
    );
    process.exit(2);
  }
  try {
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    const schemaAttestation = process.argv[4]
      ? JSON.parse(readFileSync(process.argv[4], "utf8"))
      : undefined;
    const issues = validateReleaseManifest(manifest, {
      checkedOutSha: process.argv[3],
      schemaAttestation,
      schemaAttestationKey: process.env.SF_GOV_SCHEMA_ATTESTATION_KEY,
    });
    issues.forEach((issue) => console.error("FAIL: " + issue));
    if (issues.length) process.exitCode = 1;
    else console.log("PASS: manifest structure valid; release approval not implied");
  } catch (error) {
    console.error("FAIL: " + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}
