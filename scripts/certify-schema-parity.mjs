import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { compareSchemaReports } from "./check-schema-drift.mjs";

export const REQUIRED_SCHEMA_KINDS = [
  "column",
  "extension",
  "index",
  "policy",
  "routine",
  "table_rls",
  "trigger",
];

function checkCategories(rows, label) {
  if (!Array.isArray(rows)) {
    throw new Error(label + " must be an array of schema fingerprint rows.");
  }
  const actual = rows.map((row) => row?.kind);
  const expected = new Set(REQUIRED_SCHEMA_KINDS);
  if (
    rows.length !== expected.size ||
    new Set(actual).size !== expected.size ||
    actual.some((kind) => !expected.has(kind))
  ) {
    throw new Error(label + " is missing required schema categories or contains unknown ones.");
  }
}

export function certifySchemaParity(baseline, candidate) {
  checkCategories(baseline, "Baseline");
  checkCategories(candidate, "Candidate");
  const mismatches = compareSchemaReports(baseline, candidate);
  return { certified: mismatches.length === 0, mismatches };
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    if (process.argv.length !== 4) {
      throw new Error("Usage: node scripts/certify-schema-parity.mjs baseline.json candidate.json");
    }
    const baseline = JSON.parse(readFileSync(process.argv[2], "utf8"));
    const candidate = JSON.parse(readFileSync(process.argv[3], "utf8"));
    const result = certifySchemaParity(baseline, candidate);
    console.log(JSON.stringify(result, null, 2));
    if (!result.certified) process.exitCode = 1;
  } catch (error) {
    console.error("Schema certification invalid: " + String(error.message ?? error));
    process.exitCode = 2;
  }
}
