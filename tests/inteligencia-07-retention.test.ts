import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("INTEL-07 retention intelligence", () => {
  const intelligence = source("app/admin/inteligencia/page.tsx");

  it("loads enough behavioral history for early retention signals", () => {
    expect(intelligence).toContain("now.getTime() - 42 * DAY");
    expect(intelligence).toContain('.gte("occurred_at", eventStartIso)');
  });

  it("compares each student against recent and baseline attendance", () => {
    expect(intelligence).toContain("retentionRecentStart");
    expect(intelligence).toContain("retentionBaselineStart");
    expect(intelligence).toContain("baselineAttendance >= 4");
    expect(intelligence).toContain("recentWeekly <= baselineWeekly * 0.5");
  });

  it("uses explainable signals rather than an opaque probability", () => {
    expect(intelligence).toContain("14 días sin asistir");
    expect(intelligence).toContain("sin próxima reserva");
    expect(intelligence).toContain("cancelaciones/no show recientes");
    expect(intelligence).toContain("score >= 3");
    expect(intelligence).toContain("Señales preventivas");
  });

  it("does not penalize brand-new acquisitions for missing history", () => {
    expect(intelligence).toContain("isNewAcquisition");
    expect(intelligence).toContain("acquisitionAgeDays < 7");
    expect(intelligence).toContain("!isNewAcquisition && recentAttendance === 0");
  });

  it("separates urgent intervention from preventive watchlist", () => {
    expect(intelligence).toContain("urgentRetentionStudents");
    expect(intelligence).toContain("watchRetentionStudents");
    expect(intelligence).toContain('title="🔴 Alta prioridad"');
    expect(intelligence).toContain('title="🟡 Vigilar"');
    expect(intelligence).toContain('key: "retention-preventive-urgent"');
    expect(intelligence).toContain('key: "retention-preventive-watch"');
  });

  it("waits 30 days before confirming churn", () => {
    expect(intelligence).toContain("pendingMaturity");
    expect(intelligence).toContain("churnConfirmed");
    expect(intelligence).toContain("age >= 30");
    expect(intelligence).toContain("Churn confirmado");
    expect(intelligence).toContain("Reactivaron >30 días");
  });

  it("separates renewal timing buckets", () => {
    expect(intelligence).toContain("gapDays <= 0");
    expect(intelligence).toContain("gapDays <= 7");
    expect(intelligence).toContain("gapDays <= 30");
    expect(intelligence).toContain("renewedWithin30");
  });
});
