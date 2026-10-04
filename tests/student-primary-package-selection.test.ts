import { describe, expect, it } from "vitest";

import {
  selectPrimaryStudentPackage,
  type StudentAcquisition,
} from "../lib/student/portal";

function acquisition(
  overrides: Partial<StudentAcquisition>,
): StudentAcquisition {
  return {
    id: "id",
    product_id: "product",
    name: "Paquete",
    product_type: "package",
    package_term: "monthly",
    reward_credit_wallet: false,
    status: "active",
    starts_on: "2026-10-01",
    expires_on: "2026-11-01",
    unlimited: false,
    credit_limit: 8,
    available_credits: 0,
    reserved_credits: 0,
    used_credits: 8,
    active_now: true,
    ...overrides,
  };
}

describe("student portal primary package", () => {
  it("prefers a usable active package over an exhausted active package", () => {
    const exhausted = acquisition({
      id: "old",
      name: "Sandbox · 8 clases",
      expires_on: "2026-10-23",
      available_credits: 0,
    });
    const usable = acquisition({
      id: "current",
      name: "Mensual · 8 clases",
      expires_on: "2026-11-01",
      available_credits: 4,
      used_credits: 4,
    });

    expect(selectPrimaryStudentPackage([exhausted, usable])?.id).toBe("current");
  });

  it("still shows an active exhausted package when there is no usable alternative", () => {
    const exhausted = acquisition({ id: "only", available_credits: 0 });
    expect(selectPrimaryStudentPackage([exhausted])?.id).toBe("only");
  });

  it("ignores reward-credit wallets when selecting the main package", () => {
    const reward = acquisition({
      id: "reward",
      reward_credit_wallet: true,
      available_credits: 5,
    });
    const packageItem = acquisition({
      id: "package",
      available_credits: 2,
    });

    expect(selectPrimaryStudentPackage([reward, packageItem])?.id).toBe("package");
  });
});
