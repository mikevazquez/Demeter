import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("FESTIVOS-02 configuration center", () => {
  const migration = source(
    "supabase/migrations/20260924070000_festivos02_configuration_center.sql",
  );
  const page = source("app/admin/configuracion/festivos/page.tsx");
  const actions = source("app/admin/configuracion/festivos/actions.ts");
  const studentNotice = source("app/student/reservar/HolidayNotice.tsx");

  it("supports official and manually added studio days", () => {
    expect(migration).toContain("source_kind in ('official', 'manual')");
    expect(migration).toContain("custom_name");
    expect(migration).toContain("admin_save_calendar_day");
    expect(migration).toContain("admin_delete_manual_calendar_day");
  });

  it("creates a dedicated configuration center without replacing Agenda", () => {
    expect(page).toContain("Días festivos");
    expect(page).toContain("Agregar día especial");
    expect(page).toContain("Aplicar a seleccionados");
    expect(page).toContain("Configurar este día");
    expect(page).toContain("Horario especial");
    expect(page).not.toContain("Editar Año Nuevo");
  });

  it("allows editorial artwork uploads for both holiday cards", () => {
    expect(migration).toContain("'holiday-artwork'");
    expect(migration).toContain("hero_image_path");
    expect(migration).toContain("message_image_path");
    expect(actions).toContain('from("holiday-artwork").upload');
    expect(page).toContain('name="hero_image"');
    expect(page).toContain('name="message_image"');
  });

  it("uses uploaded artwork in the student experience and keeps text dynamic", () => {
    expect(studentNotice).toContain("holiday.hero_image_url");
    expect(studentNotice).toContain("holiday.message_image_url");
    expect(studentNotice).toContain("{holiday.name}");
    expect(studentNotice).toContain("{holiday.message}");
    expect(studentNotice).toContain('holiday.is_official ? "Festivo oficial" : "Día especial"');
  });

  it("bulk special mode preserves currently published sessions by default", () => {
    expect(actions).toContain('mode === "special" ? await sessionIdsForDate(ctx, date) : []');
    expect(page).toContain(
      "En Horario especial se conservan inicialmente las sesiones ya publicadas",
    );
    expect(page).toContain('form="holiday-bulk-form"');
  });
});
