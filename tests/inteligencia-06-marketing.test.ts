import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("INTEL-06 marketing attribution", () => {
  const migration = source(
    "supabase/migrations/20260926125000_inteligencia06_marketing_attribution.sql",
  );
  const actions = source("app/admin/inteligencia/actions.ts");
  const intelligence = source("app/admin/inteligencia/page.tsx");

  it("adds optional campaign attribution to advertising spend", () => {
    expect(migration).toContain("marketing_source text");
    expect(migration).toContain("marketing_campaign text");
    expect(migration).toContain("studio_expenses_marketing_attribution_idx");
    expect(actions).toContain("marketing_source");
    expect(actions).toContain('category === "advertising"');
  });

  it("uses first-touch contact identity instead of raw conversation count", () => {
    expect(intelligence).toContain("firstMarketingTouches");
    expect(intelligence).toContain("row.student_id");
    expect(intelligence).toContain("resolvedConversationStudentId");
    expect(intelligence).toContain('"student:" + linkedStudent');
    expect(intelligence).toContain("marketingAttributionKey");
  });

  it("attributes outcomes inside the same fixed maturity window", () => {
    expect(intelligence).toContain("collectedRevenueWithinConversionWindow");
    expect(intelligence).toContain("windowEndTime");
    expect(intelligence).toContain("firstConversionAcquisitionByStudent.get(touch.studentId)");
    expect(intelligence).toContain(
      "conversionTime >= startTime && conversionTime <= windowEndTime",
    );
    expect(intelligence).toContain('payment.kind === "refund"');
  });

  it("calculates campaign economics without claiming causality", () => {
    expect(intelligence).toContain("costPerContact");
    expect(intelligence).toContain("costPerStudent");
    expect(intelligence).toContain("roas:");
    expect(intelligence).toContain("Atribución no significa causalidad");
    expect(intelligence).toContain("Una campaña necesita al menos 5 contactos maduros");
  });

  it("requires sample size before campaign decisions", () => {
    expect(intelligence).toContain("row.contacts >= 5");
    expect(intelligence).toContain('key: "marketing-paid-no-conversion-"');
    expect(intelligence).toContain('key: "marketing-efficient-"');
    expect(intelligence).toContain("antes de aumentar presupuesto");
  });

  it("exposes Marketing as its own intelligence view", () => {
    expect(intelligence).toContain('{ key: "marketing", label: "Marketing" }');
    expect(intelligence).toContain('{view === "marketing" ? (');
    expect(intelligence).toContain('title="📣 De contacto a alumna"');
    expect(intelligence).toContain('title="🧠 Qué está pasando"');
  });
});
