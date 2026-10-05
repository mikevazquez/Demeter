import { describe, expect, it } from "vitest";

import { selectPrimaryStudentPackage } from "../lib/student/package-selection";

function acquisition(
  overrides: Partial<{
    id: string;
    reward_credit_wallet: boolean;
    active_now: boolean;
    unlimited: boolean;
    available_credits: number | null;
  }> = {},
) {
  return {
    id: "package",
    reward_credit_wallet: false,
    active_now: true,
    unlimited: false,
    available_credits: 0,
    ...overrides,
  };
}

describe("student home package selection behavior", () => {
  it("selects a usable active package instead of an exhausted active package", () => {
    const exhausted = acquisition({ id: "exhausted", available_credits: 0 });
    const usable = acquisition({ id: "usable", available_credits: 3 });

    expect(selectPrimaryStudentPackage([exhausted, usable])).toBe(usable);
  });

  it("does not treat reward credit wallets as the primary package", () => {
    const wallet = acquisition({
      id: "wallet",
      reward_credit_wallet: true,
      available_credits: 5,
    });
    const packageWithCredits = acquisition({ id: "monthly", available_credits: 2 });

    expect(selectPrimaryStudentPackage([wallet, packageWithCredits])).toBe(packageWithCredits);
  });

  it("keeps an active unlimited package usable without a credit balance", () => {
    const unlimited = acquisition({ id: "unlimited", unlimited: true, available_credits: null });
    const exhausted = acquisition({ id: "exhausted", available_credits: 0 });

    expect(selectPrimaryStudentPackage([exhausted, unlimited])).toBe(unlimited);
  });

  it("falls back to the active package when every active package is exhausted", () => {
    const exhausted = acquisition({ id: "exhausted", available_credits: null });
    const expired = acquisition({ id: "expired", active_now: false, available_credits: 8 });

    expect(selectPrimaryStudentPackage([expired, exhausted])).toBe(exhausted);
  });

  it("returns no package when there are no active non-wallet packages", () => {
    const wallet = acquisition({
      id: "wallet",
      reward_credit_wallet: true,
      available_credits: 5,
    });
    const expired = acquisition({ id: "expired", active_now: false, available_credits: 8 });

    expect(selectPrimaryStudentPackage([wallet, expired])).toBeNull();
  });
});
