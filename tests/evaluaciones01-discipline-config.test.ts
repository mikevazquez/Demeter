import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const overview = readFileSync(
  join(process.cwd(), "app/admin/evaluaciones/configuracion/page.tsx"),
  "utf8",
);

const discipline = readFileSync(
  join(
    process.cwd(),
    "app/admin/evaluaciones/configuracion/[disciplineId]/page.tsx",
  ),
  "utf8",
);

describe("EVALUACIONES-01 discipline-first configuration", () => {
  it("keeps the global configuration screen focused on disciplines", () => {
    expect(overview).toContain("Configura cada disciplina de forma independiente");
    expect(overview).toContain("Configurar →");
    expect(overview).not.toContain('href="#niveles"');
    expect(overview).not.toContain('href="#reglas"');
    expect(overview).not.toContain('href="#plantillas"');
  });

  it("moves levels, upcoming evaluations and templates inside each discipline", () => {
    expect(discipline).toContain('view === "niveles"');
    expect(discipline).toContain('view === "proximas"');
    expect(discipline).toContain('view === "plantillas"');
    expect(discipline).toContain("Próximas evaluaciones");
    expect(discipline).toContain("Plantillas de evaluación");
    expect(discipline).toContain("Niveles de");
  });

  it("uses real tab navigation instead of same-page anchors", () => {
    expect(discipline).toContain("?view=niveles");
    expect(discipline).toContain("?view=proximas");
    expect(discipline).toContain("?view=plantillas");
    expect(discipline).not.toContain('href="#niveles"');
    expect(discipline).not.toContain('href="#plantillas"');
  });
});
