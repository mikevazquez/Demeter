import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

// Approved mobile and desktop Agenda baselines; class labels remain visible in compact blocks.
describe("ADMIN-UX-03 Agenda calendario operativo", () => {
  const agenda = source("app/admin/agenda/page.tsx");
  const actions = source("app/admin/agenda/[sessionId]/actions.ts");
  const configuration = source("app/admin/agenda/configuracion/page.tsx");
  const activitiesWizard = source("app/admin/actividades/ActivityWizard.tsx");
  const activityActions = source("app/admin/actividades/actions.ts");
  const atomicActivitySave = source(
    "supabase/migrations/20260922155500_actividades01_atomic_save.sql",
  );
  const styles = source("app/admin/agenda/agenda-calendar.css");

  it("replaces the old session list with the approved calendar architecture", () => {
    expect(agenda).toContain("agenda-week-calendar");
    expect(agenda).toContain("agenda-day-column");
    expect(agenda).toContain("agenda-session-block");
    expect(agenda).not.toContain('className="session-list"');
    expect(agenda).not.toContain('className="session-row"');
  });

  it("keeps the weekly Monday to Sunday navigation", () => {
    expect(agenda).toContain("weekStartMonday(selectedDate)");
    expect(agenda).toContain("Array.from({ length: 7 }");
    expect(agenda).toContain("previousWeekKey");
    expect(agenda).toContain("nextWeekKey");
  });

  it("edits a selected session directly from Agenda", () => {
    expect(agenda).toContain("agenda-session-editor");
    expect(agenda).toContain("action={updateSession}");
    expect(agenda).toContain("formAction={cancelSession}");
    expect(agenda).toContain('name="return_to"');
    expect(agenda).toContain("<legend>Aplicar a</legend>");
    expect(agenda).toContain("Solo esta sesión");
    expect(agenda).toContain("Esta y siguientes");
    expect(agenda).toContain("Guardar cambios");
    expect(agenda).toContain("Cancelar clase");
    expect(agenda).not.toContain('className="agenda-cancel-form"');
  });

  it("preserves existing session business actions and supports returning to Agenda", () => {
    expect(actions).toContain("sessionManagementReturn");
    expect(actions).toContain('String(formData.get("return_to")');
    expect(actions).toContain('scope === "future"');
    expect(actions).toContain("is_schedule_exception");
    expect(actions).toContain("admin_session_has_conflict");
  });

  it("uses a desktop week calendar and mobile selected-day timeline", () => {
    expect(styles).toContain("grid-template-columns: repeat(7, minmax(0, 1fr))");
    expect(styles).toContain(".agenda-day-column.is-selected-day");
    expect(styles).toContain(".agenda-session-editor");
    expect(styles).toContain("position: fixed");
    expect(styles).toContain("#ff0a8a");
  });

  it("keeps recurring configuration available without cluttering the calendar", () => {
    expect(agenda).not.toContain('id="configuracion-agenda"');
    expect(agenda).toContain('href="/admin/actividades"');
    expect(configuration).toContain('redirect("/admin/actividades")');
    expect(activitiesWizard).toContain("Horarios y operación");
    expect(activitiesWizard).toContain("+ Agregar hora");
    expect(activityActions).toContain('.rpc("admin_save_activity"');
    expect(atomicActivitySave).toContain("materialize_recurring_schedule");
  });

  it("keeps class names visible in compact mobile blocks", () => {
    expect(agenda).toContain("<strong>{session.name}</strong>");
    expect(styles).toContain(".agenda-session-block strong");
    expect(styles).toContain("font-size: 13px");
    expect(styles).toContain("padding: 6px 52px 6px 14px");
  });
});
