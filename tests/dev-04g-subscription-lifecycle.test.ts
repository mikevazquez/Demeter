import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("DEV-04G subscription lifecycle", () => {
  const migration = source(
    "supabase/migrations/20260926201951_dev_04g_subscription_lifecycle.sql",
  );
  const adminContext = source("lib/auth/admin-context.ts");
  const studentPortal = source("lib/student/portal.ts");
  const adminLayout = source("app/admin/layout.tsx");
  const subscriptionPage = source("app/admin/suscripcion/page.tsx");
  const platformActions = source("app/setup/planes/actions.ts");
  const platformPage = source("app/setup/planes/page.tsx");

  it("defines trial, grace and restricted access semantics", () => {
    expect(migration).toContain("when spa.status='active' then 'full'");
    expect(migration).toContain("when spa.status='trialing'");
    expect(migration).toContain("when spa.status='past_due'");
    expect(migration).toContain("spa.grace_ends_at > now()");
    expect(migration).toContain("else 'restricted'");
    expect(migration).toContain("then 'trial_expired'");
    expect(migration).toContain("then 'past_due_grace'");
    expect(migration).toContain("then 'past_due_expired'");
  });

  it("removes modules and operational capabilities when access is restricted", () => {
    expect(migration).toContain(
      "private.studio_subscription_access_mode(p_studio_id)='full'",
    );
    expect(migration).toContain("m.role='owner'");
    expect(migration).toContain("p_capability='admin.portal'");
    expect(migration).toContain("rc.capability_key='admin.portal'");
  });

  it("keeps the owner on a subscription recovery surface", () => {
    expect(adminContext).toContain('allowRestricted?: boolean');
    expect(adminContext).toContain('redirect("/admin/suscripcion")');
    expect(adminLayout).toContain('href: "/admin/suscripcion"');
    expect(subscriptionPage).toContain("Plan y suscripción");
    expect(subscriptionPage).toContain("La operación está pausada");
  });

  it("blocks the student portal when the studio subscription is restricted", () => {
    expect(studentPortal).toContain('"current_studio_subscription"');
    expect(studentPortal).toContain('subscription.access_mode !== "full"');
    expect(studentPortal).toContain(
      'redirect("/login/student?error=studio_unavailable")',
    );
  });

  it("lets platform admins manage subscription lifecycle without hardcoded grace days", () => {
    expect(platformActions).toContain("changeStudioSubscriptionAction");
    expect(platformActions).toContain('"trialing"');
    expect(platformActions).toContain('"past_due"');
    expect(platformActions).toContain('"suspended"');
    expect(platformActions).toContain('"cancelled"');
    expect(platformActions).toContain("grace_ends_at");
    expect(platformActions).toContain("cancel_at_period_end");
    expect(platformPage).toContain("Guardar estado");
    expect(platformPage).toContain("Fin de gracia · UTC");
    expect(migration).not.toMatch(/interval\s+'\d+\s+day/i);
  });

  it("audits subscription changes separately from plan changes", () => {
    expect(migration).toContain("studio_subscription_events");
    expect(migration).toContain("log_studio_subscription_event");
    expect(migration).toContain("billing_reason");
    expect(migration).toContain("effective_access");
  });
});
