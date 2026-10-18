import { describe, expect, it } from "vitest";
import { sumSafeIntegers } from "../../scripts/automation/recovery-proof.mjs";

describe("sumSafeIntegers", () => {
  it("returns zero for an empty array", () => {
    expect(sumSafeIntegers([])).toBe(0);
  });

  it("sums positive, negative, and mixed integers", () => {
    expect(sumSafeIntegers([1, 2, 3])).toBe(6);
    expect(sumSafeIntegers([-1, -2, -3])).toBe(-6);
    expect(sumSafeIntegers([5, -8, 3, 0])).toBe(0);
  });

  it("accepts safe integer boundaries", () => {
    expect(sumSafeIntegers([Number.MAX_SAFE_INTEGER])).toBe(Number.MAX_SAFE_INTEGER);
    expect(sumSafeIntegers([Number.MIN_SAFE_INTEGER])).toBe(Number.MIN_SAFE_INTEGER);
  });

  it("does not mutate frozen input", () => {
    const values = Object.freeze([4, -2, 7]);
    expect(sumSafeIntegers(values)).toBe(9);
    expect(values).toEqual([4, -2, 7]);
  });

  it("rejects non-array input", () => {
    for (const value of [
      undefined,
      null,
      true,
      1,
      "123",
      {},
      { 0: 1, length: 1 },
      new Int32Array([1]),
    ]) {
      expect(() => sumSafeIntegers(value)).toThrow(TypeError);
    }
  });

  it("rejects entries that are not Number safe integers", () => {
    for (const value of [
      undefined,
      null,
      true,
      "1",
      1n,
      Symbol("integer"),
      {},
      [],
      new Number(1),
      0.5,
      NaN,
      Infinity,
      -Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      Number.MIN_SAFE_INTEGER - 1,
    ]) {
      expect(() => sumSafeIntegers([1, value])).toThrow(TypeError);
    }
  });

  it("rejects positive and negative overflow", () => {
    expect(() => sumSafeIntegers([Number.MAX_SAFE_INTEGER, 1])).toThrow(TypeError);
    expect(() => sumSafeIntegers([Number.MIN_SAFE_INTEGER, -1])).toThrow(TypeError);
  });

  it("rejects intermediate overflow even when later entries would cancel it", () => {
    expect(() => sumSafeIntegers([Number.MAX_SAFE_INTEGER, 1, -1])).toThrow(TypeError);
    expect(() => sumSafeIntegers([Number.MIN_SAFE_INTEGER, -1, 1])).toThrow(TypeError);
  });

  it("rejects sparse arrays", () => {
    expect(() => sumSafeIntegers(new Array(1))).toThrow(TypeError);
    expect(() => sumSafeIntegers([1, , 2])).toThrow(TypeError);
    expect(() => sumSafeIntegers([1, ,])).toThrow(TypeError);
  });
});
