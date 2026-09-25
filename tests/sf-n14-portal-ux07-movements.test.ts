import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("SF-N14 PORTAL UX-07 Uso de mis clases", () => {
  const page = source("app/student/movimientos/page.tsx");

  it("keeps class usage read-only and sourced from the canonical student snapshot", () => {
    expect(page).toContain("getStudentPortalContext()");
    expect(page).toContain("snapshot.movements");
    expect(page).not.toContain('.from("credit_ledger")');
    expect(page).not.toContain(".insert(");
    expect(page).not.toContain(".update(");
    expect(page).not.toContain(".delete(");
  });

  it("uses student language instead of ledger and credit terminology", () => {
    expect(page).toContain("Uso de mis clases");
    expect(page).toContain("Clases agregadas a tu cuenta");
    expect(page).toContain("Clase devuelta");
    expect(page).toContain("Clase utilizada");
    expect(page).not.toContain("Historial de tus créditos");
    expect(page).not.toContain("Actividad de créditos");
    expect(page).not.toContain("Studio Flow");
    expect(page).not.toContain(">créditos<");
  });

  it("keeps the current package summary simple", () => {
    expect(page).toContain('data-movements-block="summary"');
    expect(page).toContain("clases disponibles");
    expect(page).toContain('href="/student/paquete"');
    expect(page).not.toContain("Utilizadas");
  });

  it("keeps real movement context and all canonical movement types", () => {
    expect(page).toContain('type === "grant"');
    expect(page).toContain('type === "reserve"');
    expect(page).toContain('type === "release"');
    expect(page).toContain('type === "consume"');
    expect(page).toContain('type === "adjustment"');
    expect(page).toContain("movement.activity");
    expect(page).toContain("movement.product");
    expect(page).toContain("movement.note");
    expect(page).toContain("movement.created_at");
    expect(page).toContain("movement.quantity");
  });

  it("provides an explicit empty state with a useful existing route", () => {
    expect(page).toContain('data-movements-block="empty"');
    expect(page).toContain("Todavía no hay uso registrado");
    expect(page).toContain('activePackage ? "/student/reservar" : "/student/paquete"');
  });
});
