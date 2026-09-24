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

  it("covers the approved package and reservation states", () => {
    expect(home).toContain("Tus clases reservadas");
    expect(home).toContain("Aún no tienes clases reservadas");
    expect(home).toContain("Aún no tienes un paquete activo");
    expect(home).toContain("Comprar paquete");
    expect(home).toContain("Reservar clase");
  });

  it("keeps unlimited packages semantically distinct from credits", () => {
    expect(home).toContain('activePackage.unlimited ? "Ilimitado"');
    expect(home).toContain("Acceso durante tu vigencia");
  });

  it("keeps an active package above reserved classes with mobile-first cards", () => {
    expect(home.indexOf('data-home-block="package"')).toBeLessThan(
      home.indexOf('data-home-block="reserved-classes"'),
    );
    expect(home).toContain("rounded-[24px]");
    expect(home).toContain("min-h-11");
  });

  it("removes duplicate quick actions from home while preserving navigation destinations", () => {
    expect(home).not.toContain("Acciones rápidas");
    expect(home).toContain('href="/student/reservar"');
    expect(home).toContain('href="/student/mis-clases"');
    expect(home).toContain('href="/student/paquete"');
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
