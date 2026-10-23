import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const plan = readFileSync(
  new URL(
    "../supabase/migrations/20261022180000_pole01_evaluation_figure_plan.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("POLE-01-14 combo and dictation per evaluation", () => {
  it("stores exactly 4 combo and 3 dictated figures", () => {
    expect(plan).toContain("check (cardinality(combo_figure_ids) = 4)");
    expect(plan).toContain("check (cardinality(dictated_figure_ids) = 3)");
  });

  it("excludes the level's mandatory figures and freezes on start", () => {
    expect(plan).toContain("from public.pole_level_mandatory_figures m");
    expect(plan).toContain("raise exception 'pole_plan_locked'");
  });

  it("requires live confirmation of every figure for Élite", () => {
    expect(plan).toContain("raise exception 'pole_plan_confirmation_required'");
  });
});
