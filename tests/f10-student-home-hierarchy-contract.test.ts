import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F10/N14 student home visual hierarchy", () => {
  const home = source("app/student/page.tsx");

  it("prioritizes the next class before package context", () => {
    expect(home.indexOf('data-home-block="next-class"')).toBeLessThan(
      home.indexOf('data-home-block="package"'),
    );
    expect(home).toContain('data-home-block="next-class"');
    expect(home).toContain("Tu lugar está confirmado");
    expect(home).toContain('"/student/mis-clases"');
  });

  it("keeps one priority action above the training hierarchy", () => {
    expect(home.indexOf('data-home-block="priority-action"')).toBeLessThan(
      home.indexOf('data-home-block="next-class"'),
    );
    expect(home).toContain("student_booking_restrictions_snapshot");
    expect(home).toContain("urgentNotificationTypes");
  });

  it("uses useful hero states without turning Home into an admin dashboard", () => {
    expect(home).toContain("Reserva tu próxima clase");
    expect(home).toContain("Activa tu paquete");
    expect(home).not.toContain("Clases del día");
    expect(home).not.toContain("Semana anterior");
    expect(home).toContain('aria-label="Progreso para desbloquear Bronce"');
    expect(home).toContain('role="progressbar"');
  });

  it("keeps Medal and package separate from technical training concepts", () => {
    expect(home).not.toContain('data-home-block="progress"');
    expect(home).not.toContain('data-home-block="technical-level"');
    expect(home).toContain('data-home-block="medal"');
    expect(home).toContain("Medalla actual");
    expect(home).not.toContain("Nivel técnico");
    expect(home).not.toContain("Tu progreso");
  });
});
