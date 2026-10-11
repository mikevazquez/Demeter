import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F10 student reserve UAT contracts", () => {
  const reservePage = source("app/student/reservar/page.tsx");
  const scheduleMigration = source(
    "supabase/migrations/20261002014000_student_schedule_keep_cancelled_visible.sql",
  );

  it("keeps the date selector anchored to a Monday-Sunday week", () => {
    expect(reservePage).toContain("const weekStart = startOfWeek(selectedDate)");
    expect(reservePage).toContain("Array.from({ length: 7 }");
    expect(reservePage).toContain('aria-label="Semana anterior"');
    expect(reservePage).toContain('aria-label="Semana siguiente"');
    expect(reservePage).toContain("addDays(weekStart, index)");
  });

  it("keeps cancelled classes visible in the selected day agenda without booking actions", () => {
    expect(scheduleMigration).toContain("'status', cs.status::text");
    expect(scheduleMigration).toContain("cs.status = 'cancelled'");
    expect(scheduleMigration).toContain("cs.starts_at >= v_from");
    expect(reservePage).toContain('session.status === "cancelled"');
    expect(reservePage).toContain("Cancelada por el estudio");
    expect(reservePage).toContain("{cancelled ? null : reserved ? (");
  });

  it("shows every class for the selected day without discipline filters", () => {
    expect(reservePage).toContain("target_start: selectedDate");
    expect(reservePage).toContain("target_end: selectedDate");
    expect(reservePage).toContain("target_discipline_id: null");
    expect(reservePage).not.toContain('name="discipline"');
    expect(reservePage).not.toContain("disciplineId");
    expect(reservePage).not.toContain("Aplicar filtro");
  });
});
