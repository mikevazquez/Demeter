import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("INTEL-13 decision intelligence", () => {
  const intelligence = source("app/admin/inteligencia/page.tsx");
  const css = source("app/admin/inteligencia/inteligencia.css");

  it("prioritizes conclusions over dense KPI dashboards", () => {
    expect(intelligence).toContain("const topDecisions = decisions.slice(0, 2)");
    expect(intelligence).toContain('title="🧭 Qué necesita tu atención"');
    expect(intelligence).toContain('title="🧠 Qué está pasando"');
    expect(css).toContain(".intel-decision-layout");
    expect(css).toContain(".intel-analysis-details");
  });

  it("turns conversion into a simple funnel with lateral leaks", () => {
    expect(intelligence).toContain('title="💬 Embudo de conversión"');
    expect(intelligence).toContain("conversionBottleneck");
    expect(intelligence).toContain("conversionDiagnosisTitle");
    expect(intelligence).toContain("conversionFunnelCancelled");
    expect(intelligence).toContain("conversionFunnelRebooked");
    expect(intelligence).toContain("conversionFunnelNoShow");
  });

  it("keeps recent trial prospects visible before the cohort matures", () => {
    expect(intelligence).toContain('title="🔥 Pipeline vivo de prospectos"');
    expect(intelligence).toContain("activeTrialProspects");
    expect(intelligence).toContain("upcomingTrialRows");
    expect(intelligence).toContain("tomorrowTrialProspectCount");
    expect(intelligence).toContain("Prospectos maduros");
    expect(intelligence).toContain("Sí aparecen arriba en el pipeline vivo");
  });

  it("explains onboarding instead of only listing progress", () => {
    expect(intelligence).toContain('title="🧠 Qué está pasando con onboarding"');
    expect(intelligence).toContain("topOnboardingBottleneck");
    expect(intelligence).toContain("onboardingPending.length >= 3");
    expect(intelligence).toContain("topOnboardingBottleneck.count / onboardingPending.length >= 0.4");
  });

  it("compares class attendance per session and separates studio-wide movement", () => {
    expect(intelligence).toContain("classComparisonRows");
    expect(intelligence).toContain("currentAverage");
    expect(intelligence).toContain("previousAverage");
    expect(intelligence).toContain("studyAttendanceChangePct");
    expect(intelligence).toContain("La caída también se observa a nivel estudio");
  });

  it("does not claim seasonality without enough historical evidence", () => {
    expect(intelligence).toContain("mismo mes de años anteriores");
    expect(intelligence).toContain("no atribuimos una caída a temporada o factores externos sin evidencia");
  });

  it("uses the same decision-first pattern for retention, marketing and finance", () => {
    expect(intelligence).toContain('title="🫶 Estado de retención"');
    expect(intelligence).toContain("retentionDecisionTitle");
    expect(intelligence).toContain('title="📣 De contacto a alumna"');
    expect(intelligence).toContain("marketingDecisionTitle");
    expect(intelligence).toContain('title="💰 Estado financiero"');
    expect(intelligence).toContain("financeDecisionTitle");
  });

  it("keeps detail available but collapsed by default", () => {
    expect(intelligence).toContain("<details className=\"intel-analysis-details\">");
    expect(intelligence).toContain("<summary>Ver análisis detallado</summary>");
    expect(intelligence).toContain("<summary>Ver gastos y análisis detallado</summary>");
    expect(intelligence).toContain("<summary>Ver ventas y cobranza detallada</summary>");
  });
});
