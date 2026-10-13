import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { compareSchemaReports } from "./check-schema-drift.mjs";

const a = "0".repeat(32);
const b = "1".repeat(32);
const baseline = [
  { kind: "column", object_count: 2, fingerprint: a },
  { kind: "policy", object_count: 1, fingerprint: b },
];

test("accepts equivalent snapshots independently of category ordering", () => {
  assert.deepEqual(compareSchemaReports(baseline, [...baseline].reverse()), []);
});

test("detects changed definitions even when object counts match", () => {
  const changed = [
    { kind: "column", object_count: 2, fingerprint: b },
    baseline[1],
  ];
  assert.deepEqual(
    compareSchemaReports(baseline, changed).map((row) => row.kind),
    ["column"],
  );
});

test("detects added objects and missing schema categories", () => {
  const changed = [{ kind: "column", object_count: 3, fingerprint: a }];
  assert.deepEqual(
    compareSchemaReports(baseline, changed).map((row) => row.kind),
    ["column", "policy"],
  );
});

test("rejects duplicate categories and invalid fingerprints", () => {
  assert.throws(() => compareSchemaReports(baseline, [...baseline, baseline[0]]));
  assert.throws(() =>
    compareSchemaReports(baseline, [
      { kind: "column", object_count: 2, fingerprint: "invalid" },
    ]),
  );
});

test("CLI blocks certification on synthetic drift and accepts equal snapshots", () => {
  const directory = mkdtempSync(join(tmpdir(), "studioflow-schema-drift-"));
  const left = join(directory, "baseline.json");
  const right = join(directory, "candidate.json");
  const program = fileURLToPath(new URL("./check-schema-drift.mjs", import.meta.url));
  try {
    writeFileSync(left, JSON.stringify(baseline));
    writeFileSync(right, JSON.stringify(baseline));
    const success = spawnSync(process.execPath, [program, left, right], {
      encoding: "utf8",
    });
    assert.equal(success.status, 0);
    assert.equal(JSON.parse(success.stdout).passed, true);

    writeFileSync(
      right,
      JSON.stringify([{ kind: "column", object_count: 3, fingerprint: a }]),
    );
    const failure = spawnSync(process.execPath, [program, left, right], {
      encoding: "utf8",
    });
    assert.equal(failure.status, 1);
    assert.equal(JSON.parse(failure.stdout).passed, false);
    assert.deepEqual(
      JSON.parse(failure.stdout).mismatches.map((row) => row.kind),
      ["column", "policy"],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
