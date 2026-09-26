import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("INTEL-04 decision center", () => {
  const intelligence = source("app/admin/inteligencia/page.tsx");
  const css = source("app/admin/inteligencia/inteligencia.css");

  it("uses transparent priorities with evidence and actions", () => {
    expect(intelligence).toContain("type IntelligenceDecision");
    expect(intelligence).toContain('decision.priority === 1 ? "Ahora"');
    expect(intelligence).toContain("<b>Acción:</b>");
    expect(intelligence).toContain('title="🧭 Centro de decisiones"');
  });

  it("prioritizes money and preventive retention", () => {
    expect(intelligence).toContain('key: "collections-overdue"');
    expect(intelligence).toContain('key: "collections-due-today"');
    expect(intelligence).toContain('key: "retention-preventive"');
    expect(intelligence).toContain('key: "retention-recovery"');
  });

  it("requires minimum samples before diagnosing funnel or class problems", () => {
    expect(intelligence).toContain("currentConversationCohort.contacts >= 3");
    expect(intelligence).toContain("previousConversationCohort.contacts >= 3");
    expect(intelligence).toContain("attendanceDecisionSample >= 5");
    expect(intelligence).toContain("row.sessionCount >= 3");
    expect(intelligence).toContain("row.total >= 5");
  });

  it("covers conversion recovery and schedule decisions", () => {
    expect(intelligence).toContain('key: "no-show-recovery"');
    expect(intelligence).toContain('key: "cancellation-recovery"');
    expect(intelligence).toContain('"class-capacity-" + highestDemand.name');
    expect(intelligence).toContain('"class-low-demand-" + lowestDemand.name');
    expect(intelligence).toContain('"class-cancellation-" + highestCancellation.name');
  });

  it("renders a distinct decision hierarchy", () => {
    expect(css).toContain(".intel-decision-list");
    expect(css).toContain(".intel-decision-priority");
    expect(css).toContain(".intel-decision.is-danger");
    expect(css).toContain(".intel-decision.is-positive");
  });
});
