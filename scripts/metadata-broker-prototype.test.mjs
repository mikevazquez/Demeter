import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import {
  BROKER_SQL,
  BROKER_QUERY_SHA256,
  captureBrokerDiagnostic,
} from "./metadata-broker-prototype.mjs";
import { REQUIRED_SCHEMA_KINDS } from "./certify-schema-parity.mjs";
import {
  verifySchemaAttestation,
  SCHEMA_PRODUCTION_REF as PROD,
  SCHEMA_CANDIDATE_REF as CAND,
} from "./verify-schema-attestation.mjs";
const clock = new Date("2026-10-16T12:00:00.000Z");
const report = () =>
  REQUIRED_SCHEMA_KINDS.map((kind) => ({
    kind,
    object_count: 1,
    fingerprint: "a".repeat(32),
  }));
function fixture() {
  const request = {
    version: 1,
    candidate_sha: "a".repeat(40),
    request_id: "12345678-1234-4123-8123-123456789abc",
  };
  const authorization = {
    ...request,
    controller_sha: "b".repeat(40),
    query_sha256: BROKER_QUERY_SHA256,
    expires_at: "2026-10-16T12:01:00.000Z",
  };
  delete authorization.version;
  const calls = [];
  const consumed = new Set();
  const adapters = {
    now: () => clock,
    reserve: async (id) => {
      if (consumed.has(id)) return false;
      consumed.add(id);
      return true;
    },
    readCatalog: async (args) => {
      calls.push(args);
      return report();
    },
  };
  return { request, authorization, adapters, calls };
}
const run = (f) =>
  captureBrokerDiagnostic(f.request, f.authorization, f.adapters);

test("fixed query and fixed projects yield diagnostic only, rejected by the release verifier", async () => {
  const f = fixture();
  const result = await run(f);
  assert.deepEqual(
    f.calls.map((x) => x.projectRef),
    [PROD, CAND],
  );
  assert.ok(
    f.calls.every(
      (x) =>
        x.sql === BROKER_SQL &&
        Object.keys(x).sort().join(",") === "projectRef,signal,sql",
    ),
  );
  assert.equal(result.comparison.certified, true);
  assert.equal(result.release_eligible, false);
  assert.match(
    verifySchemaAttestation(result, {
      checkedOutSha: f.request.candidate_sha,
      key: "test-only-key-".repeat(4),
      now: clock,
    }).join(";"),
    /Unknown capture source/,
  );
  assert.equal(result.signature, undefined);
});

for (const [name, patch] of Object.entries({
  sql: { sql: "DELETE FROM public.orders" },
  endpoint: { endpoint: "https://example.com" },
  project: { projectRef: CAND },
  path: { output: "/tmp/out" },
  secret: { password: "fake" },
  missing: { candidate_sha: undefined },
  mutable: { candidate_sha: "main" },
  nonce: { request_id: "reuse" },
  version: { version: 2 },
})) {
  test(`rejects request ${name} before reservation or any catalog read`, async () => {
    const f = fixture();
    let reserved = 0;
    f.adapters.reserve = async () => {
      reserved++;
      return true;
    };
    Object.assign(f.request, patch);
    await assert.rejects(run(f), /denied/);
    assert.equal(reserved, 0);
    assert.equal(f.calls.length, 0);
  });
}
for (const [name, patch] of Object.entries({
  sha: { candidate_sha: "c".repeat(40) },
  controller: { controller_sha: "main" },
  controllerArray: { controller_sha: ["b".repeat(40)] },
  expiryArray: { expires_at: ["2026-10-16T12:01:00.000Z"] },
  query: { query_sha256: "0".repeat(64) },
  nonce: { request_id: "22345678-1234-4123-8123-123456789abc" },
  expired: { expires_at: "2026-10-16T11:59:00.000Z" },
  unbounded: { expires_at: "2026-10-17T12:00:00.000Z" },
  extra: { allow: true },
})) {
  test(`rejects authorization ${name} without invoking transport`, async () => {
    const f = fixture();
    Object.assign(f.authorization, patch);
    await assert.rejects(run(f), /denied/);
    assert.equal(f.calls.length, 0);
  });
}

