import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const dashboard = read("app/admin/page.tsx");
const layout = read("app/admin/layout.tsx");
const more = read("app/admin/mas/page.tsx");
const session = read("app/admin/agenda/[sessionId]/page.tsx");
const student = read("app/admin/alumnas/[studentId]/page.tsx");
const capabilities = read("lib/auth/capabilities.ts");
const catalog = read("lib/automations/catalog.ts");
const migration = read("supabase/migrations/20260920172001_sf254_remove_required_actions.sql");

describe("SF-254 required-actions removal", () => {
  it("removes Incidencias and Atención from the admin surface", () => {
    for (const source of [dashboard, layout, more, session, student]) {
      expect(source).not.toContain("/admin/acciones");
      expect(source).not.toContain("REQUIRED_ACTIONS");
      expect(source).not.toContain('from("required_actions")');
    }
    expect(dashboard).not.toContain("<span>Incidencias</span>");
    expect(dashboard).not.toContain("Atención <span>(pendientes)</span>");
  });

  it("removes required-action capabilities", () => {
    expect(capabilities).not.toContain("required_actions.read");
    expect(capabilities).not.toContain("required_actions.manage");
  });

  it("retires the incident automation templates without renumbering the rest", () => {
    expect(catalog).not.toContain("AUT-CAT-08");
    expect(catalog).not.toContain("AUT-CAT-09");
    expect(catalog).not.toContain("AUT-CAT-10");
    expect(catalog).toContain("AUT-CAT-11");
    expect(catalog).toContain("AUT-CAT-16");
    expect(catalog).not.toContain("required_action");
    expect(catalog).not.toContain("incident_deduped");
  });

  it("drops the Required Actions backend and capabilities", () => {
    expect(migration).toContain("drop table if exists public.required_action_audit");
    expect(migration).toContain("drop table if exists public.required_actions");
    expect(migration).toContain("drop type if exists public.required_action_status");
    expect(migration).toContain("drop type if exists public.required_action_priority");
    expect(migration).toContain("required_actions.read");
    expect(migration).toContain("required_actions.manage");
  });
});
