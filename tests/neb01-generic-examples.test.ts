import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("NEB-01-42 ejemplos genéricos en lugar de Pole Fitness / Demeter", () => {
  it("formularios del admin, simulador y ejemplos de Demi y Asistian", () => {
    for (const file of [
      "app/admin/actividades/ActivityWizard.tsx",
      "app/admin/automatizaciones/[code]/page.tsx",
      "app/admin/instructores/page.tsx",
      "app/admin/integraciones/asistian/actions.ts",
      "app/admin/integraciones/demi/DemiChat.tsx",
      "app/admin/productos/por-disciplina-horario/CreateRestrictedPackageForm.tsx",
      "app/admin/productos/por-disciplina-horario/page.tsx",
      "lib/assistant/test-simulation.ts",
    ]) {
      const source = read(file);
      expect(source, file).not.toContain("Pole Fitness");
      expect(source, file).not.toContain("Estudio Demeter");
    }
  });
});
