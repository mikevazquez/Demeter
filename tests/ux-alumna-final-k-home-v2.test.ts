import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("ALUMNA UX FINAL K · Home V2", () => {
  const home = source("app/student/page.tsx");

  it("uses one dominant dynamic hero instead of equal-weight cards", () => {
    expect(home).toContain('data-home-block="next-class"');
    expect(home).toContain("min-h-[330px]");
    expect(home).toContain("Tu próxima clase");
    expect(home).toContain("Reserva tu próxima clase");
    expect(home).toContain("Activa tu próximo paquete");
    expect(home).toContain("Tu lugar está confirmado");
  });

  it("adds visual quick actions for the three most frequent student tasks", () => {
    expect(home).toContain('aria-label="Acciones rápidas"');
    expect(home).toContain("Reservar");
    expect(home).toContain("Mis clases");
    expect(home).toContain("Mi paquete");
  });

  it("keeps technical level and medal semantically separate", () => {
    expect(home).toContain('data-home-block="technical-level"');
    expect(home).toContain('data-home-block="medal"');
    expect(home).toContain("Nivel técnico");
    expect(home).toContain("Medalla actual");
    expect(home).not.toContain("Tu progreso");
  });

  it("keeps notifications compact and urgent notices actionable", () => {
    expect(home).toContain("urgentNotificationTypes");
    expect(home).toContain("Necesita tu atención");
    expect(home).toContain("Avisos");
    expect(home).toContain('href="/student/notificaciones"');
  });

  it("uses the approved Demeter editorial visual direction", () => {
    expect(home).toContain("font-serif");
    expect(home).toContain("rounded-[2rem]");
    expect(home).toContain("bg-fuchsia-600");
    expect(home).toContain("Disciplina hoy, resultados");
    expect(home).toContain("mañana.");
  });
});
