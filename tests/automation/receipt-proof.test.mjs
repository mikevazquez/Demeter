import { describe, expect, it } from "vitest";
import { normalizeReceiptSet } from "../../scripts/automation/receipt-proof.mjs";

const receipt = (taskId = "task-abc", number = 1) => ({
  taskId,
  commitSha: number.toString(16).padStart(40, "0"),
  url: `https://github.com/mikevazquez/Demeter/pull/${number}`,
  draft: true,
});

describe("normalizeReceiptSet", () => {
  it("sorts by taskId in code-unit order", () => {
    const sorted = [receipt("abc", 1), receipt("abc-1", 2), receipt("abc0", 3)];
    expect(normalizeReceiptSet([sorted[2], sorted[0], sorted[1]])).toEqual(sorted);
  });

  it("collapses identical receipts regardless of key order", () => {
    const first = receipt();
    const reordered = {
      draft: first.draft,
      url: first.url,
      commitSha: first.commitSha,
      taskId: first.taskId,
    };
    const result = normalizeReceiptSet([first, reordered, first]);
    expect(result).toEqual([first]);
    expect(Reflect.ownKeys(result[0])).toEqual(["taskId", "commitSha", "url", "draft"]);
    expect(result[0]).not.toBe(first);
    expect(result[0]).not.toBe(reordered);
  });

  it("accepts frozen inputs and returns independent mutable copies", () => {
    const first = Object.freeze(receipt("task-aaa", 1));
    const second = Object.freeze(receipt("task-bbb", 2));
    const input = Object.freeze([second, first]);
    const result = normalizeReceiptSet(input);
    expect(result).not.toBe(input);
    expect(result).toEqual([first, second]);
    expect(result[0]).not.toBe(first);
    expect(result[1]).not.toBe(second);
    result[0].taskId = "changed-task";
    result.pop();
    expect(input).toEqual([receipt("task-bbb", 2), receipt("task-aaa", 1)]);
  });

  it("does not retain references to mutable input objects", () => {
    const source = receipt();
    const input = [source];
    const result = normalizeReceiptSet(input);
    source.url = "changed";
    input.length = 0;
    expect(result).toEqual([receipt()]);
  });

  it("returns a fresh array for empty input on every call", () => {
    const input = Object.freeze([]);
    const result = normalizeReceiptSet(input);
    expect(result).toEqual([]);
    expect(result).not.toBe(input);
    expect(normalizeReceiptSet(input)).not.toBe(result);
  });

  it.each([null, undefined, {}, "receipts", 1, true, new Set()])(
    "rejects non-array input %s",
    (input) => expect(() => normalizeReceiptSet(input)).toThrow(TypeError),
  );

  it.each([null, undefined, [], "receipt", 1, true, () => {}, Symbol("receipt")])(
    "rejects invalid receipt type %s",
    (value) => expect(() => normalizeReceiptSet([value])).toThrow(TypeError),
  );

  it("rejects holes, including holes with inherited values", () => {
    expect(() => normalizeReceiptSet(new Array(1))).toThrow(TypeError);
    expect(() => normalizeReceiptSet([receipt(), , receipt("task-def", 2)])).toThrow(TypeError);
    const input = new Array(1);
    Object.setPrototypeOf(input, { 0: receipt() });
    expect(() => normalizeReceiptSet(input)).toThrow(TypeError);
  });

  it.each(["taskId", "commitSha", "url", "draft"])("requires own key %s", (field) => {
    const value = receipt();
    delete value[field];
    expect(() => normalizeReceiptSet([value])).toThrow(TypeError);
    Object.setPrototypeOf(value, { [field]: receipt()[field] });
    expect(() => normalizeReceiptSet([value])).toThrow(TypeError);
  });

  it("rejects extra enumerable, nonenumerable, and symbol keys", () => {
    const extra = { ...receipt(), extra: true };
    const hidden = Object.defineProperty(receipt(), "extra", { value: true });
    const symbol = Object.defineProperty(receipt(), Symbol("extra"), { value: true });
    for (const value of [extra, hidden, symbol]) {
      expect(() => normalizeReceiptSet([value])).toThrow(TypeError);
    }
  });

  it("accepts nonenumerable required keys and null-prototype objects", () => {
    const value = Object.create(null);
    for (const [key, field] of Object.entries(receipt())) {
      Object.defineProperty(value, key, { value: field });
    }
    expect(normalizeReceiptSet([Object.freeze(value)])).toEqual([receipt()]);
  });

  it.each([
    ["taskId", "ab"],
    ["taskId", "a".repeat(81)],
    ["taskId", "-abc"],
    ["taskId", "Task-abc"],
    ["taskId", "task_abc"],
    ["taskId", " task-abc"],
    ["taskId", 123],
    ["taskId", new String("task-abc")],
    ["commitSha", "a".repeat(39)],
    ["commitSha", "a".repeat(41)],
    ["commitSha", "A".repeat(40)],
    ["commitSha", "g".repeat(40)],
    ["commitSha", 123],
    ["commitSha", new String("a".repeat(40))],
    ["url", "https://github.com/mikevazquez/Demeter/pull/0"],
    ["url", "https://github.com/mikevazquez/Demeter/pull/01"],
    ["url", "http://github.com/mikevazquez/Demeter/pull/1"],
    ["url", "https://github.com/other/Demeter/pull/1"],
    ["url", "https://github.com/mikevazquez/demeter/pull/1"],
    ["url", `${receipt().url}/`],
    ["url", `${receipt().url}?draft=true`],
    ["url", `${receipt().url}#fragment`],
    ["url", 123],
    ["url", new String(receipt().url)],
    ["draft", false],
    ["draft", "true"],
    ["draft", 1],
    ["draft", new Boolean(true)],
    ["draft", null],
  ])("rejects invalid %s value %s", (field, value) => {
    expect(() => normalizeReceiptSet([{ ...receipt(), [field]: value }])).toThrow(TypeError);
  });

  it("accepts taskId length boundaries and lowercase hex digits", () => {
    const first = { ...receipt("0-a"), commitSha: "0123456789abcdef".repeat(2) + "01234567" };
    const second = receipt("z".repeat(80), 2);
    expect(normalizeReceiptSet([second, first])).toEqual([first, second]);
  });

  it.each([
    ["commitSha", "f".repeat(40)],
    ["url", "https://github.com/mikevazquez/Demeter/pull/999"],
  ])("rejects conflicting %s for one taskId", (field, value) => {
    const first = receipt();
    const conflict = { ...first, [field]: value };
    expect(() => normalizeReceiptSet([first, conflict])).toThrow(TypeError);
    expect(() => normalizeReceiptSet([conflict, first])).toThrow(TypeError);
  });

  it("rejects a URL shared by different taskIds", () => {
    const first = receipt();
    for (const commitSha of [first.commitSha, "f".repeat(40)]) {
      const alias = { ...first, taskId: "task-other", commitSha };
      expect(() => normalizeReceiptSet([first, alias])).toThrow(TypeError);
      expect(() => normalizeReceiptSet([alias, first])).toThrow(TypeError);
    }
  });
});
