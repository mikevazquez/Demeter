import { describe, expect, it } from "vitest";
import { actionAfterFirstSessionAbsence, fullWorkshopPurchasePolicy } from "./first-session-policy";

const sessions = ["2026-11-11T16:00:00Z", "2026-11-04T16:00:00Z", "2026-11-18T16:00:00Z"];

describe("full workshop first-session policy", () => {
  it("sets the balance due at the earliest session and reserves after minimum deposit", () => {
    expect(fullWorkshopPurchasePolicy({ sessionStartsAt: sessions, totalMinor: 60000, paidMinor: 15000, minimumDepositMinor: 15000 })).toEqual({
      ok: true, dueAt: "2026-11-04T16:00:00.000Z", balanceMinor: 45000, canReserveAll: true,
    });
  });
  it("does not reserve below the minimum", () => {
    const result = fullWorkshopPurchasePolicy({ sessionStartsAt: sessions, totalMinor: 60000, paidMinor: 10000, minimumDepositMinor: 15000 });
    expect(result.ok && result.canReserveAll).toBe(false);
  });
  it("does not invent a due date for a fully paid purchase", () => {
    expect(fullWorkshopPurchasePolicy({ sessionStartsAt: sessions, totalMinor: 60000, paidMinor: 60000, minimumDepositMinor: 15000 })).toMatchObject({
      ok: true, dueAt: null, balanceMinor: 0,
    });
  });
  it("rejects malformed and duplicate sessions", () => {
    expect(fullWorkshopPurchasePolicy({ sessionStartsAt: [sessions[0], sessions[0]], totalMinor: 60000, paidMinor: 15000, minimumDepositMinor: 15000 })).toEqual({
      ok: false, reason: "invalid_sessions",
    });
  });
  it("does not release seats without explicit withdrawal", () => {
    expect(actionAfterFirstSessionAbsence("continue")).toBe("keep_future_reservations");
    expect(actionAfterFirstSessionAbsence("unanswered")).toBe("keep_future_reservations");
    expect(actionAfterFirstSessionAbsence("withdraw")).toBe("release_future_reservations");
  });
});
