import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("SF-N14 PORTAL UX-02 home", () => {
  const home = source("app/student/page.tsx");
  const errorBoundary = source("app/student/error.tsx");
  const nav = source("app/student/StudentNav.tsx");

  it("covers the approved package and next-class states", () => {
    expect(home).toContain("Tu próxima clase");
    expect(home).toContain("Reserva tu próxima clase");
    expect(home).toContain("No tienes un paquete activo");
    expect(home).toContain("Ver paquetes");
    expect(home).toContain("Reservar una clase");
  });

  it("keeps unlimited packages semantically distinct from class balances", () => {
    expect(home).toContain('"Clases ilimitadas"');
    expect(home).toContain("clases disponibles");
    expect(home).not.toContain("Progreso del paquete");
  });

  it("keeps the next class as the visual protagonist above package context", () => {
    expect(home.indexOf('data-home-block="next-class"')).toBeLessThan(
      home.indexOf('data-home-block="package"'),
    );
    expect(home).toContain("min-h-[330px]");
    expect(home).toContain("shadow-[0_22px_70px_rgba(255,10,138,0.14)]");
    expect(home).toContain("min-h-11");
  });

  it("adds compact quick actions without changing the four-destination global navigation", () => {
    expect(home).toContain('aria-label="Acciones rápidas"');
    expect(home).toContain('href="/student/reservar"');
    expect(home).toContain('href="/student/mis-clases"');
    expect(home).toContain('href="/student/paquete"');
    expect(home).toContain("Reservar");
    expect(home).toContain("Mis clases");
    expect(home).toContain("Mi paquete");
  });

  it("provides a recoverable temporary error state", () => {
    expect(errorBoundary).toContain("No pudimos cargar tu información");
    expect(errorBoundary).toContain("Reintentar");
    expect(errorBoundary).toContain("reset");
  });

  it("preserves the four-destination student navigation", () => {
    for (const label of ["Inicio", "Reservar", "Mis clases", "Perfil"]) {
      expect(nav).toContain(`label: "${label}"`);
    }
    expect(nav).not.toContain('label: "Retos"');
    expect(nav).toContain("grid-cols-4");
    expect(nav).toContain("<svg");
  });
});
