import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("RECURSOS-01 activity and session inheritance", () => {
  const recurringActions = readFileSync(
    join(process.cwd(), "app/admin/agenda/recurring-actions.ts"),
    "utf8",
  );
  const agendaActions = readFileSync(join(process.cwd(), "app/admin/agenda/actions.ts"), "utf8");
  const agendaConfiguration = readFileSync(
    join(process.cwd(), "app/admin/agenda/configuracion/page.tsx"),
    "utf8",
  );
  const inheritance = readFileSync(
    join(
      process.cwd(),
      "supabase/migrations/20260922064000_recursos01_activity_session_inheritance.sql",
    ),
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
    expect(recurringActions).toContain('formData.get("requires_resource")');
    expect(recurringActions).toContain("requires_resource: requiresResource");
    expect(agendaConfiguration).toContain("Requiere recurso físico");
    expect(agendaConfiguration).not.toContain("resource_uses_per_item");
    expect(agendaConfiguration).not.toContain("capacity_override");
  });

  it("snapshots the activity requirement into new manual sessions", () => {
    expect(agendaActions).toContain('.select("id, duration_minutes, capacity, requires_resource")');
    expect(agendaActions).toContain("requires_resource: template.requires_resource");
    expect(agendaActions).toContain("resource_uses_per_item: 1");
  });

  it("snapshots the activity requirement into recurring sessions", () => {
    expect(inheritance).toContain("t.requires_resource");
    expect(inheritance).toContain("resource_uses_per_item");
    expect(inheritance).toContain("Materializes recurring class sessions");
  });

  it("requires a physical space before creating resource-based sessions", () => {
    expect(agendaActions).toContain("template.requires_resource && !spaceId");
    expect(recurringActions).toContain("template.requires_resource && !row.space_id");
  });

  it("automatically makes active resources from the session space available", () => {
    expect(defaults).toContain("recursos01_sync_session_resources");
    expect(defaults).toContain("from public.resources r");
    expect(defaults).toContain("r.space_id = new.space_id");
    expect(defaults).toContain("and r.active");
    expect(defaults).toContain("capacity_override");
  });

  it("does not backfill or rewrite already-created sessions", () => {
    expect(inheritance).not.toMatch(/update\s+public\.class_sessions/i);
    expect(defaults).not.toMatch(/update\s+public\.class_sessions/i);
  });
});
