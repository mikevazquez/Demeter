import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { summarizeRewardMetrics } from "../lib/rewards/metrics";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("SF-245 Rewards metrics", () => {
  it("separates deterministic potential value from realized value", () => {
    const metrics = summarizeRewardMetrics([
      {
        status: "available",
        kind: "fixed_discount",
        benefit_definition: { amount_minor: 10_000 },
      },
      {
        status: "redeemed",
        kind: "fixed_discount",
        benefit_definition: { amount_minor: 10_000 },
        redemption_context: { actual_savings_minor: 6_500 },
      },
    ]);

    expect(metrics.potentialValueMinor).toBe(20_000);
    expect(metrics.realizedValueMinor).toBe(6_500);
    expect(metrics.redeemed).toBe(1);
    expect(metrics.benefitsApplied).toBe(1);
  });

  it("never treats an unused reward as realized cost", () => {
    const metrics = summarizeRewardMetrics([
      {
        status: "available",
        kind: "fixed_discount",
        benefit_definition: { amount_minor: 5_000 },
      },
    ]);

    expect(metrics.potentialValueMinor).toBe(5_000);
    expect(metrics.realizedValueMinor).toBe(0);
    expect(metrics.benefitsApplied).toBe(0);
  });

  it("does not invent a monetary value for percentage or non-priced benefits", () => {
    const metrics = summarizeRewardMetrics([
      {
        status: "available",
        kind: "percentage_discount",
        benefit_definition: { percent: 20 },
      },
      {
        status: "expired",
        kind: "special_benefit",
        benefit_definition: { label: "Acceso especial" },
      },
    ]);

    expect(metrics.potentialValueMinor).toBe(0);
    expect(metrics.unvaluedPotentialCount).toBe(2);
  });

  it("tracks credits granted separately from credits actually used", () => {
    const metrics = summarizeRewardMetrics([
      {
        status: "available",
        kind: "credits",
        benefit_definition: { credits: 2 },
      },
      {
        status: "redeemed",
        kind: "credits",
        benefit_definition: { credits: 3 },
      },
    ]);

    expect(metrics.creditsGranted).toBe(5);
    expect(metrics.creditsUsed).toBe(3);
    expect(metrics.realizedValueMinor).toBe(0);
  });

  it("keeps revoked rewards in the historical count but excludes their potential exposure", () => {
    const metrics = summarizeRewardMetrics([
      {
        status: "revoked",
        kind: "fixed_discount",
        benefit_definition: { amount_minor: 7_000 },
      },
    ]);

    expect(metrics.granted).toBe(1);
    expect(metrics.revoked).toBe(1);
    expect(metrics.potentialValueMinor).toBe(0);
  });

  it("surfaces operational and economic metrics in global, rule and student views", () => {
    const home = read("app/admin/recompensas/page.tsx");
    const rule = read("app/admin/recompensas/reglas/[ruleId]/page.tsx");
    const student = read("app/admin/recompensas/alumnas/[studentId]/page.tsx");

    expect(home).toContain("summarizeRewardMetrics");
    expect(home).toContain("Valor potencial");
    expect(home).toContain("Valor utilizado");
    expect(rule).toContain("summarizeRewardMetrics");
    expect(rule).toContain("Valor utilizado");
    expect(student).toContain("summarizeRewardMetrics");
    expect(student).toContain("Valor utilizado");
  });
});
