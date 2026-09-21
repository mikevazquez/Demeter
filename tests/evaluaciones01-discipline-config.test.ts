import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const evaluations = readFileSync(
  join(process.cwd(), "app/admin/evaluaciones/page.tsx"),
  "utf8",
);

const discipline = readFileSync(
  join(process.cwd(), "app/admin/evaluaciones/disciplina/[disciplineId]/page.tsx"),
  "utf8",
);

describe("EVALUACIONES-01 discipline-first configuration", () => {
  it("starts Evaluaciones by asking which discipline to work with", () => {
    expect(evaluations).toContain("¿Qué disciplina quieres evaluar?");
    expect(evaluations).toContain("/admin/evaluaciones/disciplina/");
    expect(evaluations).not.toContain("/admin/evaluaciones/configuracion#");
  });

  it("keeps levels, rules, templates and upcoming evaluations inside each discipline", () => {
    expect(discipline).toContain("Niveles de");
    expect(discipline).toContain("Reglas de evaluación");
    expect(discipline).toContain("Plantillas de evaluación");
    expect(discipline).toContain("Próximas evaluaciones");
  });

  it("does not use a top tab menu to split discipline configuration", () => {
    expect(discipline).not.toContain('className="eval-tabs"');
    expect(discipline).not.toContain("?view=niveles");
    expect(discipline).not.toContain("?view=plantillas");
    expect(discipline).not.toContain("?view=proximas");
  });
});
