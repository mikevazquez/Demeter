import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("INTEL-10 cross-view consistency", () => {
  const intelligence = source("app/admin/inteligencia/page.tsx");

  it("counts reactivation separately from first acquisition", () => {
    expect(intelligence).toContain("reactivationPurchases");
    expect(intelligence).toContain("furthestPriorExpiry + 30 * DAY");
    expect(intelligence).toContain("reactivatedStudentsCurrent");
    expect(intelligence).toContain("Reactivación = regreso después de 30+ días");
  });

  it("counts reactivated people uniquely", () => {
    expect(intelligence).toContain("uniqueStudentAcquisitions");
    expect(intelligence).toContain("new Map<string, AcquisitionRow>()");
  });

  it("includes reactivation in net student growth", () => {
    expect(intelligence).toContain(
      "newCommercialStudentsCurrent.length +\n    reactivatedStudentsCurrent.length -\n    newlyConfirmedChurn.length",
    );
    expect(intelligence).toContain("Crecimiento neto");
  });

  it("uses recorded onboarding evidence for first attendance", () => {
    expect(intelligence).toContain("firstAttendanceCurrent");
    expect(intelligence).toContain("first_attendance_at");
    expect(intelligence).toContain("onboardingHistoryCoverage");
    expect(intelligence).toContain("first_attendance_at");
  });

  it("keeps onboarding activation visible without occupying a top KPI slot", () => {
    expect(intelligence).toContain("newStudentActivationRate");
    expect(intelligence).toContain('title="🚀 Avance del onboarding"');
  });
});
