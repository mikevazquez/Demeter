import { describe, expect, it } from "vitest";
import { workshopCapacityPreflight } from "./provisional-capacity";

describe("provisional workshop capacity", () => {
  it("counts active provisional holds as occupied seats", () => {
    expect(workshopCapacityPreflight(["a"], [
      { sessionId: "a", capacity: 3, confirmed: 1, provisional: 2 },
    ])).toEqual({ ok: false, reason: "sold_out" });
  });
  it("rejects a whole workshop when one session has no room", () => {
    expect(workshopCapacityPreflight(["a", "b"], [
      { sessionId: "a", capacity: 2, confirmed: 1, provisional: 0 },
      { sessionId: "b", capacity: 2, confirmed: 1, provisional: 1 },
    ])).toEqual({ ok: false, reason: "sold_out" });
  });
  it("returns deterministic session ordering", () => {
    expect(workshopCapacityPreflight(["b", "a"], [
      { sessionId: "a", capacity: 2, confirmed: 0, provisional: 0 },
      { sessionId: "b", capacity: 2, confirmed: 0, provisional: 1 },
    ])).toEqual({ ok: true, sortedIds: ["a", "b"] });
  });
  it("fails closed on invalid counts and unknown sessions", () => {
    expect(workshopCapacityPreflight(["a"], [])).toEqual({ ok: false, reason: "invalid_capacity" });
    expect(workshopCapacityPreflight(["a"], [
      { sessionId: "a", capacity: 2, confirmed: -1, provisional: 0 },
    ])).toEqual({ ok: false, reason: "invalid_capacity" });
  });
  it("rejects duplicate session requests", () => {
    expect(workshopCapacityPreflight(["a", "a"], [])).toEqual({ ok: false, reason: "invalid_selection" });
  });
});
