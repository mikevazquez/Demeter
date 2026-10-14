import { describe, expect, it } from "vitest";
import { planWorkshopCheckout } from "./checkout-plan";
import type { WorkshopOffer } from "./purchase-quote";

const offer: WorkshopOffer = {
  workshopId: "test", fullPriceMinor: 60000, allowIndividualSessions: true,
  sessions: [{ id: "a", priceMinor: 15000, capacityRemaining: 2 }, { id: "b", priceMinor: 15000, capacityRemaining: 1 }],
};
const settings = {
  requiresEnrollment: false, enrollmentValid: false,
  deposit: { mode: "fixed" as const, amountMinor: 30000 },
  dueAt: "2026-11-01T15:00:00Z",
  overduePolicy: { mode: "release_after_grace" as const, graceMinutes: 1440 },
};

describe("workshop checkout planning", () => {
  it("allows public attendance when enrollment is optional", () => {
    expect(planWorkshopCheckout(offer, { mode: "full" }, settings))
      .toMatchObject({ ok: true, totalMinor: 60000, dueNowMinor: 30000, balanceMinor: 30000, sessionIds: ["a", "b"] });
  });
  it("requires enrollment when the studio enables it", () => {
    expect(planWorkshopCheckout(offer, { mode: "full" }, { ...settings, requiresEnrollment: true }))
      .toEqual({ ok: false, reason: "enrollment_required" });
  });
  it("requires a due date for outstanding balances", () => {
    expect(planWorkshopCheckout(offer, { mode: "full" }, { ...settings, dueAt: null }))
      .toEqual({ ok: false, reason: "balance_due_date_required" });
  });
  it("blocks multi-session purchase when a selected session is full", () => {
    const soldOut = { ...offer, sessions: offer.sessions.map(s => s.id === "b" ? { ...s, capacityRemaining: 0 } : s) };
    expect(planWorkshopCheckout(soldOut, { mode: "sessions", sessionIds: ["a", "b"] }, settings))
      .toEqual({ ok: false, reason: "sold_out" });
  });
});
