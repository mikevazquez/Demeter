import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const HASH = /^[0-9a-f]{32}$/;

function validateReport(rows, label) {
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error(label + " must be a nonempty array of schema fingerprints.");
  }
  const byKind = new Map();
  for (const row of rows) {
    if (
      !row ||
      typeof row.kind !== "string" ||
      !/^[a-z_]+$/.test(row.kind) ||
      !Number.isSafeInteger(row.object_count) ||
      row.object_count < 0 ||
      typeof row.fingerprint !== "string" ||
      !HASH.test(row.fingerprint)
    ) {
      throw new Error(label + " contains an invalid schema fingerprint row.");
    }
    if (byKind.has(row.kind)) {
      throw new Error(label + " contains duplicate category " + row.kind + ".");
    }
    byKind.set(row.kind, row);
  }
  return byKind;
}

export function compareSchemaReports(baseline, candidate) {
  const left = validateReport(baseline, "Baseline");
  const right = validateReport(candidate, "Candidate");
  const kinds = [...new Set([...left.keys(), ...right.keys()])].sort();
  return kinds.flatMap((kind) => {
    const expected = left.get(kind);
    const actual = right.get(kind);
    if (
      expected &&
      actual &&
      expected.object_count === actual.object_count &&
      expected.fingerprint === actual.fingerprint
    ) {
      return [];
    }
    return [
      {
        kind,
        baseline_count: expected?.object_count ?? null,
        candidate_count: actual?.object_count ?? null,
        baseline_fingerprint: expected?.fingerprint ?? null,
        candidate_fingerprint: actual?.fingerprint ?? null,
      },
    ];
  });
}

function run() {
  if (process.argv.length !== 4) {
    console.error(
      "Usage: node scripts/check-schema-drift.mjs baseline.json candidate.json",
    );
    process.exitCode = 2;
    return;
  }
  try {
    const baseline = JSON.parse(readFileSync(process.argv[2], "utf8"));
    const candidate = JSON.parse(readFileSync(process.argv[3], "utf8"));
    const mismatches = compareSchemaReports(baseline, candidate);
    console.log(JSON.stringify({ passed: mismatches.length === 0, mismatches }, null, 2));
    if (mismatches.length > 0) process.exitCode = 1;
  } catch (error) {
    console.error("Cannot compare schema reports: " + String(error.message ?? error));
    process.exitCode = 2;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  run();
}
