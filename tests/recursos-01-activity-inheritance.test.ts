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
  const inheritance = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260922064000_recursos01_activity_session_inheritance.sql",
    ),
    "utf8",
  );
  const restoredActivities = readFileSync(
    join(process.cwd(), "supabase/migrations/20260922134500_actividades01_restore.sql"),
    "utf8",
  );
  const defaults = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260922065000_recursos01_session_resource_defaults.sql",
    ),
    "utf8",
  );

  it("captures only whether an activity requires a resource", () => {
    expect(activityWizard).toContain("¿Requiere recurso?");
    expect(activityActions).toContain("requires_resource: Boolean(payload.requiresResource)");
    expect(activityWizard).not.toContain("resource_uses_per_item");
    expect(activityWizard).not.toContain("capacity_override");
  });

  it("keeps resource capacity out of Activities and at the session layer", () => {
    expect(activityWizard).toContain("Esta actividad utiliza recursos del estudio.");
    expect(activityWizard).not.toContain("Usos por recurso");
    expect(activityWizard).not.toContain("Capacidad por recurso");
  });

  it("snapshots the activity requirement into new manual sessions", () => {
    expect(agendaActions).toContain('.select("id, duration_minutes, capacity, requires_resource")');
    expect(agendaActions).toContain("requires_resource: template.requires_resource");
    expect(agendaActions).toContain("resource_uses_per_item: 1");
  });

  it("snapshots the activity requirement into recurring sessions", () => {
    expect(inheritance).toContain("t.requires_resource");
    expect(inheritance).toContain("resource_uses_per_item");
    expect(restoredActivities).toContain("t.requires_resource");
    expect(restoredActivities).toContain("duration_value");
  });

  it("requires a physical space before creating resource-based sessions", () => {
    expect(agendaActions).toContain("template.requires_resource && !spaceId");
    expect(activityActions).toContain("payload.requiresResource && !row.spaceId");
    expect(restoredActivities).toContain("resource_activity_requires_space");
  });

  it("automatically makes active resources from the session space available", () => {
    expect(defaults).toContain("recursos01_sync_session_resources");
    expect(defaults).toContain("from public.resources r");
    expect(defaults).toContain("r.space_id = new.space_id");
    expect(defaults).toContain("and r.active");
    expect(defaults).toContain("capacity_override");
  });

  it("does not backfill or rewrite already-created sessions in migrations", () => {
    expect(inheritance).not.toMatch(/update\s+public\.class_sessions/i);
    expect(defaults).not.toMatch(/update\s+public\.class_sessions/i);
    expect(restoredActivities).not.toMatch(/update\s+public\.class_sessions/i);
  });
});
