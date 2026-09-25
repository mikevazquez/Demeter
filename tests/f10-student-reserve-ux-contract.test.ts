import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F10 student reserve UAT contracts", () => {
  const reservePage = source("app/student/reservar/page.tsx");

  it("keeps the date selector anchored to a Monday-Sunday week", () => {
    expect(reservePage).toContain("const weekStart = startOfWeek(selectedDate)");
    expect(reservePage).toContain("Array.from({ length: 7 }");
    expect(reservePage).toContain('aria-label="Semana anterior"');
    expect(reservePage).toContain('aria-label="Semana siguiente"');
    expect(reservePage).toContain("addDays(weekStart, index)");
  });

  it("keeps day primary while allowing a lightweight discipline filter", () => {
    expect(reservePage).toContain("target_start: selectedDate");
    expect(reservePage).toContain("target_end: selectedDate");
    expect(reservePage).toContain("target_discipline_id: selectedDiscipline");
    expect(reservePage).toContain('aria-label="Filtrar por disciplina"');
    expect(reservePage).toContain("✨ Todas");
    expect(reservePage).not.toContain("Aplicar filtro");
  });
});
