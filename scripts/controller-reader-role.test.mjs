// Local isolated PostgreSQL rehearsal. Run from a checkout with the existing
// @electric-sql/pglite dependency installed; never in a credentials-holding job.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import test from "node:test";
import { CAPTURE_SQL } from "./capture-schema-attestation.mjs";

const require = createRequire(resolve("package.json"));
const { PGlite } = require("@electric-sql/pglite");
const proposal = readFileSync(
  new URL("./sql/reader-role.proposal.sql", import.meta.url),
  "utf8",
);
const productionProposal = readFileSync(
  new URL("./sql/production-net-usage.proposal.sql", import.meta.url),
  "utf8",
);
const forecast = readFileSync(
  new URL("./sql/reader-public-preflight.sql", import.meta.url),
  "utf8",
);
const roles = [
  "postgres",
  "supabase_admin",
  "supabase_functions_admin",
  "anon",
  "authenticated",
  "service_role",
];

async function fixture() {
  const db = new PGlite();
  for (const role of roles) {
    if (
      !(await db.query("SELECT 1 FROM pg_roles WHERE rolname=$1", [role])).rows
        .length
    ) {
      await db.exec(`CREATE ROLE ${role} NOLOGIN`);
    }
  }
  await db.exec(`CREATE SCHEMA net AUTHORIZATION supabase_admin;
    GRANT USAGE ON SCHEMA net TO PUBLIC, postgres, supabase_functions_admin, anon, authenticated, service_role;
    CREATE TABLE net.http_request_queue(id integer);
    CREATE TABLE net._http_response(id integer);
    GRANT ALL ON net.http_request_queue, net._http_response TO PUBLIC;
    CREATE FUNCTION net.http_post() RETURNS integer LANGUAGE sql AS 'INSERT INTO net.http_request_queue VALUES(1) RETURNING id';`);
  return db;
}

async function publicCount(db) {
  return (await db.query(forecast)).rows[0].reader_preflight
    .public_relation_access;
}

test("PUBLIC net grants are detected and block reader creation atomically", async () => {
  const db = await fixture();
  try {
    assert.equal(await publicCount(db), 2);
    await assert.rejects(
      db.exec(proposal),
      /PUBLIC grants exceed reader contract/,
    );
    await db.exec("ROLLBACK");
    assert.equal(
      (
        await db.query(
          "SELECT 1 FROM pg_roles WHERE rolname='sf_gov_schema_reader'",
        )
      ).rows.length,
      0,
    );
    assert.equal(await publicCount(db), 2);
  } finally {
    await db.close();
  }
});

test("NOINHERIT and a per-reader REVOKE do not remove inherited PUBLIC access", async () => {
  const db = await fixture();
  try {
    await db.exec(`CREATE ROLE sf_gov_schema_reader NOLOGIN NOINHERIT;
      REVOKE ALL ON net.http_request_queue, net._http_response FROM sf_gov_schema_reader;
      SET ROLE sf_gov_schema_reader;`);
    assert.equal(
      (
        await db.query(
          "SELECT has_table_privilege(current_user,'net.http_request_queue','INSERT') AS allowed",
        )
      ).rows[0].allowed,
      true,
    );
    const result = await db.exec(CAPTURE_SQL);
    const identity = result.find((r) => r.rows[0]?.json_build_object)?.rows[0]
      .json_build_object;
    assert.equal(identity.readonly, "on");
    assert.equal(identity.data_access, 2);
  } finally {
    await db.close();
  }
});

test("scoped net USAGE removal preserves explicit callers and permits a disabled reader with no net access", async () => {
  const db = await fixture();
  try {
    // Only this ACL statement is rehearsed positively. This model does not load
    // the native pg_net extension or certify production dependencies.
    await db.exec("REVOKE USAGE ON SCHEMA net FROM PUBLIC");
    for (const role of roles) {
      assert.equal(
        (
          await db.query(
            "SELECT has_schema_privilege($1,'net','USAGE') AS allowed",
            [role],
          )
        ).rows[0].allowed,
        true,
      );
    }
    assert.equal(await publicCount(db), 0);
    await db.exec(proposal);
    const role = (
      await db.query(
        "SELECT rolcanlogin,rolsuper,rolcreaterole,rolcreatedb,rolreplication,rolbypassrls,rolinherit,rolconnlimit FROM pg_roles WHERE rolname='sf_gov_schema_reader'",
      )
    ).rows[0];
    assert.deepEqual(role, {
      rolcanlogin: false,
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolreplication: false,
      rolbypassrls: false,
      rolinherit: false,
      rolconnlimit: 2,
    });
    await db.exec("SET ROLE sf_gov_schema_reader");
    await assert.rejects(
      db.query("SELECT * FROM net.http_request_queue"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("SELECT net.http_post()"),
      /permission denied/,
    );
    const result = await db.exec(CAPTURE_SQL);
    const identity = result.find((r) => r.rows[0]?.json_build_object)?.rows[0]
      .json_build_object;
    assert.equal(identity.safe, true);
    assert.equal(identity.memberships, 0);
    assert.equal(identity.data_access, 0);
    assert.equal(identity.definer_access, 0);
    assert.equal(identity.readonly, "on");
  } finally {
    await db.close();
  }
});

test("existing reader is not adopted, altered or overwritten", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "CREATE ROLE sf_gov_schema_reader NOLOGIN CONNECTION LIMIT 7",
    );
    await assert.rejects(db.exec(proposal), /Reader already exists/);
    await db.exec("ROLLBACK");
    assert.equal(
      (
        await db.query(
          "SELECT rolconnlimit FROM pg_roles WHERE rolname='sf_gov_schema_reader'",
        )
      ).rows[0].rolconnlimit,
      7,
    );
  } finally {
    await db.close();
  }
});

test("production proposal refuses an environment without the exact pg_net version", async () => {
  const db = await fixture();
  try {
    await assert.rejects(
      db.exec(productionProposal),
      /Unexpected production database\/extension/,
    );
    await db.exec("ROLLBACK");
    assert.equal(await publicCount(db), 2);
  } finally {
    await db.close();
  }
});

test("PUBLIC access regression is detected again after the reader was prepared", async () => {
  const db = await fixture();
  try {
    await db.exec("REVOKE USAGE ON SCHEMA net FROM PUBLIC");
    await db.exec(proposal);
    await db.exec(
      "GRANT USAGE ON SCHEMA net TO PUBLIC; SET ROLE sf_gov_schema_reader",
    );
    const result = await db.exec(CAPTURE_SQL);
    const identity = result.find((r) => r.rows[0]?.json_build_object)?.rows[0]
      .json_build_object;
    assert.equal(identity.data_access, 2);
  } finally {
    await db.close();
  }
});

test("explicit net USAGE without schema ownership is rejected before ACL changes", async () => {
  const db = await fixture();
  try {
    await db.exec("SET ROLE anon");
    assert.equal(
      (
        await db.query(
          "SELECT has_schema_privilege(current_user,'net','USAGE') AS allowed",
        )
      ).rows[0].allowed,
      true,
    );
    await assert.rejects(
      db.exec(productionProposal),
      /Net schema owner authority unavailable/,
    );
    await db.exec("ROLLBACK");
    assert.equal(await publicCount(db), 2);
    assert.equal(
      (
        await db.query(
          "SELECT 1 FROM pg_roles WHERE rolname='sf_gov_schema_reader'",
        )
      ).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
