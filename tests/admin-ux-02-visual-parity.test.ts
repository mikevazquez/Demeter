import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("ADMIN-UX-02 approved visual parity", () => {
  const layout = source("app/admin/layout.tsx");
  const navigation = source("app/admin/admin-navigation.tsx");
  const today = source("app/admin/page.tsx");
  const classDetail = source("app/admin/agenda/[sessionId]/page.tsx");
  const classOperations = source("app/admin/hoy/SessionOperations.tsx");
  const todayClasses = source("app/admin/hoy/TodayClasses.tsx");
  const hoyStyles = source("app/admin/hoy.css");
  const rosterStyles = source("app/admin/roster-uat.css");
  const more = source("app/admin/mas/page.tsx");
  const products = source("app/admin/productos/page.tsx");
  const team = source("app/admin/instructores/page.tsx");
  const automations = source("app/admin/automatizaciones/page.tsx");
  const sale = source("app/admin/ventas/nueva/page.tsx");
  const saleForm = source("app/admin/alumnas/[studentId]/alta/StudentOnboardingForm.tsx");
  const styles = source("app/globals.css");

  it("uses the approved shell with icon navigation, user footer and utility bar", () => {
    expect(navigation).toContain("NavIcon");
    expect(navigation).toContain("nav-icon");
    expect(navigation).toContain("mobile-nav-icon");
    expect(layout).toContain("admin-utility-bar");
    expect(layout).toContain("admin-mobile-header");
    expect(layout).toContain("sidebar-user");
    expect(layout).not.toContain("attentionCount");
    expect(styles).toContain("grid-template-columns: 208px minmax(0, 1fr)");
  });

  it("renders the approved Hoy mockup hierarchy", () => {
    expect(today).toContain("Clases de hoy");
    expect(today).toContain("Administra, conecta, haz fluir.");
    expect(today).toContain("hoy-week-card");
    expect(today).toContain("hoy-kpi-grid");
    expect(today).toContain("Ventas hoy");
    expect(today).toContain("Reservas del día");
    expect(today).toContain("<TodayClasses");
    expect(today).not.toContain("admin-quick-menu");
    expect(today).not.toContain("mock-overview-grid");
    expect(today).not.toContain("hoy-schedule-panel");
    expect(hoyStyles).toContain("border-radius: 20px");
    expect(hoyStyles).toContain("today-class-card");
    expect(hoyStyles).toContain("--class-accent");
  });

  it("keeps selected-day KPIs synchronized with the selected calendar date", () => {
    expect(today).toContain("<strong>{selectedSessions?.length ?? 0}</strong>");
    expect(today).not.toContain("todaySessions?.length");
    expect(today).toContain("totalDailyCapacity");
    expect(today).toContain("totalDailyReservations");
    expect(today).toContain("dailyReservationPercentage");
    expect(today).toContain("Math.round((totalDailyReservations / totalDailyCapacity) * 100)");
  });

  it("always moves week arrows to Monday of the target week", () => {
    expect(today).toContain("const weekStart = weekStartMonday(selectedDate)");
    expect(today).toContain("shiftUtcDays(weekStart, -7)");
    expect(today).toContain("shiftUtcDays(weekStart, 7)");
    expect(today).toContain("Array.from({ length: 7 }");
  });

  it("expands only one class inline and keeps attendance as the primary action", () => {
    expect(todayClasses).toContain("openSessionId");
    expect(todayClasses).toContain("setOpenSessionId");
    expect(todayClasses).toContain("<SessionOperations");
    expect(todayClasses).toContain("showToggle={false}");
    expect(classOperations).toContain("Asistió");
    expect(classOperations).toContain("No asistió");
    expect(classOperations).not.toContain(">No show<");
    expect(classOperations).toContain("today-add-student-button");
    expect(classOperations).toContain("el cierre de asistencia es automático");
    expect(classOperations).not.toContain("Finalizar asistencia");
    expect(rosterStyles).toContain("today-student-card.compact");
    expect(rosterStyles).toContain("today-student-more");
  });

  it("keeps the dedicated class detail operational for agenda entry points", () => {
    expect(classDetail).toContain("OPERACIÓN DE CLASE");
    expect(classDetail).toContain("<SessionOperations");
    expect(classDetail).toContain("initiallyOpen");
    expect(classDetail).toContain("showToggle={false}");
    expect(classOperations).toContain("returnTo");
  });

  it("matches the approved mobile architecture", () => {
    expect(styles).toContain("height: calc(58px + env(safe-area-inset-bottom))");
    expect(styles).toContain("border-radius: 0");
    expect(layout).toContain('label: "Más"');
    expect(more).toContain("more-list");
    expect(more).toContain("more-row");
  });

  it("uses the approved compact module language", () => {
    expect(products).toContain("module-list");
    expect(products).toContain("module-tabs");
    expect(team).toContain(">Equipo<");
    expect(team).toContain("team-list-row");
    expect(automations).toContain("automation-list");
    expect(sale).toContain("StudentOnboardingForm");
    expect(sale).toContain('flowContext="sale"');
    expect(saleForm).toContain("Descuento o cortesía");
    expect(saleForm).toContain("Registrar lo que ocurrió");
    expect(saleForm).toContain("Saldo pendiente");
  });

  it("keeps the configured studio identity rather than hardcoded Studio Flow branding", () => {
    expect(layout).toContain("{studio.name}");
    expect(layout).not.toContain("<strong>Studio Flow</strong>");
    expect(automations).not.toContain("Studio Flow");
  });
});
