// Trusted independent acceptance, prepared before the real model invocation.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const receipt = (taskId, suffix = 1) => ({
  taskId,
  commitSha: suffix.toString(16).padStart(40, "0"),
  url: `https://github.com/mikevazquez/Demeter/pull/${suffix}`,
  draft: true,
});
export function verifyReceiptFunction(fn) {
  assert.equal(typeof fn, "function");
  let cases = 0;
  const check = (input, expected) => {
    const before = structuredClone(input);
    for (const value of input) if (value && typeof value === "object") Object.freeze(value);
    Object.freeze(input);
    const output = fn(input);
    assert.deepEqual(output, expected);
    assert.deepEqual(input, before);
    assert.notEqual(output, input);
    for (const item of output) for (const source of input) assert.notEqual(item, source);
    cases++;
  };
  const invalid = (input) => {
    assert.throws(() => fn(input), TypeError);
    cases++;
  };
  check([], []);
  const a = receipt("task-a", 1),
    b = receipt("task-b", 2),
    reordered = { draft: true, url: a.url, commitSha: a.commitSha, taskId: a.taskId };
  check([b, a, reordered], [a, b]);
  check([receipt("abc0", 4), receipt("abc-1", 3)], [receipt("abc-1", 3), receipt("abc0", 4)]);
  for (const input of [null, undefined, {}, "x", 42, new Array(1), [a, , b], [null], [[]], [true]])
    invalid(input);
  for (const change of [
    { taskId: "ab" },
    { taskId: " task-a" },
    { taskId: "A-b" },
    { taskId: "a".repeat(81) },
    { taskId: 7 },
    { commitSha: "A".repeat(40) },
    { commitSha: "a".repeat(39) },
    { commitSha: 17 },
    { draft: false },
    { draft: "true" },
    { url: "https://github.com/mikevazquez/Demeter/pull/0" },
    { url: "https://github.com/mikevazquez/Demeter/pull/01" },
    { url: a.url + "/" },
    { url: "https://example.com/pull/1" },
    { url: 1 },
    { extra: true },
  ])
    invalid([{ ...a, ...change }]);
  const missing = { ...a };
  delete missing.draft;
  invalid([missing]);
  const symbol = { ...a };
  symbol[Symbol("extra")] = true;
  invalid([symbol]);
  const hidden = { ...a };
  Object.defineProperty(hidden, "extra", { value: true });
  invalid([hidden]);
  for (const field of ["commitSha", "url"])
    invalid([
      a,
      {
        ...a,
        [field]:
          field === "commitSha" ? "f".repeat(40) : "https://github.com/mikevazquez/Demeter/pull/99",
      },
    ]);
  invalid([a, { ...a, taskId: "another-task" }]);
  let seed = 318;
  for (let round = 0; round < 50; round++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const values = Array.from({ length: 1 + (seed % 12) }, (_, i) =>
      receipt(`task-${String(i).padStart(3, "0")}`, i + 1),
    );
    const input = [
      ...values.toReversed(),
      ...values.map((x) => ({
        draft: x.draft,
        url: x.url,
        taskId: x.taskId,
        commitSha: x.commitSha,
      })),
    ];
    check(input, values);
  }
  return { passed: true, cases };
}
export async function verifyReceiptModule(url = new URL("./receipt-proof.mjs", import.meta.url)) {
  const source = fs.readFileSync(url, "utf8");
  assert(
    !/\bimport\s*(?:\(|["'{*])|\b(?:require|fetch|eval)\s*\(|\bprocess\s*[.\[]/.test(source),
    "Receipt proof must be pure and have no imports/process/network",
  );
  const loaded = await import(url.href);
  assert.deepEqual(Object.keys(loaded), ["normalizeReceiptSet"]);
  return verifyReceiptFunction(loaded.normalizeReceiptSet);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await verifyReceiptModule()));
