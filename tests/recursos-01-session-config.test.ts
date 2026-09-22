import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("RECURSOS-01 per-session configuration", () => {
  const page = readFileSync(
    join(process.cwd(), "app/admin/agenda/[sessionId]/recursos/page.tsx"),
    "utf8",
  );
  const action = readFileSync(
    join(process.cwd(), "app/admin/agenda/[sessionId]/recursos/actions.ts"),
    "utf8",
  );
  const sessionDetail = readFileSync(
    join(process.cwd(), "app/admin/agenda/[sessionId]/page.tsx"),
    "utf8",
  );
  const rpc = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260922071000_recursos01_session_configuration_rpc.sql",
    ),
    "utf8",
  );

  it("exposes resources only as session-level configuration", () => {
    expect(sessionDetail).toContain("Recursos de esta sesión");
    expect(sessionDetail).toContain("/recursos");
    expect(sessionDetail).toContain("Horario y operación");
    expect(page).toContain("El mapa global");
    expect(page).toContain("no se modifica");
  });

  it("supports a default number of uses plus per-resource overrides", () => {
    expect(page).toContain('name="default_uses"');
    expect(page).toContain("capacity_");
    expect(page).toContain("resource_uses_per_item");
    expect(action).toContain("p_default_uses: defaultUses");
    expect(action).toContain("capacity_override");
  });

  it("lets admins enable or disable each physical resource for one session", () => {
    expect(page).toContain("enabled_");
    expect(action).toContain("enabled:");
    expect(rpc).toContain("public.session_resources");
    expect(rpc).toContain("enabled = false");
  });

  it("uses the canonical global geometry for the session map", () => {
    expect(page).toContain('from("space_map_elements")');
    expect(page).toContain("rotation_degrees");
    expect(page).toContain("resourceMap");
    expect(page).not.toContain("insert into public.space_map_elements");
  });

  it("saves the session configuration atomically and protects existing assignments", () => {
    expect(action).toContain('rpc("admin_save_session_resources"');
    expect(rpc).toContain("for update;");
    expect(rpc).toContain("resource_not_in_session_space");
    expect(rpc).toContain("resource_uses_per_item = p_default_uses");
  });

  it("shows assignment consumption without changing reservation history", () => {
    expect(page).toContain('from("reservation_resource_assignments")');
    expect(page).toContain('is("released_at", null)');
    expect(page).toContain("assignmentCount");
  });
});
