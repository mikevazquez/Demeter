import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  fetchReservationProtection,
  PROTECTION_URL,
  VERIFIED_RULESET_ID,
} from "./metadata-broker-protection-preflight.mjs";
const rule = () => ({
  ...JSON.parse(
    readFileSync(
      new URL(
        "../controller/broker-reservations.ruleset.proposal.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
  id: VERIFIED_RULESET_ID,
  source: "mikevazquez/Demeter",
});
test("fetches only the pinned rule without credentials and returns a non-capture report", async () => {
  const r = await fetchReservationProtection(async (url, options) => {
    assert.equal(url, PROTECTION_URL);
    assert.equal(options.redirect, "error");
    assert.ok(options.signal);
    assert.equal(
      Object.keys(options.headers).some(
        (k) => k.toLowerCase() === "authorization",
      ),
      false,
    );
    return new Response(JSON.stringify(rule()));
  });
  assert.equal(r.protection_verified, true);
  assert.equal(r.capture_activated, false);
  assert.equal(r.sql_executed, false);
});
test("refuses a different rule ID or repository source", async () => {
  for (const patch of [{ id: 1 }, { source: "attacker/Demeter" }])
    await assert.rejects(
      fetchReservationProtection(
        async () => new Response(JSON.stringify({ ...rule(), ...patch })),
      ),
      /preflight denied/,
    );
});
test("a disabled rule or invisible bypass list cannot be inferred safe", async () => {
  for (const patch of [
    { enforcement: "disabled" },
    { bypass_actors: undefined },
    { conditions: { ref_name: { include: [], exclude: [] } } },
  ])
    await assert.rejects(
      fetchReservationProtection(
        async () => new Response(JSON.stringify({ ...rule(), ...patch })),
      ),
      /preflight denied/,
    );
});
test("HTTP, parse and size failures return no raw provider data", async () => {
  for (const response of [
    new Response("fake-sensitive", { status: 403 }),
    new Response("{"),
    new Response("x".repeat(65537)),
  ])
    await assert.rejects(
      fetchReservationProtection(async () => response),
      (e) => e.message === "Reservation protection preflight denied",
    );
});
test("hosted protection check runs before identity request and requests no protected environment", () => {
  const y = readFileSync(
    new URL(
      "../.github/workflows/metadata-broker-oidc-rehearsal.yml",
      import.meta.url,
    ),
    "utf8",
  );
  assert.ok(
    y.indexOf("node scripts/metadata-broker-protection-preflight.mjs") <
      y.indexOf("node scripts/metadata-broker-oidc-rehearsal.mjs"),
  );
  assert.doesNotMatch(y, /\benvironment:|secrets\./);
  assert.match(y, /reservation-protection.json/);
});

test("ephemeral job token is sent only to the pinned GitHub endpoint and never returned", async () => {
  const report = await fetchReservationProtection(
    async (url, options) => {
      assert.equal(url, PROTECTION_URL);
      assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, "Bearer fake-job-read-token");
      return new Response(JSON.stringify(rule()));
    },
    { token: "fake-job-read-token" },
  );
  assert.ok(!JSON.stringify(report).includes("fake-job-read-token"));
});

test("hidden authenticated bypass list requires an explicitly visible public response", async () => {
  let calls = 0;
  const result = await fetchReservationProtection(
    async (url, options) => {
      calls++;
      assert.equal(url, PROTECTION_URL);
      const data = rule();
      if (options.headers.Authorization) delete data.bypass_actors;
      return new Response(JSON.stringify(data));
    },
    { token: "fake-job-read-token" },
  );
  assert.equal(calls, 2);
  assert.equal(result.protection_verified, true);
  assert.equal(result.public_fallback_used, true);
});
test("two hidden bypass views still deny; missing data is never interpreted as empty", async () => {
  let calls = 0;
  await assert.rejects(
    fetchReservationProtection(
      async () => {
        calls++;
        const data = rule();
        delete data.bypass_actors;
        return new Response(JSON.stringify(data));
      },
      { token: "fake-job-read-token" },
    ),
    (e) => e.code === "bypass_unavailable",
  );
  assert.equal(calls, 2);
});
