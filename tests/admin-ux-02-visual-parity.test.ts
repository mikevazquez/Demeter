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
  const more = source("app/admin/mas/page.tsx");
  const attention = source("app/admin/acciones/page.tsx");
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
    expect(layout).toContain("attentionCount");
    expect(styles).toContain("grid-template-columns: 208px minmax(0, 1fr)");
  });

  it("renders the approved Hoy overview before detailed operations", () => {
    expect(today).toContain("Hola, {firstName}");
    expect(today).toContain("mock-kpi-grid");
    expect(today).toContain("Ventas hoy");
    expect(today).toContain("Incidencias");
    expect(today).toContain("mock-overview-grid");
    expect(today).toContain("Clases de hoy");
    expect(today).toContain("Atención");
    expect(today).toContain("admin-quick-menu");
    expect(today).not.toContain("Operación detallada");
    expect(today).not.toContain("week-picker");
    expect(today).not.toContain("hoy-primary-grid");
    expect(today).not.toContain("hoy-schedule-panel");
    expect(today).toContain("mock-week-calendar");
    expect(today).toContain("mock-week-nav");
    expect(today).toContain("Semana anterior");
    expect(today).toContain("Semana siguiente");
    expect(today).toContain("selectedDayLabel");
    expect(today).not.toContain("Ver agenda →");
  });

  it("matches the approved mobile architecture", () => {
    expect(styles).toContain("height: calc(58px + env(safe-area-inset-bottom))");
    expect(styles).toContain("border-radius: 0");
    expect(layout).toContain('label: "Más"');
    expect(more).toContain("more-list");
    expect(more).toContain("more-row");
  });

  it("uses the approved compact module language", () => {
    expect(attention).toContain("attention-page");
    expect(attention).toContain("attention-list");
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
