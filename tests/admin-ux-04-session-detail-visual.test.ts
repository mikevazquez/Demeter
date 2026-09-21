import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("ADMIN-UX-04 full session operation visual homologation", () => {
  const page = source("app/admin/agenda/[sessionId]/page.tsx");
  const actions = source("app/admin/agenda/[sessionId]/actions.ts");
  const styles = source("app/admin/agenda/session-detail-admin-ux-04.css");
  const layout = source("app/admin/layout.tsx");

  it("scopes the session detail to the approved admin visual system", () => {
    expect(page).toContain("admin-ux04-session-detail");
    expect(page).toContain("admin-class-stats");
    expect(page).toContain("<SessionOperations");
    expect(styles).toContain(".admin-ux04-session-detail");
    expect(styles).toContain("#ff0a8a");
  });

  it("keeps the existing operational capabilities", () => {
    expect(page).toContain("canAttendance");
    expect(page).toContain("canBook");
    expect(page).toContain("canCreateStudent");
    expect(page).toContain("initiallyOpen");
    expect(page).toContain("showToggle={false}");
  });

  it("uses a single scope selector for edit and cancellation", () => {
    expect(page).toContain("<legend>Aplicar a</legend>");
    expect(page).toContain('value="single"');
    expect(page).toContain('value="future"');
    expect(page).toContain("formAction={cancelSession}");
    expect(page).toContain('name="return_to"');
    expect(page).not.toContain("Cancelar solo esta sesión");
    expect(page).not.toContain("Cancelar esta y todas las siguientes");
  });

  it("preserves the existing single/future backend behavior", () => {
    expect(actions).toContain('scope === "future"');
    expect(actions).toContain("recurring_schedule_id");
    expect(actions).toContain("is_schedule_exception");
    expect(actions).toContain("sessionManagementReturn");
  });

  it("keeps responsive desktop and mobile layouts", () => {
    expect(styles).toContain("@media (max-width: 760px)");
    expect(styles).toContain("@media (max-width: 430px)");
    expect(styles).toContain("grid-template-columns: repeat(4, minmax(0, 1fr))");
    expect(styles).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
  });

  it("loads after Agenda's approved calendar styles", () => {
    expect(layout).toContain('import "./agenda/agenda-calendar.css";');
    expect(layout).toContain('import "./agenda/session-detail-admin-ux-04.css";');
    expect(layout.indexOf('import "./agenda/session-detail-admin-ux-04.css";')).toBeGreaterThan(
      layout.indexOf('import "./agenda/agenda-calendar.css";'),
    );
  });
});
