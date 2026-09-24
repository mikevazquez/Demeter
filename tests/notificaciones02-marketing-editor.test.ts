import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("NOTIFICACIONES-02 marketing editor", () => {
  const list = source("app/admin/notificaciones/page.tsx");
  const detail = source("app/admin/notificaciones/marketing/[marketingKey]/page.tsx");
  const actions = source("app/admin/notificaciones/actions.ts");
  const catalog = source("lib/notifications/admin-catalog.ts");
  const migration = source(
    "supabase/migrations/20260924144500_notificaciones02_marketing_editor.sql",
  );

  it("makes every marketing card navigable to an editor", () => {
    expect(list).toContain("/admin/notificaciones/marketing/");
    expect(detail).toContain("Audiencia");
    expect(detail).toContain("Canales");
    expect(detail).toContain("Mensaje");
    expect(detail).toContain("Horario");
    expect(detail).toContain("Guardar cambios");
  });

  it("persists business-facing marketing drafts behind capability checks", () => {
    expect(migration).toContain("notification_marketing_configs");
    expect(migration).toContain("private.has_capability(p_studio_id, 'automations.manage')");
    expect(migration).toContain("admin_save_notification_marketing_config");
    expect(actions).toContain("admin_save_notification_marketing_config");
  });

  it("keeps unconnected marketing inert while allowing draft editing", () => {
    expect(detail).toContain("permanece en");
    expect(detail).toContain("no enviará mensajes accidentalmente");
    expect(actions).toContain('p_status: "draft"');
  });

  it("exposes live automation settings in the simple marketing detail", () => {
    expect(detail).toContain("Automatización conectada");
    expect(detail).toContain("saveMarketingAutomationConfigurationAction");
    expect(detail).toContain("transitionMarketingAutomationAction");
    expect(actions).toContain("admin_update_automation_instance_configuration");
    expect(actions).toContain("admin_activate_automation_instance");
    expect(actions).toContain("admin_pause_automation_instance");
  });

  it("keeps technical priority labels out of the marketing editor", () => {
    expect(detail).not.toContain("P0");
    expect(detail).not.toContain("P1");
    expect(detail).not.toContain("P2");
    expect(detail).not.toContain("P3");
  });

  it("defines editable defaults for every marketing communication", () => {
    for (const key of [
      "inactive-students",
      "package-renewal",
      "special-promotions",
      "birthday",
      "challenges",
      "events",
      "referrals",
      "manual-campaigns",
    ]) {
      expect(catalog).toContain(`key: "${key}"`);
    }
    expect(catalog.match(/defaultTitle:/g)?.length).toBe(8);
    expect(catalog.match(/defaultBody:/g)?.length).toBe(8);
  });
});
