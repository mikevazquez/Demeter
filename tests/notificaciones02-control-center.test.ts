import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("NOTIFICACIONES-02 control center", () => {
  const page = source("app/admin/notificaciones/page.tsx");
  const detail = source("app/admin/notificaciones/[processKey]/page.tsx");
  const actions = source("app/admin/notificaciones/actions.ts");
  const catalog = source("lib/notifications/admin-catalog.ts");
  const migration = source(
    "supabase/migrations/20260924143000_notificaciones02_control_center.sql",
  );
  const layout = source("app/admin/layout.tsx");

  it("exposes the approved four-tab business UI and hides technical priority classes", () => {
    for (const label of ["Procesos", "Marketing", "Plantillas", "Preferencias"]) {
      expect(page).toContain(`label: "${label}"`);
    }

    expect(page).not.toContain("P0");
    expect(page).not.toContain("P1");
    expect(page).not.toContain("P2");
    expect(detail).not.toContain("communication_class");
    expect(layout).toContain('href: "/admin/notificaciones"');
    expect(layout).toContain('label: "Notificaciones"');
  });

  it("maps live business processes to the current central engine rules", () => {
    for (const key of [
      "p0.booking.confirmed",
      "p0.booking.cancelled_by_student",
      "p0.booking.modified",
      "p0.session.cancelled_by_studio",
      "p0.session.rescheduled_notice",
      "p0.booking.class_reminder_5h",
      "p0.session.rescheduled_reminder_5h",
      "p0.session.minimum_cancelled_students",
      "p0.session.minimum_cancelled_coach",
      "p0.booking.waitlist_promoted",
      "p0.evaluation.invitation",
      "p0.evaluation.scheduled",
      "p0.evaluation.completed",
    ]) {
      expect(catalog).toContain(key);
    }
  });

  it("uses versioned rule mutations instead of rewriting historical notification versions", () => {
    expect(migration).toContain("private.clone_notification_rule_version");
    expect(migration).toContain("v_next := v_rule.current_version_number + 1");
    expect(migration).toContain("insert into public.notification_rule_versions");
    expect(migration).toContain("insert into public.notification_rule_channels");
    expect(migration).toContain("current_version_number = v_next");
    expect(migration).not.toContain("delete from public.notification_rule_versions");
  });

  it("keeps internal inbox non-disableable and applies global channel preferences at lookup", () => {
    expect(migration).toContain("p_channel_key not in ('push','whatsapp','email')");
    expect(migration).toContain("c.channel_key = 'inbox'");
    expect(migration).toContain("coalesce(settings.push_enabled, true)");
    expect(migration).toContain("coalesce(settings.whatsapp_enabled, true)");
    expect(migration).toContain("coalesce(settings.email_enabled, false)");
  });

  it("keeps WhatsApp provider-managed and does not pretend email delivery exists", () => {
    expect(actions).toContain('channel === "whatsapp"');
    expect(actions).toContain("notification_whatsapp_provider_managed");
    expect(detail).toContain("Plantilla administrada en Assistian");
    expect(detail).toContain("Proveedor no configurado");
  });

  it("connects process, channel, message, timing and preference mutations through admin RPCs", () => {
    for (const rpc of [
      "admin_set_notification_rules_enabled",
      "admin_set_notification_rules_channel",
      "admin_update_notification_rules_message",
      "admin_update_notification_rules_lead_time",
      "admin_save_notification_settings",
    ]) {
      expect(actions).toContain(rpc);
      expect(migration).toContain(rpc);
    }
  });

  it("keeps marketing drafts inert until their central-engine triggers exist", () => {
    expect(page).toContain("no se enviará nada por accidente");
    expect(catalog).toContain("planned: true");
  });
});
