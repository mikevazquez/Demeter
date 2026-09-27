import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("INTEL-12 UAT consistency hardening", () => {
  const intelligence = source("app/admin/inteligencia/page.tsx");

  it("uses equal shifted cohorts instead of truncating the current period", () => {
    expect(intelligence).toContain(
      "const currentCohortEnd = new Date(currentEnd.getTime() - cohortLag)",
    );
    expect(intelligence).toContain(
      "const currentCohortStart = new Date(currentStart.getTime() - cohortLag)",
    );
    expect(intelligence).toContain(
      "const previousCohortStart = new Date(previousStart.getTime() - cohortLag)",
    );
    expect(intelligence).toContain("currentCohortConversations");
    expect(intelligence).toContain("previousCohortConversations");
  });

  it("caps conversion outcomes to the same seven-day observation window", () => {
    expect(intelligence).toContain(
      "startTime + CONVERSION_MATURITY_DAYS * DAY",
    );
    expect(intelligence).toContain("eventTime <= windowEndTime");
    expect(intelligence).toContain(
      "conversionTime >= startTime && conversionTime <= windowEndTime",
    );
    expect(intelligence).toContain("collectedRevenueWithinConversionWindow");
  });

  it("separates current activity from mature marketing cohorts", () => {
    expect(intelligence).toContain("currentPeriodMarketingTouches");
    expect(intelligence).toContain("pendingMarketingTouches");
    expect(intelligence).toContain("currentPeriodMarketingRows");
    expect(intelligence).toContain("currentPeriodMarketingTouches");
    expect(intelligence).toContain("pendingMarketingContacts");
  });

  it("does not display partial event-derived rates as full-period KPIs", () => {
    expect(intelligence).toContain(
      'value={eventHistoryCoversCurrentPeriod ? pct(showRate) : "—"}',
    );
    expect(intelligence).toContain("eventHistoryCoversCurrentCohort");
    expect(intelligence).toContain("conversationCohortCurrentCovered");
  });

  it("keeps finance explicitly non-definitive when expense coverage is unknown", () => {
    expect(intelligence).toContain('title="💰 Estado financiero"');
    expect(intelligence).toContain("financeDecisionTitle");
    expect(intelligence).toContain("No equivale a utilidad contable o fiscal");
    expect(intelligence).toContain('key: "finance-expense-coverage-empty"');
  });

  it("filters only explicitly marked synthetic events", () => {
    expect(intelligence).toContain("isSyntheticDomainEvent");
    expect(intelligence).toContain('eventPayloadText(event, "uat_case")');
    expect(intelligence).toContain('source?.startsWith("uat_")');
    expect(intelligence).not.toContain('full_name.includes("Sandbox")');
  });
});
