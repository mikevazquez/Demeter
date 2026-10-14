import { describe, expect, it } from "vitest";
import { calculateDeposit, quoteWorkshopPurchase, type WorkshopOffer } from "./purchase-quote";

const offer: WorkshopOffer = {
  workshopId: "w1",
  fullPriceMinor: 60000,
  allowIndividualSessions: true,
  sessions: [
    { id: "pendulo", priceMinor: 15000, capacityRemaining: 2 },
    { id: "aro", priceMinor: 15000, capacityRemaining: 1 },
    { id: "telas", priceMinor: 15000, capacityRemaining: 3 },
  ],
};

describe("workshop purchase quote", () => {
  it("reserves all sessions at full workshop price", () => {
    expect(quoteWorkshopPurchase(offer, { mode: "full" })).toEqual({
      ok: true,
      sessionIds: ["pendulo", "aro", "telas"],
      totalMinor: 60000,
    });
  });
  it("allows multiple individually priced sessions in one checkout", () => {
    expect(
      quoteWorkshopPurchase(offer, { mode: "sessions", sessionIds: ["pendulo", "aro"] }),
    ).toEqual({ ok: true, sessionIds: ["pendulo", "aro"], totalMinor: 30000 });
  });
  it("blocks a full purchase if any session is sold out", () => {
    expect(
      quoteWorkshopPurchase(
        {
          ...offer,
          sessions: offer.sessions.map((s) =>
            s.id === "aro" ? { ...s, capacityRemaining: 0 } : s,
          ),
        },
        { mode: "full" },
      ),
    ).toEqual({ ok: false, reason: "sold_out" });
  });
  it("rejects duplicated session selections", () => {
    expect(quoteWorkshopPurchase(offer, { mode: "sessions", sessionIds: ["aro", "aro"] })).toEqual({
      ok: false,
      reason: "invalid_session",
    });
  });
  it("rejects unknown session IDs and prevents undercharging", () => {
    expect(quoteWorkshopPurchase(offer, { mode: "sessions", sessionIds: ["unknown"] }))
      .toEqual({ ok: false, reason: "invalid_session" });
  });
  it("does not accept repeated IDs to inflate the number of selected sessions", () => {
    expect(quoteWorkshopPurchase(offer, { mode: "sessions", sessionIds: ["pendulo", "pendulo", "aro"] }))
      .toEqual({ ok: false, reason: "invalid_session" });
  });
  it("calculates deposits without discounting the full amount", () => {
    expect(calculateDeposit(60000, { mode: "fixed", amountMinor: 30000 })).toEqual({
      dueNowMinor: 30000,
      balanceMinor: 30000,
    });
    expect(calculateDeposit(60000, { mode: "percent", percent: 50 })).toEqual({
      dueNowMinor: 30000,
      balanceMinor: 30000,
    });
  });
});
