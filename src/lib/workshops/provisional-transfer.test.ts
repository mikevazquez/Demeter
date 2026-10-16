import { describe, expect, it } from "vitest";
import { countsAsConfirmedIncome, transitionProvisionalTransfer } from "./provisional-transfer";

describe("provisional workshop transfer contract", () => {
  it("holds capacity without recognizing income", () => {
    expect(countsAsConfirmedIncome("reserved_provisionally")).toBe(false);
    expect(transitionProvisionalTransfer("proof_received", "hold_capacity")).toEqual({
      ok: true, state: "reserved_provisionally", changed: true,
    });
  });
  it("confirms only from an active provisional hold", () => {
    expect(transitionProvisionalTransfer("reserved_provisionally", "approve_payment")).toEqual({
      ok: true, state: "confirmed", changed: true,
    });
    expect(countsAsConfirmedIncome("confirmed")).toBe(true);
    expect(transitionProvisionalTransfer("proof_received", "approve_payment")).toEqual({
      ok: false, reason: "invalid_transition",
    });
  });
  it("never confirms rejected or expired transfers", () => {
    for (const state of ["rejected", "expired"] as const) {
      expect(transitionProvisionalTransfer(state, "approve_payment")).toEqual({
        ok: false, reason: "invalid_transition",
      });
    }
  });
  it("does not duplicate a repeated event", () => {
    expect(transitionProvisionalTransfer("reserved_provisionally", "hold_capacity")).toEqual({
      ok: true, state: "reserved_provisionally", changed: false,
    });
    expect(transitionProvisionalTransfer("confirmed", "approve_payment")).toEqual({
      ok: true, state: "confirmed", changed: false,
    });
  });
  it("rejects late cancellation of a confirmed payment", () => {
    expect(transitionProvisionalTransfer("confirmed", "expire_hold")).toEqual({
      ok: false, reason: "invalid_transition",
    });
  });
});
