import assert from "node:assert/strict";
import test from "node:test";
import {
  githubReservationStore,
  REHEARSAL_PREFIX,
} from "./metadata-broker-reservation.mjs";
const controllerSha = "a".repeat(40),
  baseTreeSha = "b".repeat(40),
  id = "12345678-1234-4123-8123-123456789abc",
  binding = "c".repeat(64);
function server() {
  const refs = new Map(),
    calls = [];
  let sequence = 0;
  return {
    refs,
    calls,
    api: async (method, path, body) => {
      calls.push({ method, path, body });
      if (method === "GET") {
        const ref = "refs/heads/" + path.split("/git/ref/heads/")[1];
        return refs.has(ref)
          ? { status: 200, body: refs.get(ref) }
          : { status: 404 };
      }
      if (path.endsWith("/git/trees") || path.endsWith("/git/commits"))
        return {
          status: 201,
          body: { sha: (++sequence).toString(16).padStart(40, "0") },
        };
      if (path.endsWith("/git/refs")) {
        if (refs.has(body.ref)) return { status: 422 };
        const result = { ref: body.ref, object: { sha: body.sha } };
        refs.set(body.ref, result);
        return { status: 201, body: result };
      }
      throw Error("unexpected");
    },
  };
}
const store = (api) =>
  githubReservationStore({ api, controllerSha, baseTreeSha, rehearsal: true });
test("reservation persists in shared Git state across independent store instances", async () => {
  const s = server();
  assert.equal(await store(s.api)(id, binding), true);
  assert.equal(await store(s.api)(id, binding), false);
  assert.equal(s.refs.size, 1);
  const writes = s.calls.filter((x) => x.method === "POST");
  assert.equal(writes.length, 3);
  assert.equal(writes[0].body.base_tree, baseTreeSha);
  assert.deepEqual(writes[1].body.parents, [controllerSha]);
  assert.equal(writes[2].body.ref, "refs/heads/" + REHEARSAL_PREFIX + id);
});
test("concurrent creators have one atomic winner without update, deletion or retry", async () => {
  const s = server();
  const r = await Promise.all([
    store(s.api)(id, binding),
    store(s.api)(id, binding),
  ]);
  assert.deepEqual(r.sort(), [false, true]);
  assert.equal(s.refs.size, 1);
  assert.ok(s.calls.every((x) => ["GET", "POST"].includes(x.method)));
});
test("same UUID cannot be reinterpreted under a new binding", async () => {
  const s = server();
  await store(s.api)(id, binding);
  assert.equal(await store(s.api)(id, "d".repeat(64)), false);
});
test("invalid IDs or binding cause no remote calls", async () => {
  const s = server();
  for (const args of [
    ["../main", binding],
    [id, "secret"],
    [id, undefined],
  ])
    await assert.rejects(store(s.api)(...args), /reservation denied/);
  assert.equal(s.calls.length, 0);
});
test("read, write or ambiguous network failures fail closed without retry", async () => {
  for (const failure of [0, 1, 2, 3]) {
    const s = server();
    let count = 0;
    const api = async (...args) => {
      if (count++ === failure) throw Error("fake sensitive connection");
      return s.api(...args);
    };
    await assert.rejects(
      store(api)(id, binding),
      (e) => e.message === "Broker reservation denied",
    );
    assert.equal(count, failure + 1);
  }
});
test("403 and non-201 commit/ref responses cannot grant a reservation", async () => {
  for (const failAt of [0, 1, 2, 3]) {
    const s = server();
    let count = 0;
    await assert.rejects(
      store(async (...args) =>
        count++ === failAt ? { status: 403 } : s.api(...args),
      )(id, binding),
      /reservation denied/,
    );
  }
});
