import { describe, expect, it } from "vitest";
import { uniqueTaskIds } from "../../scripts/automation/governance2-e2e-proof.mjs";

describe("uniqueTaskIds", () => {
  it("trims, deduplicates and sorts task IDs lexicographically", () => {
    expect(uniqueTaskIds([" zzz ", "task-2", "aaa", "task-10", "aaa", "\tzzz\n"])).toEqual([
      "aaa",
      "task-10",
      "task-2",
      "zzz",
    ]);
  });
  it("returns an empty array for empty input", () => {
    expect(uniqueTaskIds([])).toEqual([]);
  });
  it("preserves the input and returns a separate array", () => {
    const values = Object.freeze([" zzz ", "aaa", "aaa"]);
    expect(uniqueTaskIds(values)).toEqual(["aaa", "zzz"]);
    expect(values).toEqual([" zzz ", "aaa", "aaa"]);
    const empty = [];
    expect(uniqueTaskIds(empty)).not.toBe(empty);
  });
  it("accepts the inclusive length bounds and allowed characters", () => {
    const longest = "a".repeat(80);
    expect(uniqueTaskIds([longest, "0-a"])).toEqual(["0-a", longest]);
  });
  it("rejects non-array inputs", () => {
    for (const value of [undefined, null, "abc", 123, true, {}, new Set(["abc"])])
      expect(() => uniqueTaskIds(value)).toThrow(TypeError);
  });
  it("rejects non-string entries, including sparse entries", () => {
    for (const value of [undefined, null, 123, true, {}, [], new String("abc")])
      expect(() => uniqueTaskIds(["valid-id", value])).toThrow(TypeError);
    expect(() => uniqueTaskIds(new Array(1))).toThrow(TypeError);
  });
  it("rejects invalid IDs after trimming", () => {
    for (const id of [
      "",
      " \t\n",
      "ab",
      "a".repeat(81),
      "-abc",
      "Abc",
      "abc_def",
      "abc.def",
      "abc/def",
      "abc def",
      "abc\ndef",
      "ábc",
    ])
      expect(() => uniqueTaskIds([id])).toThrow(TypeError);
  });
});
