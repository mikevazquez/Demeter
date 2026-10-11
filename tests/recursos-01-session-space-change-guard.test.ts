import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("RECURSOS-01 session space change guard", () => {
  const actions = source("app/admin/agenda/[sessionId]/actions.ts");
  const page = source("app/admin/agenda/[sessionId]/page.tsx");

  it("blocks changing space while active resource assignments exist", () => {
    expect(actions).toContain('rpc("admin_update_session"');
    const migration = source(
      "supabase/migrations/20261011072140_admin_portal_session_operations.sql",
    );
    expect(migration).toContain("reservation_resource_assignments");
    expect(migration).toContain("released_at is null");
    expect(migration).toContain("resource_space_assigned");
  });

  it("shows a clear admin error instead of a generic edit failure", () => {
    expect(page).toContain("resource_space_assigned");
    expect(page).toContain(
      "No puedes cambiar el espacio mientras existan reservas con recursos asignados.",
    );
  });
});
