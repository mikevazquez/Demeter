import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("INTEL-09 student health intelligence", () => {
  const intelligence = source("app/admin/inteligencia/page.tsx");

  it("defines new students from first package or membership acquisition", () => {
    expect(intelligence).toContain("firstConversionAcquisitionByStudent");
    expect(intelligence).toContain("newCommercialStudentsCurrent");
    expect(intelligence).toContain("Nueva alumna = primera compra");
  });

  it("calculates net growth from new students minus newly confirmed churn", () => {
    expect(intelligence).toContain("newlyConfirmedChurn");
    expect(intelligence).toContain("confirmedAt");
    expect(intelligence).toContain("30 * DAY");
    expect(intelligence).toContain("netStudentGrowth");
  });

  it("identifies the next blocked onboarding step for each student", () => {
    expect(intelligence).toContain("nextStep");
    expect(intelligence).toContain("onboardingSteps.find");
    expect(intelligence).toContain("onboardingBottleneckCounts");
    expect(intelligence).toContain("Cuello de botella de onboarding");
  });

  it("surfaces systemic onboarding bottlenecks only with enough pending cases", () => {
    expect(intelligence).toContain("onboardingPending.length >= 3");
    expect(intelligence).toContain(">= 0.4");
    expect(intelligence).toContain('key: "onboarding-bottleneck-"');
  });

  it("keeps prospect and commercial student concepts separate", () => {
    expect(intelligence).toContain("crear un contacto o una reserva no infla este KPI");
    expect(intelligence).toContain("Reactivación ≠ nueva alumna");
  });
});
