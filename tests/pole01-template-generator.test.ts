import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  mandatoryReadiness,
  POLE_DEFAULT_MINIMUM,
  POLE_NEXT_STUDENT_LEVEL,
} from "@/lib/pole/level-settings";

const generator = readFileSync(
  new URL(
    "../supabase/migrations/20261022170000_pole01_evaluation_template_generator.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("POLE-01-13 evaluation template generator", () => {
  it("builds the three approved blocks with weights 40/30/30", () => {
    expect(generator).toContain("'pole_combo', 'Combo de evaluación'");
    expect(generator).toMatch(/'weighted_criteria',\s*'Escala 1–10/);
    expect(generator).toContain("'pole_mandatory', 'Figuras obligatorias'");
    expect(generator).toContain("'pole_nomenclature', 'Nomenclatura'");
    expect(generator).toMatch(
      /v_block, true, 10, v_sort, v_criterion.name, v_criterion.description, 'criterion', 25/,
    );
  });

  it("uses the four combo criteria Mike defined", () => {
    for (const criterion of ["Fuerza", "Flexibilidad", "Técnica", "Líneas"]) {
      expect(generator).toContain(`('${criterion}',`);
    }
  });

  it("activates through the existing engine and never touches started evaluations", () => {
    expect(generator).toContain(
      "perform public.admin_activate_evaluation_template_version_v2(v_version);",
    );
    expect(generator).not.toContain("technical_evaluations");
  });
});

describe("POLE-01 level readiness", () => {
  it("requires 4–5 approved mandatory figures and no pending proposals", () => {
    expect(mandatoryReadiness([])).toBe("missing");
    expect(mandatoryReadiness(["proposed", "proposed"])).toBe("proposed");
    expect(mandatoryReadiness(["approved", "approved", "approved", "proposed"])).toBe("partial");
    expect(mandatoryReadiness(["approved", "approved", "approved"])).toBe("partial");
    expect(mandatoryReadiness(["approved", "approved", "approved", "approved"])).toBe("ready");
  });

  it("keeps Élite as the top level without a minimum", () => {
    expect(POLE_NEXT_STUDENT_LEVEL.elite).toBeNull();
    expect(POLE_DEFAULT_MINIMUM).toEqual({
      beginner: 85,
      intermediate: 87,
      upper_intermediate: 90,
      advanced: 92,
      elite: null,
    });
  });
});
