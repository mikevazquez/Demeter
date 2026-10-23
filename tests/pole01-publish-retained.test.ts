import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261022190000_pole01_publish_marks_and_retained_promotion.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("POLE-01-17/18 publish marks and retained promotion", () => {
  it("marks approved figures when a catalog evaluation is published", () => {
    expect(migration).toContain("after update of status on public.technical_evaluations");
    expect(migration).toContain("c.criterion_key = 'pole_mandatory'");
    expect(migration).toContain("c.criterion_key = 'pole_nomenclature'");
  });

  it("retains the promotion and releases it when the missing figure is marked in class", () => {
    expect(migration).toContain("new.final_outcome = 'stays'");
    expect(migration).toContain("after insert on public.student_pole_figure_achievements");
    expect(migration).toContain("set status = 'released'");
  });
});
