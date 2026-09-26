import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("DEV-04A plan and module entitlements", () => {
  const migration = source(
    "supabase/migrations/20260926115412_dev_04a_plan_module_entitlements.sql",
  );
  const adminContext = source("lib/auth/admin-context.ts");
  const modules = source("lib/auth/modules.ts");

  it("models plan, module, tenant assignment, and tenant override separately", () => {
    expect(migration).toContain("create table if not exists public.saas_modules");
    expect(migration).toContain("create table if not exists public.saas_plans");
    expect(migration).toContain("create table if not exists public.saas_plan_modules");
    expect(migration).toContain("create table if not exists public.studio_plan_assignments");
    expect(migration).toContain("create table if not exists public.studio_module_overrides");
  });

  it("keeps existing and newly provisioned studios on all-access during transition", () => {
    expect(migration).toContain("'all_access'");
    expect(migration).toContain("on conflict(studio_id) do nothing");
    expect(migration).toContain("v_all_access_plan_id");
    expect(migration).toContain("default_saas_plan_missing");
  });

  it("combines role authorization with module entitlements in the backend", () => {
    expect(migration).toContain("private.studio_has_module");
    expect(migration).toContain("public.saas_module_capabilities");
    expect(migration).toContain("private.has_capability");
    expect(migration).toContain("private.studio_has_module(p_studio_id,mc.module_key)");
  });

  it("returns effective capabilities and modules to the admin shell", () => {
    expect(migration).toContain("public.current_studio_capabilities");
    expect(migration).toContain("public.current_studio_modules");
    expect(adminContext).toContain('supabase.rpc("current_studio_capabilities"');
    expect(adminContext).toContain('supabase.rpc("current_studio_modules"');
    expect(adminContext).not.toContain('from("role_capabilities")');
    expect(adminContext).toContain("hasModule(module: StudioModule)");
  });

  it("defines the first canonical module catalog without commercial plan names", () => {
    for (const key of [
      "CORE",
      "WAITLIST",
      "RESOURCES",
      "DOCUMENTS",
      "EVALUATIONS",
      "REWARDS",
      "AUTOMATIONS",
      "INTELLIGENCE",
      "NOTIFICATIONS",
      "INTEGRATIONS",
    ]) {
      expect(modules).toContain(key);
    }
  });
});
