import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("FESTIVOS-01 calendar UX", () => {
  const adminHolidays = source("app/admin/configuracion/festivos/page.tsx");
  const holidayAction = source("app/admin/configuracion/festivos/actions.ts");
  const studentCalendar = source("app/student/reservar/page.tsx");
  const holidayNotice = source("app/student/reservar/HolidayNotice.tsx");
  const studentClasses = source("app/student/mis-clases/page.tsx");
  const studentNav = source("app/student/StudentNav.tsx");

  it("shows official holidays and studio overrides in the existing settings flow", () => {
    expect(adminHolidays).toContain('.from("official_holidays")');
    expect(adminHolidays).toContain('.from("studio_holiday_overrides")');
    expect(adminHolidays).toContain("Días festivos");
    expect(adminHolidays).toContain("getAdminContext(CAPABILITIES.SETTINGS_WRITE)");
    expect(adminHolidays).toContain('ctx.membership.role !== "owner"');
    expect(adminHolidays).toContain("Estudio cerrado");
    expect(adminHolidays).toContain("Horario normal");
    expect(studentNav).not.toContain("Festivos");
    expect(studentNav).not.toContain("Días especiales");
  });

  it("lets the owner mark an official holiday closed or leave normal hours", () => {
    expect(adminHolidays).toContain("Marcar como cerrado");
    expect(adminHolidays).toContain("Marcar como abierto");
    expect(adminHolidays).toContain("saveOfficialHolidayStatusAction");
    expect(holidayAction).toContain('p_operation_mode: closed ? "closed" : "normal"');
    expect(holidayAction).toContain("admin_configure_holiday");
    expect(holidayAction).toContain('ctx.membership.role !== "owner"');
    expect(holidayAction).toContain('revalidatePath("/admin/agenda")');
    expect(holidayAction).toContain('revalidatePath("/student/reservar")');
    expect(holidayAction).toContain('revalidatePath("/student/mis-clases")');
  });

  it("keeps a themed holiday message visible to students", () => {
    expect(holidayNotice).toContain("data-holiday-theme");
    expect(holidayNotice).toContain("holiday.message");
  });

  it("shows the compact student holiday view without the extra credit info box", () => {
    expect(studentCalendar).toContain("student_holiday_snapshot");
    expect(studentCalendar).toContain("student_holiday_week_snapshot");
    expect(studentCalendar).toContain("<HolidayNotice");
    expect(holidayNotice).toContain("El estudio permanecerá cerrado por");
    expect(holidayNotice).toContain("No habrá clases disponibles este día.");
    expect(holidayNotice).toContain("Festivo oficial");
    expect(holidayNotice).toContain("holidayOperationLabel");
    expect(holidayNotice).toContain("theme.motif");
    expect(holidayNotice).not.toContain("HolidayArtwork");
    expect(holidayNotice).not.toContain("MexicanRibbon");
    expect(holidayNotice).not.toContain(
      "Si tenías una reserva, tu crédito será restaurado automáticamente",
    );
    expect(holidayNotice).not.toContain("Fuente oficial:");
  });

  it("shows studio cancellation reason and restored credit in student history", () => {
    expect(studentClasses).toContain('item.status === "cancelled_by_studio"');
    expect(studentClasses).toContain("item.cancellation_reason");
    expect(studentClasses).toContain("Crédito restaurado");
  });
});
