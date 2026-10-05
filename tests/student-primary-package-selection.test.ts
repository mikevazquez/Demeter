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

describe("student portal primary package selection", () => {
  it("prefers an active package with usable credits", () => {
    const exhausted = acquisition({ id: "exhausted", available_credits: 0 });
    const usable = acquisition({ id: "usable", available_credits: 1 });
    const expired = acquisition({ id: "expired", active_now: false, available_credits: 9 });

    expect(selectPrimaryStudentPackage([exhausted, expired, usable])).toBe(usable);
  });

  it("ignores reward credit wallets when selecting the main package", () => {
    const wallet = acquisition({
      id: "wallet",
      reward_credit_wallet: true,
      available_credits: 5,
    });
    const mainPackage = acquisition({ id: "monthly", available_credits: 2 });

    expect(selectPrimaryStudentPackage([wallet, mainPackage])).toBe(mainPackage);
  });

  it("uses the same package selector across student portal screens", () => {
    const unlimited = acquisition({ id: "unlimited", unlimited: true, available_credits: null });
    const exhausted = acquisition({ id: "exhausted", available_credits: 0 });

    expect(selectPrimaryStudentPackage([exhausted, unlimited])).toBe(unlimited);
  });
});
