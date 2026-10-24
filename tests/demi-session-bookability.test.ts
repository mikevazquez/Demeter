import { describe, expect, it } from "vitest";
import {
  currentMinuteStart,
  isSessionBookableNow,
  isSessionStartCurrentOrFutureMinute,
} from "../lib/assistant/session-bookability";

describe("Demi last-minute booking boundary", () => {
  const now = Date.parse("2026-10-24T17:30:45.000Z");

  it("keeps the whole current minute bookable", () => {
    expect(currentMinuteStart(now)).toBe(Date.parse("2026-10-24T17:30:00.000Z"));
    expect(
      isSessionStartCurrentOrFutureMinute("2026-10-24T17:30:00.000Z", now),
    ).toBe(true);
    expect(
      isSessionBookableNow(
        { status: "scheduled", starts_at: "2026-10-24T17:30:00.000Z" },
        now,
      ),
    ).toBe(true);
  });

  it("keeps future classes bookable even when they start in less than 30 minutes", () => {
    expect(
      isSessionBookableNow(
        { status: "scheduled", starts_at: "2026-10-24T17:31:00.000Z" },
        now,
      ),
    ).toBe(true);
  });

  it("stops offering a class after its start minute has passed", () => {
    const afterStartMinute = Date.parse("2026-10-24T17:31:00.000Z");
    expect(
      isSessionBookableNow(
        { status: "scheduled", starts_at: "2026-10-24T17:30:00.000Z" },
        afterStartMinute,
      ),
    ).toBe(false);
  });

  it("does not allow non-scheduled sessions", () => {
    expect(
      isSessionBookableNow(
        { status: "cancelled", starts_at: "2026-10-24T17:31:00.000Z" },
        now,
      ),
    ).toBe(false);
  });
});
