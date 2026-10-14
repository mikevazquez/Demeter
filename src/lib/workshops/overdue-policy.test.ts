import { describe, expect, it } from "vitest";
import { decideOverdueBalance, type WorkshopPurchasePolicySnapshot } from "./overdue-policy";

const base: WorkshopPurchasePolicySnapshot = {
  studioId: "studio-test", workshopId: "workshop-test", purchaseId: "purchase-test",
  totalMinor: 60000, dueAt: "2026-11-01T15:00:00Z",
  overduePolicy: { mode: "keep_and_notify" },
};

describe("workshop overdue policy", () => {
  it("keeps and notifies for overdue balances", () => {
    expect(decideOverdueBalance({ snapshot: base, paidMinor: 0, evaluatedAt: "2026-11-02T15:00:00Z", alreadyReleased: false }))
      .toEqual({ action: "notify", reason: "overdue_keep" });
  });
  it("does not release a fully paid purchase", () => {
    expect(decideOverdueBalance({ snapshot: { ...base, overduePolicy: { mode: "release_after_grace", graceMinutes: 60 } }, paidMinor: 60000, evaluatedAt: "2026-11-02T15:00:00Z", alreadyReleased: false }))
      .toEqual({ action: "none", reason: "paid" });
  });
  it("waits until the grace period has elapsed", () => {
    const snapshot = { ...base, overduePolicy: { mode: "release_after_grace" as const, graceMinutes: 60 } };
    expect(decideOverdueBalance({ snapshot, paidMinor: 0, evaluatedAt: "2026-11-01T15:30:00Z", alreadyReleased: false }))
      .toEqual({ action: "notify", reason: "within_grace" });
    expect(decideOverdueBalance({ snapshot, paidMinor: 0, evaluatedAt: "2026-11-01T16:01:00Z", alreadyReleased: false }))
      .toEqual({ action: "release", reason: "grace_expired" });
  });
  it("does not confuse the original deposit with full payment", () => {
    const snapshot = { ...base, overduePolicy: { mode: "release_after_grace" as const, graceMinutes: 0 } };
    expect(decideOverdueBalance({ snapshot, paidMinor: 30000, evaluatedAt: "2026-11-02T15:00:00Z", alreadyReleased: false }))
      .toEqual({ action: "release", reason: "grace_expired" });
  });
  it("does not release the same purchase twice", () => {
    expect(decideOverdueBalance({ snapshot: base, paidMinor: 0, evaluatedAt: "2026-11-02T15:00:00Z", alreadyReleased: true }))
      .toEqual({ action: "none", reason: "already_released" });
  });
});