test("missing reservation adapter means no read", async () => {
  const f = fixture();
  delete f.adapters.reserve;
  await assert.rejects(run(f), /denied/);
  assert.equal(f.calls.length, 0);
});
test("same request is consumed once even under concurrent attempts", async () => {
  const f = fixture();
  const r = await Promise.allSettled([run(f), run(f)]);
  assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal(f.calls.length, 2);
});
test("adapter errors are sanitized and failed requests cannot be reused", async () => {
  const f = fixture();
  f.adapters.readCatalog = async () => {
    throw new Error("postgresql://secret:password@host");
  };
  await assert.rejects(
    run(f),
    (e) => e.message === "Metadata broker request denied",
  );
  await assert.rejects(run(f), /denied/);
});
test("authorization expiry between reads prevents completion", async () => {
  const f = fixture();
  f.adapters.readCatalog = async (args) => {
    f.calls.push(args);
    f.adapters.now = () => new Date("2026-10-16T12:02:00.000Z");
    return report();
  };
  f.adapters.now = () =>
    f.calls.length ? new Date("2026-10-16T12:02:00.000Z") : clock;
  await assert.rejects(run(f), /denied/);
  assert.equal(f.calls.length, 1);
});
for (const [name, change] of Object.entries({
  extra: (rows) => {
    rows[0].definition = "private source";
  },
  missing: (rows) => rows.pop(),
  duplicate: (rows) => {
    rows[1] = { ...rows[0] };
  },
  invalid: (rows) => {
    rows[0].object_count = -1;
  },
})) {
  test(`rejects ${name} response without returning an artifact`, async () => {
    const f = fixture();
    f.adapters.readCatalog = async () => {
      const rows = report();
      change(rows);
      return rows;
    };
    await assert.rejects(run(f), /denied/);
  });
}
test("schema drift is visible but cannot produce release evidence", async () => {
  const f = fixture();
  f.adapters.readCatalog = async ({ projectRef }) => {
    const rows = report();
    if (projectRef === CAND) rows[0].fingerprint = "b".repeat(32);
    return rows;
  };
  const r = await run(f);
  assert.equal(r.comparison.certified, false);
  assert.equal(r.release_eligible, false);
  assert.equal(r.comparison.mismatches.length, 1);
});
test("caller mutation while awaiting cannot change validated identity", async () => {
  const f = fixture();
  const reserve = f.adapters.reserve;
  f.adapters.reserve = async (...args) => {
    f.request.candidate_sha = "c".repeat(40);
    return reserve(...args);
  };
  const r = await run(f);
  assert.equal(r.candidate_sha, "a".repeat(40));
});

test("reservation storage errors never expose raw credentials", async () => {
  const f = fixture();
  f.adapters.reserve = async () => {
    throw new Error("fake secret connection string");
  };
  await assert.rejects(
    run(f),
    (e) => e.message === "Metadata broker request denied",
  );
  assert.equal(f.calls.length, 0);
});

test("transport timeout aborts and yields no diagnostic", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const f = fixture();
  let signal;
  let enter;
  const entered = new Promise((resolve) => {
    enter = resolve;
  });
  f.adapters.readCatalog = (args) => {
    signal = args.signal;
    enter();
    return new Promise(() => {});
  };
  const pending = run(f);
  await entered;
  t.mock.timers.tick(30000);
  await assert.rejects(pending, /denied/);
  assert.equal(signal.aborted, true);
});

test("recorded live catalogs remain diagnostic and show drift in all seven categories", async () => {
  const observation = JSON.parse(
    readFileSync(
      new URL(
        "../evidence/metadata-broker-20261016/catalog-diagnostic.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const f = fixture();
  // Replay saved metadata through the boundary; this is not a new remote capture.
  f.adapters.readCatalog = async ({ projectRef }) =>
    projectRef === PROD ? observation.baseline : observation.candidate;
  const result = await run(f);
  assert.equal(result.comparison.certified, false);
  assert.equal(result.comparison.mismatches.length, 7);
  assert.equal(result.release_eligible, false);
  assert.equal(observation.release_eligible, false);
});
