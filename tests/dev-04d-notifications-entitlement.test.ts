import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("DEV-04D notifications entitlement", () => {
  const migration = source(
    "supabase/migrations/20260926171142_dev_04d_notifications_entitlement.sql",
  );
  const capabilities = source("lib/auth/capabilities.ts");
  const automationsPage = source("app/admin/automatizaciones/page.tsx");
  const automationsActions = source("app/admin/automatizaciones/actions.ts");
  const studentLayout = source("app/student/layout.tsx");
  const studentNotifications = source("app/student/notificaciones/page.tsx");
  const onboarding = source("app/student/recompensas/OnboardingActivation.tsx");

  it("maps notification capabilities to the notifications module", () => {
    expect(capabilities).toContain('NOTIFICATIONS_READ: "notifications.read"');
    expect(capabilities).toContain('NOTIFICATIONS_MANAGE: "notifications.manage"');
    expect(migration).toContain("('notifications.read','notifications')");
    expect(migration).toContain("('notifications.manage','notifications')");
  });

  it("stops new and pending deliveries when notifications are disabled", () => {
    expect(migration).toContain("private.studio_has_module(p_studio_id, 'notifications')");
    expect(migration).toContain("private.studio_has_module(j.studio_id, 'notifications')");
    expect(migration).toContain("private.studio_has_module(d.studio_id, 'notifications')");
    expect(migration).toContain("return false;");
  });

  it("gates Push and notification surfaces while keeping Rewards onboarding completable", () => {
    expect(migration).toContain("notifications_module_disabled");
    expect(migration).toContain("private.reward_onboarding_try_unlock");
    expect(migration).toContain("and v_onboarding.notifications_enabled_at is null");
    expect(studentLayout).toContain("hasModule(STUDIO_MODULES.NOTIFICATIONS)");
    expect(studentNotifications).toContain(
      "if (!hasModule(STUDIO_MODULES.NOTIFICATIONS)) notFound()",
    );
    expect(onboarding).toContain("notificationsEnabled");
    expect(onboarding).toContain("const totalSteps = steps.length");
  });

  it("separates notification settings from automation CRUD permissions", () => {
    expect(automationsPage).toContain("CAPABILITIES.NOTIFICATIONS_READ");
    expect(automationsPage).toContain("CAPABILITIES.NOTIFICATIONS_MANAGE");
    expect(automationsActions).toContain("CAPABILITIES.NOTIFICATIONS_MANAGE");
  });
});
