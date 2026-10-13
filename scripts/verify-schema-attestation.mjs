import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { certifySchemaParity } from "./certify-schema-parity.mjs";

export const SCHEMA_PRODUCTION_REF = "qfhojvgvhrbautvczffq";
export const SCHEMA_CANDIDATE_REF = "sdmxtlgjkodidjtvikng";

const SHA = /^[0-9a-f]{40}$/i;
const SIGNATURE = /^[0-9a-f]{64}$/i;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_AGE_MS = 60 * 60 * 1000;

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!object(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}

export function signSchemaPayload(payload, key) {
  if (typeof key !== "string" || key.length < 32) {
    throw new Error("A protected attestation key of at least 32 characters is required.");
  }
  return createHmac("sha256", key)
    .update(JSON.stringify(canonical(payload)))
    .digest("hex");
}

export function verifySchemaAttestation(
  attestation,
  { key, checkedOutSha, now = new Date(), maxAgeMs = MAX_AGE_MS } = {},
) {
  const errors = [];
  if (!object(attestation)) return ["Schema attestation object is required"];
  if (attestation.version !== 1) errors.push("Unsupported schema attestation version");
  if (attestation.source !== "supabase-readonly") errors.push("Unknown capture source");
  if (attestation.baseline_ref !== SCHEMA_PRODUCTION_REF) {
    errors.push("Production project reference does not match");
  }
  if (attestation.candidate_ref !== SCHEMA_CANDIDATE_REF) {
    errors.push("Candidate project reference does not match");
  }
  if (
    !SHA.test(checkedOutSha ?? "") ||
    !SHA.test(attestation.candidate_sha ?? "") ||
    checkedOutSha.toLowerCase() !== attestation.candidate_sha.toLowerCase()
  ) {
    errors.push("Attested candidate SHA does not match the checked-out commit");
  }

  const captured = attestation.captured_at;
  const captureTime = typeof captured === "string" ? Date.parse(captured) : NaN;
  const age = now.getTime() - captureTime;
  if (
    !ISO_UTC.test(captured ?? "") ||
    !Number.isFinite(captureTime) ||
    !Number.isFinite(age) ||
    age < 0 ||
    age > maxAgeMs
  ) {
    errors.push("Schema evidence is stale, future-dated, or has an invalid UTC timestamp");
  }

  const signature = attestation.signature;
  if (!SIGNATURE.test(signature ?? "")) {
    errors.push("Schema attestation signature is missing or malformed");
  }
  if (typeof key !== "string" || key.length < 32) {
    errors.push("Protected attestation key is unavailable");
  }
  if (errors.length > 0) return errors;

  const { signature: unusedSignature, ...payload } = attestation;
  void unusedSignature;
  const expected = signSchemaPayload(payload, key);
  if (!timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expected, "hex"))) {
    errors.push("Schema attestation signature verification failed");
    return errors;
  }

  try {
    const result = certifySchemaParity(attestation.baseline, attestation.candidate);
    if (!result.certified) {
      errors.push("Schema parity denied: " + result.mismatches.map((row) => row.kind).join(", "));
    }
  } catch {
    errors.push("Schema attestation contains incomplete or invalid fingerprints");
  }
  return errors;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (process.argv.length !== 4) {
      throw new Error(
        "Usage: node scripts/verify-schema-attestation.mjs evidence.json checked-out-sha",
      );
    }
    const evidence = JSON.parse(readFileSync(process.argv[2], "utf8"));
    const errors = verifySchemaAttestation(evidence, {
      key: process.env.SF_GOV_SCHEMA_ATTESTATION_KEY,
      checkedOutSha: process.argv[3],
    });
    if (errors.length > 0) {
      errors.forEach((error) => console.error("DENIED: " + error));
      process.exitCode = 1;
    } else {
      console.log("PASS: signed and fresh schema parity; human release approval still required");
    }
  } catch (error) {
    console.error("DENIED: " + String(error.message ?? error));
    process.exitCode = 2;
  }
}
