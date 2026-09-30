import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("INTEL-11 integral consistency audit", () => {
  const intelligence = source("app/admin/inteligencia/page.tsx");

  it(
    "uses package or membership consistently for base, retention and churn",
    () => {
      expect(intelligence).toContain(
        "for (const item of conversionAcquisitions)",
      );
      expect(intelligence).toContain(
        "const expiredCurrent = conversionAcquisitions.filter",
      );
      expect(intelligence).toContain(
        "const expiredPrevious = conversionAcquisitions.filter",
      );
    },
  );

  it("uses effective payment dates for economic period selection", () => {
    expect(intelligence).toContain("effective_on.gte.");
    expect(intelligence).toContain("effective_on.is.null");
    expect(intelligence).toContain("item.effective_on >= currentStartDate");
    expect(intelligence).toContain("item.effective_on < currentStartDate");
  });

  it("anchors date-only business records to the studio timezone", () => {
    expect(intelligence).toContain("dateKeyInTimeZone");
    expect(intelligence).toContain('studio.timezone ?? "America/Mexico_City"');
    expect(intelligence).toContain("shiftDateKey(todayDate, -(days - 1))");
  });

  it("excludes explicit UAT domain events from intelligence metrics", () => {
    expect(intelligence).toContain("isSyntheticDomainEvent");
    expect(intelligence).toContain('eventPayloadText(event, "uat_case")');
    expect(intelligence).toContain('source?.startsWith("uat_")');
    expect(intelligence).toContain("syntheticDomainEventCount");
  });

  it("never infers immutable event history before coverage starts", () => {
    expect(intelligence).toContain("earliestDomainEventTime");
    expect(intelligence).toContain("eventHistoryCoversCurrentPeriod");
    expect(intelligence).toContain("eventHistoryCoversComparison");
    expect(intelligence).toContain("Cobertura histórica limitada");
    expect(intelligence).toContain("No inferimos actividad anterior faltante");
  });

  it("gates retention behavior on a complete 42-day observation window", () => {
    expect(intelligence).toContain("retentionHistoryCovered");
    expect(intelligence).toContain(
      "retentionHistoryCovered && !isNewAcquisition && recentAttendance === 0",
    );
    expect(intelligence).toContain("Historial todavía limitado");
  });

  it(
    "uses canonical identities so linked conversations do not inflate people",
    () => {
      expect(intelligence).toContain("conversationStudentByProviderContact");
      expect(intelligence).toContain("conversationStudentByPhone");
      expect(intelligence).toContain("resolvedConversationStudentId");
      expect(intelligence).toContain('return "student:" + linkedStudent');
      expect(intelligence).toContain("conversationIdentity(row)");
    },
  );

  it(
    "waits for cohort maturity before conversion and marketing decisions",
    () => {
      expect(intelligence).toContain("CONVERSION_MATURITY_DAYS = 7");
      expect(intelligence).toContain("currentCohortStart");
      expect(intelligence).toContain("currentCohortEnd");
      expect(intelligence).toContain("previousCohortStart");
      expect(intelligence).toContain("conversationCohortComparable");
      expect(intelligence).toContain("currentMarketingDecisionRows");
      expect(intelligence).toContain("contactos recientes siguen dentro de su ventana de maduración");
    },
  );

  it(
    "waits for the full 30-day renewal window before calculating retention outcomes",
    () => {
      expect(intelligence).toContain("if (age < 30)");
      expect(intelligence).toContain("pendingMaturity += 1");
      expect(intelligence).toContain("La cohorte todavía está madurando");
    },
  );

  it(
    "does not imply expense completeness from the presence of expense rows",
    () => {
      expect(intelligence).toContain("No equivale a utilidad contable o fiscal");
      expect(intelligence).toContain("financeDecisionTitle");
      expect(intelligence).toContain("antes de tomar decisiones de rentabilidad");
    },
  );

  it(
    "keeps summary and class demand on the same peak-demand definition",
    () => {
      expect(intelligence).toContain("classDecisionTitle");
      expect(intelligence).toContain("eventHistoryCoversCurrentPeriod");
      expect(intelligence).toContain("classComparisonRows");
    },
  );

  it("orders same-priority decisions by explicit business impact", () => {
    expect(intelligence).toContain("impact?: number");
    expect(intelligence).toContain("(b.impact ?? 0) - (a.impact ?? 0)");
    expect(intelligence).toContain("impact: 100");
    expect(intelligence).toContain("impact: 80");
  });
});
