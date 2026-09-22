import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F10/N14 student home visual hierarchy", () => {
  const home = source("app/student/page.tsx");

  it("prioritizes an active package before reserved classes", () => {
    expect(home.indexOf('data-home-block="package"')).toBeLessThan(
      home.indexOf('data-home-block="reserved-classes"'),
    );
    expect(home).toContain("Mi paquete");
    expect(home).toContain("Vence");
    expect(home).toContain('role="progressbar"');
  });

  it("keeps reserved classes immediately after package context", () => {
    expect(home).toContain("Tus clases reservadas");
    expect(home).toContain("Confirmada");
    expect(home).toContain('href="/student/mis-clases"');
  });

  it("uses useful empty states instead of the old date carousel", () => {
    expect(home).toContain("Aún no tienes clases reservadas");
    expect(home).toContain("Aún no tienes un paquete activo");
    expect(home).not.toContain("Clases del día");
    expect(home).not.toContain("Semana anterior");
  });

  it("removes duplicated progress, quick actions and activity metrics from home", () => {
    expect(home).not.toContain("Acciones rápidas");
    expect(home).not.toContain("Disciplina también es amor propio");
    expect(home).not.toContain('data-home-block="progress"');
    expect(home).toContain("Mis beneficios");
    expect(home).toContain("Niveles técnicos");
  });
});
