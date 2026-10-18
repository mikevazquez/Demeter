// Explicit negative checker fixtures. No implementation of the model's task is supplied.
import { expect, it } from "vitest";
import { verifyReceiptFunction } from "../../scripts/automation/verify-receipt-proof.mjs";
it.each([
  () => [],
  (input) => input,
  (input) => input.map((value) => ({ ...value })),
  (input) => input.toReversed().map((value) => ({ ...value })),
])("rejects an inadequate candidate behavior", (fn) => {
  expect(() => verifyReceiptFunction(fn)).toThrow();
});
