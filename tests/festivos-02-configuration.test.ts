import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("FESTIVOS simple configuration", () => {
  const page = source("app/admin/configuracion/festivos/page.tsx");
  const actions = source("app/admin/configuracion/festivos/actions.ts");

  it("loads only official holidays into the configuration screen", () => {
    expect(page).toContain('from("official_holidays")');
    expect(page).toContain("Festivo oficial");
    expect(page).toContain("Los días oficiales se cargan automáticamente");
    expect(page).not.toContain("Agregar día especial");
    expect(page).not.toContain("Imagen principal");
    expect(page).not.toContain("Horario especial");
  });

  it("supports only normal operation or studio closed", () => {
    expect(page).toContain("Horario normal");
    expect(page).toContain("Estudio cerrado");
    expect(page).toContain("Marcar como cerrado");
    expect(page).toContain("Marcar como abierto");
    expect(actions).toContain('closed ? "closed" : "normal"');
    expect(actions).not.toContain('"special"');
  });

  it("uses the existing official holiday RPC and keeps Agenda in sync", () => {
    expect(actions).toContain('rpc("admin_configure_holiday"');
    expect(actions).toContain('revalidatePath("/admin/agenda")');
    expect(actions).toContain('revalidatePath("/student/reservar")');
  });
});
