// Reviewed independent behavior checks. Only run inside isolated certification.
import assert from "node:assert/strict";
import { sumSafeIntegers } from "./recovery-proof.mjs";
assert.equal(sumSafeIntegers([]), 0);
assert.equal(sumSafeIntegers([3, -2, 7]), 8);
const input = Object.freeze([1, 2, 3]);
assert.equal(sumSafeIntegers(input), 6);
assert.deepEqual(input, [1, 2, 3]);
for (const value of [
  null,
  {},
  "123",
  [1, "2"],
  [NaN],
  [Infinity],
  [1.5],
  [Number.MAX_SAFE_INTEGER, 1],
  [Number.MIN_SAFE_INTEGER, -1],
])
  assert.throws(() => sumSafeIntegers(value), TypeError);
console.log("PASS independent safe-integer behavior and immutability");
