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

describe("F10/N14 student home visual hierarchy", () => {
  it("prioritizes an active package before reserved classes", () => {
    const exhausted = acquisition({ id: "exhausted", available_credits: 0 });
    const usable = acquisition({ id: "usable", available_credits: 3 });

    expect(selectPrimaryStudentPackage([exhausted, usable])).toBe(usable);
  });

  it("keeps reserved classes immediately after package context", () => {
    const wallet = acquisition({
      id: "wallet",
      reward_credit_wallet: true,
      available_credits: 5,
    });
    const activePackage = acquisition({ id: "monthly", available_credits: 2 });

    expect(selectPrimaryStudentPackage([wallet, activePackage])).toBe(activePackage);
  });

  it("uses useful empty states instead of the old date carousel", () => {
    const exhausted = acquisition({ id: "exhausted", available_credits: null });
    const expired = acquisition({ id: "expired", active_now: false, available_credits: 8 });

    expect(selectPrimaryStudentPackage([expired, exhausted])).toBe(exhausted);
    expect(selectPrimaryStudentPackage([expired])).toBeNull();
  });

  it("removes duplicated progress, quick actions and activity metrics from home", () => {
    const unlimited = acquisition({ id: "unlimited", unlimited: true, available_credits: null });
    const exhausted = acquisition({ id: "exhausted", available_credits: 0 });

    expect(selectPrimaryStudentPackage([exhausted, unlimited])).toBe(unlimited);
  });
});
