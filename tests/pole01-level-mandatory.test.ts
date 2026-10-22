import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261022160000_pole01_level_map_mandatory_figures.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("POLE-01-08/09 level map, minimums and mandatory figures", () => {
  it("maps the five student levels to the catalog as Mike decided", () => {
    expect(migration).toContain("(p_studio, p_discipline, 'beginner', 'principiante', 85)");
    expect(migration).toContain("(p_studio, p_discipline, 'intermediate', 'intermedio', 87)");
    expect(migration).toContain("(p_studio, p_discipline, 'upper_intermediate', 'intermedio', 90)");
    expect(migration).toContain("(p_studio, p_discipline, 'advanced', 'avanzado', 92)");
    expect(migration).toContain("(p_studio, p_discipline, 'elite', 'profesional', null)");
  });

  it("keeps mandatory figures inside the mapped level and at most five per level", () => {
    expect(migration).toContain("pole_mandatory_level_mismatch");
    expect(migration).toContain("pole_mandatory_limit");
    expect(migration).toContain("check (level_key <> 'elite')");
  });

  it("only lets evaluation configurators write, through functions", () => {
    expect(migration).toContain("'evaluations.configure'");
    expect(migration).toContain(
      "revoke all on public.pole_level_mandatory_figures from public, anon, authenticated;",
    );
  });
});
