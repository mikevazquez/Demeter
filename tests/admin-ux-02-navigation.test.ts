import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("ADMIN-UX-02 navigation architecture", () => {
  const layout = source("app/admin/layout.tsx");
  const navigation = source("app/admin/admin-navigation.tsx");
  const more = source("app/admin/mas/page.tsx");
  const company = source("app/admin/empresa/page.tsx");
  const automations = source("app/admin/automatizaciones/page.tsx");
  const styles = source("app/globals.css");
  const today = source("app/admin/page.tsx");
  const agenda = source("app/admin/agenda/page.tsx");
  const agendaConfiguration = source("app/admin/agenda/configuracion/page.tsx");
  const activitiesWizard = source("app/admin/actividades/ActivityWizard.tsx");

  it("uses durable entities as the desktop navigation architecture", () => {
    for (const label of ["Hoy", "Agenda", "Alumnas", "Productos", "Equipo", "Automatizaciones"]) {
      expect(layout).toContain('label: "' + label + '"');
    }
    expect(layout).not.toContain('label: "Atención"');
    expect(layout).toContain('label: "Configuración"');
    expect(layout).not.toContain('label: "Empresa"');
    expect(layout).not.toContain('label: "Ventas"');
  });

  it("keeps mobile navigation focused on Hoy, Agenda, Alumnas and Más", () => {
    expect(layout).toContain('href: "/admin/mas"');
    expect(layout).toContain('label: "Más"');
    expect(layout).toContain('"/admin/productos"');
    expect(layout).toContain('"/admin/instructores"');
    expect(layout).toContain('"/admin/automatizaciones"');
    expect(layout).not.toContain('"/admin/acciones"');
    expect(navigation).toContain("activeFor");
    expect(styles).toContain("grid-auto-flow: column");
  });

  it("uses Más only for secondary durable destinations", () => {
    expect(more).toContain('title: "Productos"');
    expect(more).toContain('title: "Equipo"');
    expect(more).toContain('title: "Automatizaciones"');
    expect(more).not.toContain('title: "Atención"');
    expect(more).not.toContain('title: "Ventas"');
    expect(more).not.toContain('title: "Empresa"');
    expect(more).not.toContain('title: "Reportes"');
    expect(more).toContain('title: "Configuración"');
    expect(more).toContain("ownerOnly: true");
  });

  it("keeps the old Empresa route only as a compatibility redirect", () => {
    expect(company).toContain('redirect("/admin/mas")');
    expect(company).not.toContain("Ventas y pagos");
    expect(company).not.toContain("Agenda y actividades");
  });

  it("removes internal automation codes from the top-level user interface", () => {
    expect(automations).not.toContain("Control AUT-05");
    expect(automations).not.toContain("SF-166");
    expect(automations).not.toContain("{template.code} ·");
    expect(automations).toContain("Comunicaciones");
  });

  it("keeps operational actions contextual instead of turning them into modules", () => {
    expect(today).toContain("<TodayClasses");
    expect(today).not.toContain(">Registrar venta<");
    expect(today).not.toContain(">Crear reserva<");
    expect(today).not.toContain(">Crear clase<");
    expect(agenda).toContain('id="clases-programadas"');
    expect(agendaConfiguration).toContain('redirect("/admin/actividades")');
    expect(activitiesWizard).toContain("Horarios y operación");
    expect(activitiesWizard).toContain("+ Agregar horario");
    expect(layout).not.toContain('label: "Ventas"');
  });

  it("preserves capability-driven navigation and instructor-only Studio access", () => {
    expect(layout).toContain("CAPABILITIES.PRODUCTS_READ");
    expect(layout).toContain("CAPABILITIES.INSTRUCTORS_READ");
    expect(layout).toContain("CAPABILITIES.AUTOMATIONS_READ");
    expect(layout).not.toContain("CAPABILITIES.REQUIRED_ACTIONS_READ");
    expect(layout).toContain('label: "Mis clases"');
  });
});
