import { describe, expect, it } from "vitest";
import { getFollowupRecommendation } from "../lib/crm/recommendations";

const base = {
  today: "2026-10-09",
  name: "Mariana López",
  personType: "student" as const,
  currentPackage: {
    name: "Paquete de 8 clases",
    unlimited: false,
    availableCredits: 2,
    creditLimit: 8,
    expiresOn: "2026-10-14",
  },
  lastAttendedOn: "2026-10-06",
};

describe("CRM follow-up suggestions", () => {
  it("suggests renewal for a package expiring within seven days", () => {
    expect(getFollowupRecommendation(base)).toMatchObject({ kind: "renewal" });
  });

  it("does not suggest renewal when an unlimited package is active", () => {
    expect(
      getFollowupRecommendation({
        ...base,
        currentPackage: { ...base.currentPackage, unlimited: true },
      }),
    ).toBeNull();
  });

  it("suggests returning to the studio only after 30 days without attendance", () => {
    expect(
      getFollowupRecommendation({
        ...base,
        personType: "former_student",
        currentPackage: null,
        lastAttendedOn: "2026-08-25",
      }),
    ).toMatchObject({ kind: "return" });
  });

  it("keeps recent former students out of the reactivation suggestion", () => {
    expect(
      getFollowupRecommendation({
        ...base,
        personType: "former_student",
        currentPackage: null,
        lastAttendedOn: "2026-09-20",
      }),
    ).toBeNull();
  });

  it("suppresses suggestions when follow-up is paused", () => {
    expect(getFollowupRecommendation({ ...base, paused: true })).toBeNull();
  });
});
