import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F10/N14 student home visual hierarchy", () => {
  const home = source("app/student/page.tsx");

  it("prioritizes the next booked class on the home dashboard", () => {
    expect(home).toContain("Tu próxima clase");
    expect(home).toContain("Confirmada");
    expect(home).toContain('href="/student/mis-clases"');
  });

  it("keeps the active package summary immediately available", () => {
    expect(home).toContain("Mi paquete");
    expect(home).toContain("Vence");
    expect(home).toContain('role="progressbar"');
  });

  it("uses useful empty states instead of the old date carousel", () => {
    expect(home).toContain("Aún no tienes clases reservadas");
    expect(home).toContain("No tienes un paquete activo");
    expect(home).not.toContain("Clases del día");
    expect(home).not.toContain("Semana anterior");
  });

  it("keeps quick actions and activity after the primary context", () => {
    expect(home).toContain("Acciones rápidas");
    expect(home).toContain("Reservar clase");
    expect(home).toContain("Ver mis clases");
    expect(home).toContain("Ver mi paquete");
    expect(home).toContain("Disciplina también es amor propio");
  });
});
