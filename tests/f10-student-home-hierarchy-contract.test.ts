import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F10/N14 student home visual hierarchy", () => {
  const home = source("app/student/page.tsx");

  it("prioritizes an active package before the next booked class", () => {
    expect(home.indexOf('data-home-block="package"')).toBeLessThan(
      home.indexOf('data-home-block="next-class"'),
    );
    expect(home).toContain("Mi paquete");
    expect(home).toContain("Vence");
    expect(home).toContain('role="progressbar"');
  });

  it("keeps the next booked class immediately after package context", () => {
    expect(home).toContain("Tu próxima clase");
    expect(home).toContain("Confirmada");
    expect(home).toContain('href="/student/mis-clases"');
  });

  it("uses useful empty states instead of the old date carousel", () => {
    expect(home).toContain("Aún no tienes clases reservadas");
    expect(home).toContain("No tienes un paquete activo");
    expect(home).not.toContain("Clases del día");
    expect(home).not.toContain("Semana anterior");
  });

  it("keeps quick actions and activity after the primary context", () => {
    expect(home).toContain("Acciones rápidas");
    expect(home).toContain(">Reservar<");
    expect(home).toContain(">Mis clases<");
    expect(home).toContain(">Mi paquete<");
    expect(home).toContain("Disciplina también es amor propio");
  });
});
