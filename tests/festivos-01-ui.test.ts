import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("FESTIVOS-01 calendar UX", () => {
  const adminAgenda = source("app/admin/agenda/page.tsx");
  const configurator = source("app/admin/agenda/HolidayConfigurator.tsx");
  const studentCalendar = source("app/student/reservar/page.tsx");
  const holidayNotice = source("app/student/reservar/HolidayNotice.tsx");
  const studentClasses = source("app/student/mis-clases/page.tsx");
  const studentNav = source("app/student/StudentNav.tsx");

  it("integrates holidays into the existing admin Agenda instead of adding a second calendar", () => {
    expect(adminAgenda).toContain("official_holidays");
    expect(adminAgenda).toContain("HolidayConfigurator");
    expect(adminAgenda).toContain("agenda-week-holiday");
    expect(studentNav).not.toContain("Festivos");
    expect(studentNav).not.toContain("Días especiales");
  });

  it("lets the studio choose normal, closed or special operation", () => {
    expect(configurator).toContain("Horario normal");
    expect(configurator).toContain("Estudio cerrado");
    expect(configurator).toContain("Horario especial");
    expect(configurator).toContain("keep_session_id");
    expect(configurator).toContain("Este cambio afectará");
  });

  it("keeps a themed editable message for every holiday", () => {
    expect(configurator).toContain("Mensaje temático para alumnas");
    expect(configurator).toContain("student_message");
    expect(holidayNotice).toContain("data-holiday-theme");
    expect(holidayNotice).toContain("holiday.message");
  });

  it("shows the original compact student holiday view without the extra credit info box", () => {
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

  it("shows studio cancellation reason and returned class in student history", () => {
    expect(studentClasses).toContain('item.status === "cancelled_by_studio"');
    expect(studentClasses).toContain("item.cancellation_reason");
    expect(studentClasses).toContain("Clase devuelta");
  });
});
