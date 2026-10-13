import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { certifySchemaParity } from "./certify-schema-parity.mjs";

const fixturePath = fileURLToPath(new URL("../docs/sf-gov-001/schema-audit/", import.meta.url));
const baseline = JSON.parse(readFileSync(join(fixturePath, "2026-10-13-production.json")));
const candidate = JSON.parse(readFileSync(join(fixturePath, "2026-10-13-candidate.json")));
const program = fileURLToPath(new URL("./certify-schema-parity.mjs", import.meta.url));

function runSchemaGate(left, right) {
  const dir = mkdtempSync(join(tmpdir(), "sf-schema-certification-"));
  try {
    const leftPath = join(dir, "baseline.json");
    const rightPath = join(dir, "candidate.json");
    writeFileSync(leftPath, JSON.stringify(left));
    writeFileSync(rightPath, JSON.stringify(right));
    return spawnSync(process.execPath, [program, leftPath, rightPath], {
      encoding: "utf8",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("real read-only snapshots reject Candidate on all seven schema categories", () => {
  const result = runSchemaGate(baseline, candidate);
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.certified, false);
  assert.deepEqual(
    report.mismatches.map((item) => item.kind),
    ["column", "extension", "index", "policy", "routine", "table_rls", "trigger"],
  );
});

test("equal complete synthetic snapshots pass the parity gate", () => {
  const result = runSchemaGate(baseline, structuredClone(baseline));
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), { certified: true, mismatches: [] });
});

test("identical incomplete snapshots cannot bypass the mandatory categories", () => {
  const incomplete = baseline.slice(1);
  const result = runSchemaGate(incomplete, incomplete);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /required schema categories/);
});

test("matching counts with a changed fingerprint still block certification", () => {
  const modified = structuredClone(baseline);
  modified[0].fingerprint = "f".repeat(32);
  const report = certifySchemaParity(baseline, modified);
  assert.equal(report.certified, false);
  assert.equal(report.mismatches.length, 1);
});

test("duplicated or unknown categories reject invalid evidence", () => {
  assert.throws(() => certifySchemaParity(baseline, [...candidate.slice(0, -1), candidate[0]]));
  assert.throws(() =>
    certifySchemaParity(baseline, [
      ...candidate.slice(0, -1),
      { kind: "unknown", object_count: 0, fingerprint: "0".repeat(32) },
    ]),
  );
});
