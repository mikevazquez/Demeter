import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("DEV-04E commercial plans", () => {
  const migration = source(
    "supabase/migrations/20260926174531_dev_04e_commercial_plans.sql",
  );
  const setupPage = source("app/setup/page.tsx");
  const setupForm = source("app/setup/ProvisionStudioForm.tsx");
  const setupActions = source("app/setup/actions.ts");
  const planActions = source("app/setup/planes/actions.ts");
  const planPage = source("app/setup/planes/page.tsx");
  const provision = source("supabase/functions/provision-studio/index.ts");

  it("defines Core, Growth and Pro while keeping All Access internal", () => {
    expect(migration).toContain("'core'");
    expect(migration).toContain("'growth'");
    expect(migration).toContain("'pro'");
    expect(migration).toContain("where plan_key='all_access'");
    expect(migration).toContain("internal_only=true");
  });

  it("maps plans to progressively larger module sets", () => {
    expect(migration).toContain(
      "p.plan_key='core' and m.module_key in (\n    'core','documents','notifications'",
    );
    expect(migration).toContain(
      "p.plan_key='growth' and m.module_key in (\n    'core','documents','notifications','waitlist','resources'",
    );
    expect(migration).toContain(
      "p.plan_key='pro' and m.module_key in (\n    'core','documents','notifications','waitlist','resources'",
    );
    expect(migration).toContain("'evaluations','rewards'");
  });

  it("requires an explicit commercial plan when creating a studio from platform UI", () => {
    expect(setupPage).toContain('eq("internal_only", false)');
    expect(setupForm).toContain('select name="plan_key" required');
    expect(setupActions).toContain('const planKey = field(formData, "plan_key")');
    expect(setupActions).toContain("planKey,");
  });

  it("provisions atomically with the selected plan", () => {
    expect(provision).toContain('"service_provision_studio_v3"');
    expect(provision).toContain("p_plan_key: planKey");
    expect(migration).toContain("create or replace function public.service_provision_studio_v3");
    expect(migration).toContain("'assignment_source','platform_provisioning'");
  });

  it("supports audited platform plan changes", () => {
    expect(migration).toContain("studio_plan_assignment_events");
    expect(migration).toContain("log_studio_plan_assignment_event");
    expect(planPage).toContain("Planes por estudio");
    expect(planActions).toContain("platform_admin_manual");
    expect(planActions).toContain("change_reason");
  });
});
