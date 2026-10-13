import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const fingerprintSql = readFileSync(
  new URL("./sql/schema-fingerprint.sql", import.meta.url),
  "utf8",
);
const gate = fileURLToPath(new URL("./certify-schema-parity.mjs", import.meta.url));

// Real PostgreSQL catalog/DDL in WASM, entirely in memory. No connection string,
// Supabase credentials, application records, network integrations, or paid resource.
// This exercises the detector, not Supabase parity or the protected release signer.
test("physical public-schema drift denies CLI certification and rollback restores it", async () => {
  const db = new PGlite();
  const dir = mkdtempSync(join(tmpdir(), "sf-gov-physical-drift-"));
  const capture = async () => (await db.query(fingerprintSql)).rows;
  const certify = (baseline, candidate) => {
    const left = join(dir, "baseline.json");
    const right = join(dir, "candidate.json");
    writeFileSync(left, JSON.stringify(baseline));
    writeFileSync(right, JSON.stringify(candidate));
    const result = spawnSync(process.execPath, [gate, left, right], { encoding: "utf8" });
    assert.ifError(result.error);
    return { status: result.status, report: JSON.parse(result.stdout) };
  };
  try {
    await db.exec(`
      CREATE TABLE public.synthetic_probe (id integer PRIMARY KEY);
      ALTER TABLE public.synthetic_probe ENABLE ROW LEVEL SECURITY;
      CREATE POLICY synthetic_probe_policy ON public.synthetic_probe USING (false);
      CREATE FUNCTION public.synthetic_probe_trigger() RETURNS trigger LANGUAGE plpgsql
        AS $$ BEGIN RETURN NEW; END; $$;
      CREATE TRIGGER synthetic_probe_trigger BEFORE INSERT ON public.synthetic_probe
        FOR EACH ROW EXECUTE FUNCTION public.synthetic_probe_trigger();
    `);
    const baseline = await capture();
    assert.equal(certify(baseline, baseline).status, 0);
    await db.exec("BEGIN; ALTER TABLE public.synthetic_probe ADD COLUMN divergence_probe text;");
    const changed = await capture();
    const denied = certify(baseline, changed);
    assert.equal(denied.status, 1);
    assert.equal(denied.report.certified, false);
    assert.deepEqual(
      denied.report.mismatches.map((row) => row.kind),
      ["column"],
    );
    assert.equal(
      changed.find((row) => row.kind === "column").object_count,
      baseline.find((row) => row.kind === "column").object_count + 1,
    );
    await db.exec("ROLLBACK;");
    const restored = await capture();
    assert.deepEqual(restored, baseline);
    assert.equal(certify(baseline, restored).status, 0);
    const remaining = await db.query(`SELECT count(*)::int AS count
      FROM information_schema.columns WHERE table_schema = 'public'
      AND table_name = 'synthetic_probe' AND column_name = 'divergence_probe'`);
    assert.equal(remaining.rows[0].count, 0);
    console.log(
      JSON.stringify({
        environment: "isolated-in-memory-postgresql-wasm",
        engine: (await db.query("SELECT version() AS version")).rows[0].version,
        baseline,
        changed,
        restored,
        certificationBefore: 0,
        certificationDuring: 1,
        certificationAfter: 0,
        persistentProbeColumns: 0,
      }),
    );
  } finally {
    await db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
