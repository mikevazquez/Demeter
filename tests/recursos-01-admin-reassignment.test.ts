import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("RECURSOS-01 admin resource reassignment", () => {
  const migration = source("supabase/migrations/20260922190500_recursos01_admin_reassignment.sql");
  const actions = source("app/admin/agenda/[sessionId]/recursos/actions.ts");
  const page = source("app/admin/agenda/[sessionId]/recursos/page.tsx");

  it("locks the active assignment and destination session resource", () => {
    expect(migration).toContain("admin_reassign_reservation_resource");
    expect(migration).toContain("where id = p_assignment_id");
    expect(migration).toContain("for update;");
    expect(migration).toContain("resource_id = p_target_resource_id");
    expect(migration).toContain("v_used >= v_capacity");
  });

  it("preserves history and creates one new active assignment atomically", () => {
    expect(migration).toContain("release_reason = 'admin_reassigned:'");
    expect(migration).toContain("insert into public.reservation_resource_assignments");
    expect(migration).toContain("'released_assignment_id'");
    expect(migration).toContain("'assignment_id'");
  });

  it("exposes reassignment through the admin session resource UI", () => {
    expect(actions).toContain('rpc("admin_reassign_reservation_resource"');
    expect(page).toContain("Asignaciones actuales");
    expect(page).toContain("reassignReservationResourceAction");
    expect(page).toContain('name="target_resource_id"');
    expect(page).toContain("Reasignar");
  });
});
