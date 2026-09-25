import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("ALUMNA UX FINAL K · Home V2", () => {
  const home = source("app/student/page.tsx");

  it("uses one dominant dynamic hero", () => {
    expect(home).toContain('data-home-block="next-class"');
    expect(home).toContain("min-h-[230px]");
    expect(home).toContain("Tu próxima clase");
    expect(home).toContain("Reserva tu próxima clase");
    expect(home).toContain("Activa tu paquete");
    expect(home).toContain("Tu lugar está confirmado");
  });

  it("matches the approved Home hierarchy", () => {
    expect(home).toContain('data-home-block="week-calendar"');
    expect(home).toContain('data-home-block="space-next-class"');
    expect(home).toContain('data-home-block="package"');
    expect(home).toContain('data-home-block="medal"');
    expect(home).toContain("Tu espacio");
  });

  it("keeps Medal visible without mixing it with technical level", () => {
    expect(home).toContain("Medalla actual");
    expect(home).not.toContain('data-home-block="technical-level"');
    expect(home).not.toContain("Tu progreso");
  });

  it("keeps urgent notices actionable without a notification card", () => {
    expect(home).toContain("urgentNotificationTypes");
    expect(home).toContain("Necesita tu atención");
    expect(home).not.toContain(">Avisos<");
    expect(home).not.toContain("Notificaciones de Demeter");
  });

  it("surfaces gift classes directly on the package card", () => {
    expect(home).toContain("giftClassWallets");
    expect(home).toContain("giftClassesAvailable");
    expect(home).toContain("clase de regalo");
    expect(home).toContain("clases de regalo");
  });

  it("uses the approved Demeter visual cues", () => {
    expect(home).toContain("Hola, {snapshot.profile.first_name} 👋");
    expect(home).toContain("Mi paquete 🎁");
    expect(home).toContain("Medalla actual 🏅");
    expect(home).toContain("bg-fuchsia-500");
    expect(home).not.toContain("STUDIO FLOW");
  });
});
