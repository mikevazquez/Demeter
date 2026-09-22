import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("ACTIVIDADES-01 restored module", () => {
  const listPage = readFileSync(join(process.cwd(), "app/admin/actividades/page.tsx"), "utf8");
  const newPage = readFileSync(join(process.cwd(), "app/admin/actividades/nueva/page.tsx"), "utf8");
  const wizard = readFileSync(
    join(process.cwd(), "app/admin/actividades/ActivityWizard.tsx"),
    "utf8",
  );
  const actions = readFileSync(join(process.cwd(), "app/admin/actividades/actions.ts"), "utf8");
  const layout = readFileSync(join(process.cwd(), "app/admin/layout.tsx"), "utf8");
  const more = readFileSync(join(process.cwd(), "app/admin/mas/page.tsx"), "utf8");
  const agenda = readFileSync(join(process.cwd(), "app/admin/agenda/page.tsx"), "utf8");
  const legacyAgendaConfig = readFileSync(
    join(process.cwd(), "app/admin/agenda/configuracion/page.tsx"),
    "utf8",
  );
  const styles = readFileSync(join(process.cwd(), "app/admin/actividades/actividades.css"), "utf8");

  it("restores Activities as its own admin module", () => {
    expect(layout).toContain('href: "/admin/actividades"');
    expect(more).toContain('title: "Actividades"');
    expect(listPage).toContain("<h1>Actividades</h1>");
    expect(agenda).toContain('href="/admin/actividades"');
    expect(agenda).not.toContain("Configurar agenda");
    expect(legacyAgendaConfig).toContain('redirect("/admin/actividades")');
  });

  it("restores the four approved creation stages", () => {
    expect(wizard).toContain('label: "Información general"');
    expect(wizard).toContain('label: "Horarios y operación"');
    expect(wizard).toContain('label: "Venta y acceso"');
    expect(wizard).toContain('label: "Confirmación"');
    expect(newPage).toContain('mode="create"');
  });

  it("keeps A01 free from a discipline selector", () => {
    expect(wizard).toContain("Nombre de la actividad");
    expect(wizard).toContain("Descripción");
    expect(wizard).toContain("Duración predeterminada");
    expect(wizard).toContain("Cupo predeterminado");
    expect(wizard).toContain("¿Requiere recurso?");
    expect(wizard).not.toContain("discipline_id");
    expect(actions).toContain("discipline_id: null");
  });

  it("keeps schedule rows compact and applies operation defaults to generated sessions", () => {
    expect(wizard).toContain("+ Agregar hora");
    expect(wizard).toContain("+ Agregar día");
    expect(wizard).toContain("<span>Hora</span>");
    expect(wizard).toContain("Coach predeterminado");
    expect(wizard).toContain("Espacio");
    expect(wizard).toContain("Comienza");
    expect(wizard).toContain("Termina");
    expect(wizard).not.toContain("<span>Inicio</span>");
    expect(wizard).not.toContain("<span>Fin</span>");
    expect(actions).toContain("instructor_id: defaultInstructorId");
    expect(actions).toContain("space_id: defaultSpaceId");
    expect(actions).toContain("duration_minutes: durationMinutes");
  });

  it("keeps credits fixed and individual purchase configurable", () => {
    expect(wizard).toContain("Todas las actividades utilizan créditos");
    expect(wizard).toContain("Permitir compra individual");
    expect(wizard).toContain("Precio de compra individual");
    expect(actions).toContain("credit_cost: 1");
    expect(actions).toContain("drop_in_price_minor");
  });

  it("restores A04 review with inline Edit links", () => {
    expect(wizard).toContain("Información general");
    expect(wizard).toContain("Horarios y operación");
    expect(wizard).toContain("Venta y acceso");
    expect(wizard).toContain("Editar");
    expect(wizard).toContain("Se creará como activa");
  });

  it("does not swallow successful redirects or show prohibited banners", () => {
    const detailPage = readFileSync(
      join(process.cwd(), "app/admin/actividades/[activityId]/page.tsx"),
      "utf8",
    );
    const newActivityPage = readFileSync(
      join(process.cwd(), "app/admin/actividades/nueva/page.tsx"),
      "utf8",
    );

    expect(actions).toContain("redirect(`/admin/actividades/${savedActivityId}`)");
    expect(actions).not.toContain("?saved=1");
    expect(listPage).not.toContain("notice success");
    expect(listPage).not.toContain("notice error");
    expect(detailPage).not.toContain("notice success");
    expect(detailPage).not.toContain("notice error");
    expect(newActivityPage).not.toContain("notice error");
    expect(wizard).toContain("activities-save-error");
  });

  it("uses the approved Studio Flow dark palette", () => {
    expect(styles).toContain("#071018");
    expect(styles).toContain("#0b1118");
    expect(styles).toContain("#fb0397");
    expect(styles).toContain("#46bce8");
  });
});
