
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

  it("matches the approved content hierarchy below the hero", () => {
    expect(home).toContain('data-home-block="technical-level"');
    expect(home).toContain('data-home-block="medal"');
    expect(home).toContain('data-home-block="week-calendar"');
    expect(home).toContain('data-home-block="package"');
    expect(home).toContain('data-home-block="following-class"');
  });

  it("keeps technical level and medal semantically separate", () => {
    expect(home).toContain("Nivel técnico");
    expect(home).toContain("Medalla actual");
    expect(home).not.toContain("Tu progreso");
  });

  it("removes the notification card while keeping urgent alerts actionable", () => {
    expect(home).toContain("urgentNotificationTypes");
    expect(home).toContain("Necesita tu atención");
    expect(home).not.toContain(">Avisos<");
    expect(home).not.toContain("Notificaciones de Demeter");
  });

  it("keeps the approved Studio Flow-inspired visual language under Demeter branding", () => {
    expect(home).toContain("rounded-[2rem]");
    expect(home).toContain("bg-fuchsia-600");
    expect(home).toContain("shadow-[0_22px_70px_rgba(255,10,138,0.14)]");
    expect(home).not.toContain("STUDIO FLOW");
  });
});
