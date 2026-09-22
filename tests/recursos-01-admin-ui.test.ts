import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("RECURSOS-01 admin configuration", () => {
  const configurationPage = readFileSync(
    join(process.cwd(), "app/admin/configuracion/recursos/page.tsx"),
    "utf8",
  );
  const mapPage = readFileSync(
    join(
      process.cwd(),
      "app/admin/configuracion/recursos/[spaceId]/mapa/page.tsx",
    ),
    "utf8",
  );
  const editor = readFileSync(
    join(
      process.cwd(),
      "app/admin/configuracion/recursos/[spaceId]/mapa/ResourceMapEditor.tsx",
    ),
    "utf8",
  );
  const actions = readFileSync(
    join(process.cwd(), "app/admin/configuracion/recursos/actions.ts"),
    "utf8",
  );
  const settings = readFileSync(
    join(process.cwd(), "app/admin/configuracion/page.tsx"),
    "utf8",
  );
  const mapRpc = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260922061500_recursos01_admin_map_rpc.sql",
    ),
    "utf8",
  );

  it("exposes the resource configuration from studio settings", () => {
    expect(settings).toContain('href="/admin/configuracion/recursos"');
    expect(settings).toContain("Recursos y mapa");
  });

  it("keeps global resources separate from per-session usage", () => {
    expect(configurationPage).toContain("Define qué recursos físicos existen");
    expect(configurationPage).toContain("Las reglas de uso se");
    expect(configurationPage).not.toContain("capacity_override");
    expect(configurationPage).not.toContain("resource_uses_per_item");
  });

  it("supports real resources and a reusable map per space", () => {
    expect(configurationPage).toContain('from("resources")');
    expect(configurationPage).toContain('from("space_maps")');
    expect(configurationPage).toContain('from("space_map_elements")');
    expect(configurationPage).toContain("Editar mapa");
  });

  it("supports multiple resources with automatic numbering", () => {
    expect(actions).toContain("Array.from({ length: quantity }");
    expect(actions).toContain("quantity > 1");
    expect(configurationPage).toContain('name="quantity"');
  });

  it("provides interactive placement and orientation controls", () => {
    expect(editor).toContain("onPointerDown");
    expect(editor).toContain("onPointerMove");
    expect(editor).toContain("Girar +15°");
    expect(editor).toContain("Centrar X");
    expect(editor).toContain("Centrar Y");
    expect(editor).toContain("Vista previa");
    expect(editor).toContain("Deshacer");
    expect(editor).toContain("Rehacer");
  });

  it("lets the editor place both physical resources and visual references", () => {
    expect(editor).toContain('makeReference("door", "Puerta")');
    expect(editor).toContain('makeReference("mirror", "Espejo")');
    expect(editor).toContain('makeReference("window", "Ventana")');
    expect(editor).toContain('makeReference("label", "Referencia")');
    expect(editor).toContain("resourceElement(resource)");
    expect(mapPage).toContain("initialElements");
  });

  it("saves map geometry atomically through a guarded RPC", () => {
    expect(actions).toContain('rpc("admin_save_space_resource_map"');
    expect(mapRpc).toContain("for update;");
    expect(mapRpc).toContain("delete from public.space_map_elements");
    expect(mapRpc).toContain("jsonb_array_elements(p_elements)");
    expect(mapRpc).toContain(
      "private.has_capability(v_space.studio_id, 'settings.write')",
    );
  });
});
