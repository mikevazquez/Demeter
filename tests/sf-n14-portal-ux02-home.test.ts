import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getStudentHomePackageState } from "../lib/student/home-package-state";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("SF-N14 PORTAL UX-02 home", () => {
  const home = source("app/student/page.tsx");
  const errorBoundary = source("app/student/error.tsx");
  const nav = source("app/student/StudentNav.tsx");

  it("covers the approved package and reservation states", () => {
    expect(getStudentHomePackageState(null)).toEqual({
      credits: null,
      noCredits: false,
      canReserve: false,
    });
    expect(getStudentHomePackageState({ unlimited: false, available_credits: 0 })).toEqual({
      credits: 0,
      noCredits: true,
      canReserve: false,
    });
    expect(getStudentHomePackageState({ unlimited: false, available_credits: 3 })).toEqual({
      credits: 3,
      noCredits: false,
      canReserve: true,
    });
    expect(getStudentHomePackageState({ unlimited: true, available_credits: null })).toEqual({
      credits: null,
      noCredits: false,
      canReserve: true,
    });
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

  it("preserves canonical mobile navigation", () => {
    for (const label of ["Inicio", "Reservar", "Mis clases", "Perfil"]) {
      expect(nav).toContain(`label: "${label}"`);
    }
  });
});
