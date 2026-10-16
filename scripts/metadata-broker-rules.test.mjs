import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { verifyReservationRuleset } from "./metadata-broker-rules.mjs";
const draft = () =>
  JSON.parse(
    readFileSync(
      new URL(
        "../controller/broker-reservations.ruleset.proposal.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
test("prepared ruleset permits a create-only namespace without a bypass actor", () =>
  assert.equal(verifyReservationRuleset(draft()), true));
for (const [name, change] of Object.entries({
  disabled: (r) => (r.enforcement = "disabled"),
  wrongTarget: (r) => (r.target = "tag"),
  bypass: (r) =>
    r.bypass_actors.push({
      actor_id: 1,
      actor_type: "RepositoryRole",
      bypass_mode: "always",
    }),
  wrongPattern: (r) => (r.conditions.ref_name.include = ["refs/heads/main"]),
  exclusion: (r) =>
    (r.conditions.ref_name.exclude = [
      "refs/heads/evidence/sf-gov-broker-reservations/*",
    ]),
  missingUpdate: (r) => (r.rules = r.rules.filter((x) => x.type !== "update")),
  missingDelete: (r) =>
    (r.rules = r.rules.filter((x) => x.type !== "deletion")),
  missingForce: (r) =>
    (r.rules = r.rules.filter((x) => x.type !== "non_fast_forward")),
  mergeException: (r) =>
    (r.rules.find((x) => x.type === "update").parameters = {
      update_allows_fetch_and_merge: true,
    }),
})) {
  test("refuses namespace protection with " + name, () => {
    const r = draft();
    change(r);
    assert.throws(() => verifyReservationRuleset(r), /not verified/);
  });
}

import { githubReservationStore } from "./metadata-broker-reservation.mjs";
test("production store cannot be configured without a ruleset ID", () => {
  assert.throws(
    () =>
      githubReservationStore({
        api: async () => {},
        controllerSha: "a".repeat(40),
        baseTreeSha: "b".repeat(40),
      }),
    /reservation denied/,
  );
});
test("production reservation rereads protection and denies disabled rules before reservation writes", async () => {
  const calls = [];
  const ruleset = draft();
  ruleset.enforcement = "disabled";
  const reserve = githubReservationStore({
    api: async (method, path) => {
      calls.push({ method, path });
      return { status: 200, body: ruleset };
    },
    controllerSha: "a".repeat(40),
    baseTreeSha: "b".repeat(40),
    rulesetId: 1234,
  });
  await assert.rejects(
    reserve("12345678-1234-4123-8123-123456789abc", "c".repeat(64)),
    /reservation denied/,
  );
  assert.deepEqual(calls, [
    { method: "GET", path: "/repos/mikevazquez/Demeter/rulesets/1234" },
  ]);
});
