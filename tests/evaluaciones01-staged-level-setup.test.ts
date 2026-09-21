import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const editor = readFileSync(
  join(process.cwd(), "app/admin/evaluaciones/plantillas/[id]/page.tsx"),
  "utf8",
);

describe("EVALUACIONES-01 staged level setup", () => {
  it("starts with criteria and continues through guided stages", () => {
    expect(editor).toContain('step === "criterios"');
    expect(editor).toContain('step === "figuras"');
    expect(editor).toContain('step === "combos"');
    expect(editor).toContain('step === "reglas"');
    expect(editor).toContain('step === "resumen"');
    expect(editor).toContain("Paso 1 de 5");
    expect(editor).toContain("Paso 5 de 5");
  });

  it("does not use the old top editor menu", () => {
    expect(editor).not.toContain('aria-label="Editor de plantilla"');
    expect(editor).not.toContain('href="#criterios"');
    expect(editor).not.toContain('href="#figuras"');
    expect(editor).not.toContain('href="#combos"');
    expect(editor).not.toContain('href="#reglas"');
  });

  it("uses save-and-continue for criteria", () => {
    expect(editor).toContain("Guardar y continuar →");
    expect(editor).toContain("?step=figuras");
  });
});
