import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("SF-166 automation admin UI", () => {
  it("exposes Automations as a durable module and in mobile Más", () => {
    const more = source("app/admin/mas/page.tsx");
    const layout = source("app/admin/layout.tsx");

    expect(more).toContain('title: "Automatizaciones"');
    expect(more).toContain('href: "/admin/automatizaciones"');
    expect(more).toContain("CAPABILITIES.AUTOMATIONS_READ");
    expect(layout).toContain('href: "/admin/automatizaciones"');
    expect(layout).toContain('label: "Automatizaciones"');
  });

  it("renders the approved catalog and execution audit surfaces", () => {
    const list = source("app/admin/automatizaciones/page.tsx");
    const detail = source("app/admin/automatizaciones/[code]/page.tsx");

    expect(list).toContain("AUTOMATION_CATALOG");
    expect(list).toContain("automation_instances");
    expect(list).toContain("automation_executions");

    expect(detail).toContain("Historial de ejecuciones");
    expect(detail).toContain("automation_execution_attempts");
    expect(detail).toContain("automation_execution_events");
    expect(detail).toContain("data_snapshot");
    expect(detail).toContain("template_snapshot");
    expect(detail).toContain("variables_snapshot");
  });

  it("uses the approved contextual NoticeDialog instead of top-of-page feedback banners", () => {
    const detail = source("app/admin/automatizaciones/[code]/page.tsx");
    const list = source("app/admin/automatizaciones/page.tsx");
    const notice = source("app/admin/automatizaciones/AutomationNotice.tsx");

    expect(detail).toContain("AutomationNotice");
    expect(list).toContain("AutomationNotice");
    expect(notice).toContain("NoticeDialog");
    expect(notice).toContain('title="Cambio guardado correctamente"');
    expect(notice).toContain("window.history.replaceState");
    expect(notice).toContain('tone="error"');
  });

  it("uses protected admin RPCs for instance lifecycle and configuration", () => {
    const actions = source("app/admin/automatizaciones/actions.ts");

    expect(actions).toContain("CAPABILITIES.AUTOMATIONS_MANAGE");
    expect(actions).toContain("admin_create_automation_instance");
    expect(actions).toContain("admin_update_automation_instance_configuration");
    expect(actions).toContain("admin_activate_automation_instance");
    expect(actions).toContain("admin_pause_automation_instance");
    expect(actions).toContain("admin_archive_automation_instance");
    expect(actions).toContain("admin_delete_automation_draft");
  });
});
