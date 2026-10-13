import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

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

export function validateReleaseManifest(manifest, { checkedOutSha } = {}) {
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
    errors.push("migrations require versioned path and SHA256 checksum"...[truncated]