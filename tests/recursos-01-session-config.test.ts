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
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260922223000_activity_resource_defaults.sql"),
    "utf8",
  );

  it("keeps session resources editable as an exception to activity defaults", () => {
    expect(sessionDetail).toContain("Recursos de esta sesión");
    expect(sessionDetail).toContain("/recursos");
    expect(page).toContain("Heredado de la actividad");
    expect(page).toContain("Configuración personalizada");
    expect(page).toContain("El mapa global");
    expect(page).toMatch(/no se\s+modifica/);
  });

  it("supports a default number of people plus per-resource overrides", () => {
    expect(page).toContain('name="default_uses"');
    expect(page).toContain("capacity_");
    expect(page).toContain("resource_uses_per_item");
    expect(page).toContain("Personas por recurso");
    expect(action).toContain("p_default_uses: defaultUses");
    expect(action).toContain("capacity_override");
  });

  it("marks session-level saves as customized and can restore activity defaults", () => {
    expect(migration).toContain("resource_config_customized = true");
    expect(action).toContain('rpc("admin_restore_session_resource_defaults"');
    expect(page).toContain("Restaurar configuración de la actividad");
    expect(migration).toContain("recursos01_apply_template_defaults_to_session");
  });

  it("lets admins enable or disable each physical resource for one session", () => {
    expect(page).toContain("enabled_");
    expect(action).toContain("enabled:");
    expect(migration).toContain("public.session_resources");
    expect(migration).toContain("enabled = false");
  });

  it("uses the canonical global geometry for the session map", () => {
    expect(page).toContain('from("space_map_elements")');
    expect(page).toContain("rotation_degrees");
    expect(page).toContain("resourceMap");
    expect(page).not.toContain("insert into public.space_map_elements");
  });

  it("protects existing assignments when changing or restoring capacities", () => {
    expect(action).toContain('rpc("admin_save_session_resources"');
    expect(migration).toContain("active_assignments");
    expect(migration).toContain("resource_defaults_conflict");
    expect(migration).toContain("reservation_resource_assignments");
  });

  it("shows assignment consumption without changing reservation history", () => {
    expect(page).toContain('from("reservation_resource_assignments")');
    expect(page).toContain('is("released_at", null)');
    expect(page).toContain("assignmentCount");
  });
});
