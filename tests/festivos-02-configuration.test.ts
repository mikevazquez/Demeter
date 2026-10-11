import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("FESTIVOS simple configuration", () => {
  const page = source("app/admin/configuracion/festivos/page.tsx");
  const actions = source("app/admin/configuracion/festivos/actions.ts");

  it("loads the full catalog alongside verified official sources", () => {
    expect(page).toContain('from("calendar_events")');
    expect(page).toContain('from("official_holidays")');
    expect(page).toContain("source_checked_at");
    expect(page).toContain("CalendarCreationSheet");
  });
  it("supports normal, closed and special schedules by day", () => {
    const editor = source("app/admin/configuracion/festivos/CalendarEventEditor.tsx");
    for (const mode of ["normal", "closed", "special"]) expect(editor).toContain(`value="${mode}"`);
    expect(actions).toContain("admin_configure_calendar_event");
    expect(editor).toContain("keep");
  });

  it("uses the existing official holiday RPC and keeps Agenda in sync", () => {
    expect(actions).toContain('rpc("admin_configure_holiday"');
    expect(actions).toContain('revalidatePath("/admin/agenda")');
    expect(actions).toContain('revalidatePath("/student/reservar")');
  });
});
