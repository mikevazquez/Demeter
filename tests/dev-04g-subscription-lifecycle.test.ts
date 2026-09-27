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
  const hardening = source(
    "supabase/migrations/20260927010931_dev_04g_subscription_lifecycle_hardening.sql",
  );
  const recoveryUsage = source(
    "supabase/migrations/20260927011454_dev_04g_plan_usage_recovery_visibility.sql",
  );
  const trialMetadata = source(
    "supabase/migrations/20260927011933_dev_04g_trial_start_metadata.sql",
  );
  const adminContext = source("lib/auth/admin-context.ts");
  const studentPortal = source("lib/student/portal.ts");
  const loginCard = source("app/login/login-card.tsx");
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
    expect(subscriptionPage).toContain("Próximo cobro");
    expect(subscriptionPage).toContain("cancelled_period_end");
  });

  it("blocks the student portal when the studio subscription is restricted", () => {
    expect(studentPortal).toContain('"current_studio_subscription"');
    expect(studentPortal).toContain('subscription.access_mode !== "full"');
    expect(studentPortal).toContain("studio_unavailable");
    expect(studentPortal).toContain("encodeURIComponent(restrictedStudio.slug)");
    expect(loginCard).toContain("El portal del estudio está temporalmente pausado");
  });

  it("lets platform admins manage subscription lifecycle without hardcoded grace days", () => {
    expect(platformActions).toContain("changeStudioSubscriptionAction");
    expect(platformActions).toContain('"trialing"');
    expect(platformActions).toContain('"past_due"');
    expect(platformActions).toContain('"suspended"');
    expect(platformActions).toContain('"cancelled"');
    expect(platformActions).toContain("grace_ends_at");
    expect(platformActions).toContain("cancel_at_period_end");
    expect(platformActions).toContain("trial_end_required");
    expect(platformActions).toContain("trial_started_at");
    expect(platformActions).toContain("invalid_trial_window");
    expect(platformActions).toContain('currentAssignment?.status ?? "active"');
    expect(platformActions).toContain("next_billing_at");
    expect(platformActions).toContain("provider_customer_id");
    expect(platformActions).toContain("provider_subscription_id");
    expect(platformPage).toContain("Guardar estado");
    expect(platformPage).toContain("Inicio de trial · UTC");
    expect(platformPage).toContain("Fin de gracia · UTC");
    expect(platformPage).toContain("Próximo cobro · UTC");
    expect(platformPage).toContain("HISTORIAL DE SUSCRIPCIÓN");
    expect(migration).not.toMatch(/interval\s+'\d+\s+day/i);
  });

  it("audits subscription changes separately from plan changes", () => {
    expect(migration).toContain("studio_subscription_events");
    expect(migration).toContain("log_studio_subscription_event");
    expect(migration).toContain("billing_reason");
    expect(migration).toContain("effective_access");
    expect(hardening).toContain("next_billing_at");
    expect(hardening).toContain("provider_customer_id");
    expect(hardening).toContain("provider_subscription_id");
  });

  it("requires finite trials and enforces period-end cancellation", () => {
    expect(hardening).toContain("studio_plan_assignments_trial_requires_end");
    expect(hardening).toContain("status <> 'trialing' or trial_ends_at is not null");
    expect(hardening).toContain("studio_plan_assignments_cancel_period_requires_end");
    expect(hardening).toContain("then 'cancelled_period_end'");
    expect(hardening).toContain("spa.current_period_end <= now()");
  });

  it("tracks an explicit configurable trial window", () => {
    expect(trialMetadata).toContain("trial_started_at");
    expect(trialMetadata).toContain("studio_plan_assignments_trial_window");
    expect(trialMetadata).toContain("trial_ends_at > trial_started_at");
    expect(trialMetadata).toContain("'trial_started_at',new.trial_started_at");
    expect(subscriptionPage).toContain("Trial inicia");
  });

  it("keeps quota usage observable while operational access is restricted", () => {
    expect(recoveryUsage).toContain("current_studio_plan_usage");
    expect(recoveryUsage).not.toContain("spa.status in ('active','trialing')");
    expect(recoveryUsage).toContain("where spa.studio_id=p_studio_id");
  });

  it("blocks service-role automation work when subscription access is restricted", () => {
    expect(hardening).toContain("enforce_automation_entitlement_on_insert");
    expect(hardening).toContain("automation_instances_entitlement_insert_trg");
    expect(hardening).toContain("automation_eligibility_entitlement_insert_trg");
    expect(hardening).toContain("automation_executions_entitlement_insert_trg");
    expect(hardening).toContain("automation_attempts_entitlement_insert_trg");
    expect(hardening).toContain("automations_entitlement_disabled");
  });
});
