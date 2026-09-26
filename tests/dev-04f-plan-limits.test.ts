import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("DEV-04F plan limits", () => {
  const migration = source(
    "supabase/migrations/20260926180439_dev_04f_plan_limits.sql",
  );
  const configuration = source("app/admin/configuracion/page.tsx");
  const platformPlans = source("app/setup/planes/page.tsx");
  const studentActions = source("app/admin/alumnas/actions.ts");
  const studentsPage = source("app/admin/alumnas/page.tsx");

  it("locks the agreed commercial quotas into the catalog", () => {
    expect(migration).toContain("('core','active_students',100::bigint");
    expect(migration).toContain("('core','sites',1::bigint");
    expect(migration).toContain("('core','admin_users',3::bigint");
    expect(migration).toContain("('growth','active_students',250::bigint");
    expect(migration).toContain("('growth','sites',1::bigint");
    expect(migration).toContain("('growth','admin_users',8::bigint");
    expect(migration).toContain(
      "('pro','active_students',null::bigint,'Ilimitadas · sujeto a uso razonable')",
    );
    expect(migration).toContain("('pro','sites',2::bigint");
    expect(migration).toContain("('pro','admin_users',null::bigint,'Ilimitados')");
    expect(migration).toContain("('core','instructors',null::bigint,'Ilimitados')");
  });

  it("enforces quotas at the database boundary", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("raise exception 'plan_limit_exceeded'");
    expect(migration).toContain("students_plan_limit_trg");
    expect(migration).toContain("sites_plan_limit_trg");
    expect(migration).toContain("studio_memberships_plan_limit_trg");
  });

  it("uses admin.portal semantics for administrative seats", () => {
    expect(migration).toContain("rc.capability_key='admin.portal'");
    expect(migration).toContain("'admin_users'");
  });

  it("keeps usage visible in studio and platform administration", () => {
    expect(configuration).toContain("PLAN Y USO");
    expect(configuration).toContain('rpc("current_studio_plan_usage"');
    expect(platformPlans).toContain('rpc("current_studio_plan_usage"');
    expect(platformPlans).toContain("Sobre cuota");
  });

  it("makes the active-student limit actionable", () => {
    expect(studentActions).toContain("plan_limit_active_students");
    expect(studentsPage).toContain("Límite de alumnas alcanzado");
    expect(studentsPage).toContain('href="/admin/configuracion"');
  });

  it("exposes aggregate usage through an invoker-safe RPC", () => {
    expect(migration).toContain(
      "create or replace function public.current_studio_plan_usage",
    );
    expect(migration).toContain("security invoker");
    expect(migration).toContain("from public,anon");
  });
});
