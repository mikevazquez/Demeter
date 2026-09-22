import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("RECURSOS-01 activity and session inheritance", () => {
  const activityActions = readFileSync(
    join(process.cwd(), "app/admin/actividades/actions.ts"),
    "utf8",
  );
  const activityWizard = readFileSync(
    join(process.cwd(), "app/admin/actividades/ActivityWizard.tsx"),
    "utf8",
  );
  const agendaActions = readFileSync(join(process.cwd(), "app/admin/agenda/actions.ts"), "utf8");
  const migration = readFileSync(
    join(process.cwd(), "supabase/migrations/20260922223000_activity_resource_defaults.sql"),
    "utf8",
  );

  it("configures resource defaults directly on the activity", () => {
    expect(activityWizard).toContain("¿Requiere recurso?");
    expect(activityWizard).toContain('label: "Recursos"');
    expect(activityWizard).toContain("Personas por recurso");
    expect(activityWizard).toContain("Recursos disponibles en el espacio");
    expect(activityWizard).toContain("capacityOverride");
    expect(activityActions).toContain('rpc("admin_save_activity_v2"');
    expect(activityActions).toContain("p_resource_uses_per_item: resourceUsesPerItem");
    expect(activityActions).toContain("p_resource_settings:");
  });

  it("persists activity-level defaults and per-resource overrides", () => {
    expect(migration).toContain("class_templates");
    expect(migration).toContain("resource_uses_per_item");
    expect(migration).toContain("class_template_resources");
    expect(migration).toContain("capacity_override");
    expect(migration).toContain("enabled boolean");
  });

  it("inherits the activity resource capacity into new manual sessions", () => {
    expect(agendaActions).toContain(
      '.select("id, duration_minutes, capacity, requires_resource, resource_uses_per_item")',
    );
    expect(agendaActions).toContain("requires_resource: template.requires_resource");
    expect(agendaActions).toContain("resource_uses_per_item: template.resource_uses_per_item ?? 1");
  });

  it("inherits activity defaults into recurring sessions", () => {
    expect(migration).toContain("create or replace function public.materialize_recurring_schedule");
    expect(migration).toContain("t.requires_resource");
    expect(migration).toContain("t.resource_uses_per_item");
    expect(migration).toContain("recursos01_apply_activity_defaults_before_session");
  });

  it("syncs future inherited sessions while preserving customized sessions", () => {
    expect(migration).toContain("resource_config_customized");
    expect(migration).toContain("resource_config_needs_review");
    expect(migration).toContain("recursos01_sync_activity_resource_defaults");
    expect(migration).toContain("and not cs.resource_config_customized");
    expect(migration).toContain("resource_defaults_conflict");
  });

  it("keeps activity changes safe when existing assignments would become invalid", () => {
    expect(migration).toContain("reservation_resource_assignments");
    expect(migration).toContain("assigned.used_count");
    expect(migration).toContain("resource_config_needs_review = true");
  });

  it("requires a physical space for resource-based activities", () => {
    expect(agendaActions).toContain("template.requires_resource && !spaceId");
    expect(activityActions).toContain("payload.requiresResource && !defaultSpaceId");
    expect(migration).toContain("resource_activity_requires_space");
    expect(migration).toContain("resource_not_in_activity_space");
  });
});
