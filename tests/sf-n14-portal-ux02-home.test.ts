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
    expect(home).toContain("Activa tu paquete");
    expect(home).toContain('"/student/paquete"');
    expect(home).toContain('"/student/reservar"');
  });

  it("keeps unlimited packages distinct from class balances", () => {
    expect(home).toContain('"Ilimitado"');
    expect(home).toContain("clases disponibles");
    expect(home).not.toContain("Progreso del paquete");
  });

  it("keeps the next class as the visual protagonist above package context", () => {
    expect(home.indexOf('data-home-block="next-class"')).toBeLessThan(
      home.indexOf('data-home-block="package"'),
    );
    expect(home).toContain("min-h-[230px]");
    expect(home).toContain("shadow-[0_22px_70px_rgba(255,10,138,0.12)]");
    expect(home).toContain("min-h-11");
  });

  it("keeps the calendar in Reservar and leaves Home focused on Tu espacio", () => {
    expect(home).not.toContain('data-home-block="week-calendar"');
    expect(home).not.toContain("href={`/student/reservar?date=${day.key}`}");
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
    expect(nav).toContain('emoji: "🏠"');
    expect(nav).toContain('emoji: "📅"');
    expect(nav).toContain('emoji: "🎟️"');
    expect(nav).toContain('emoji: "👤"');
  });
});
