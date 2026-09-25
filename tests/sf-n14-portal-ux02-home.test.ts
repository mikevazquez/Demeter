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
    expect(home).toContain('data-home-block="next-class"');
    expect(home).toContain("Reserva tu próxima clase");
    expect(home).toContain("Activa tu paquete");
    expect(home).toContain('"/student/paquete"');
    expect(home).toContain('"/student/reservar"');
  });

  it("keeps unlimited packages distinct from class balances", () => {
    expect(home).toContain(">Ilimitado</p>");
    expect(home).toContain("clases disponibles");
    expect(home).not.toContain("Progreso del paquete");
  });

  it("keeps the next class as the visual protagonist above package context", () => {
    expect(home.indexOf('data-home-block="next-class"')).toBeLessThan(
      home.indexOf('data-home-block="package"'),
    );
    expect(home).toContain("h-[174px]");
    expect(home).toContain("rounded-[24px]");
    expect(home).toContain("border-[rgba(247,103,220,.55)]");
  });

  it("keeps the compact Figma week strip above Tu espacio", () => {
    expect(home).toContain('aria-label="Tu semana"');
    expect(home).toContain('href={"/student/reservar?date=" + dateKey}');
    expect(home).toContain('data-home-block="space-next-class"');
    expect(home).toContain('data-home-block="package"');
    expect(home).toContain('data-home-block="medal"');
    expect(home).toContain("Mi paquete");
    expect(home).toContain("Tu espacio");
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
    expect(nav).toContain('icon: "home"');
    expect(nav).toContain('icon: "calendar"');
    expect(nav).toContain('icon: "ticket"');
    expect(nav).toContain('icon: "profile"');
    expect(nav).toContain("max-w-[365px]");
  });
});
