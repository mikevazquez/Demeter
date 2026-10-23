import { describe, expect, it, vi } from "vitest";
import {
  approveProvisionalCheckout,
  requestProvisionalCheckout,
  type ProvisionalCheckoutRequest,
  type ProvisionalCheckoutStore,
} from "./provisional-checkout";

const request: ProvisionalCheckoutRequest = {
  studioId: "studio",
  offerId: "offer",
  studentId: "student",
  requestId: "request",
  transferReference: "bank-ref",
  sessionIds: ["s1", "s2"],
  amountMinor: 15000,
  minimumDepositMinor: 15000,
  expiresAt: "2026-11-01T00:00:00Z",
};
function store(): ProvisionalCheckoutStore {
  return {
    createHoldAtomically: vi.fn(async (r) => ({
      id: r.requestId,
      state: "reserved_provisionally" as const,
      sessionIds: r.sessionIds,
    })),
    approveAndPostAtomically: vi.fn(async (id) => ({
      id,
      state: "confirmed" as const,
      sessionIds: ["s1", "s2"],
    })),
  };
}
describe("provisional checkout boundary", () => {
  it("sends all sessions to the atomic hold operation", async () => {
    const db = store();
    expect(await requestProvisionalCheckout(request, db)).toMatchObject({
      ok: true,
      hold: { state: "reserved_provisionally", sessionIds: ["s1", "s2"] },
    });
    expect(db.createHoldAtomically).toHaveBeenCalledOnce();
    expect(db.approveAndPostAtomically).not.toHaveBeenCalled();
  });
  it("rejects a deposit below the minimum before calling storage", async () => {
    const db = store();
    expect(await requestProvisionalCheckout({ ...request, amountMinor: 14999 }, db)).toEqual({
      ok: false,
      reason: "insufficient_deposit",
    });
    expect(db.createHoldAtomically).not.toHaveBeenCalled();
  });
  it("rejects duplicate sessions before calling storage", async () => {
    const db = store();
    expect(await requestProvisionalCheckout({ ...request, sessionIds: ["s1", "s1"] }, db)).toEqual({
      ok: false,
      reason: "invalid_request",
    });
    expect(db.createHoldAtomically).not.toHaveBeenCalled();
  });
  it("does not approve a rejected transfer", async () => {
    const db = store();
    expect(await approveProvisionalCheckout("hold", "staff", "rejected", db)).toEqual({
      ok: false,
      reason: "invalid_transition",
    });
    expect(db.approveAndPostAtomically).not.toHaveBeenCalled();
  });
  it("delegates posting only to the trusted atomic operation", async () => {
    const db = store();
    expect(
      await approveProvisionalCheckout("hold", "staff", "reserved_provisionally", db),
    ).toMatchObject({ ok: true, hold: { state: "confirmed" } });
    expect(db.approveAndPostAtomically).toHaveBeenCalledWith("hold", "staff");
  });
});
