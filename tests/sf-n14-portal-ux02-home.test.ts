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
    expect(home).toContain("Tu próxima clase");
    expect(home).toContain("Aún no tienes clases reservadas");
    expect(home).toContain("Tu paquete ya no tiene clases disponibles");
    expect(home).toContain("No tienes un paquete activo");
    expect(home).toContain("Vence pronto");
  });

  it("keeps unlimited packages semantically distinct from credits", () => {
    expect(home).toContain('activePackage.unlimited ? "Ilimitado"');
    expect(home).toContain("Tu paquete tiene acceso ilimitado");
  });

  it("offers the approved quick actions", () => {
    expect(home).toContain("Reservar clase");
    expect(home).toContain("Ver mis clases");
    expect(home).toContain("Ver mi paquete");
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
