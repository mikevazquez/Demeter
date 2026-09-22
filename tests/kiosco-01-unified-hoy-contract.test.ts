import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("KIOSCO-01 unified Hoy role surface", () => {
  const adminToday = source("app/admin/page.tsx");
  const coachToday = source("app/admin/hoy/CoachTodayView.tsx");
  const classes = source("app/admin/hoy/TodayClasses.tsx");
  const operations = source("app/admin/hoy/SessionOperations.tsx");
  const layout = source("app/admin/layout.tsx");

  it("uses Hoy as the single daily-operation surface for Coach and Administration", () => {
    expect(adminToday).toContain('membership.role === "instructor"');
    expect(adminToday).toContain("<CoachTodayView");
    expect(coachToday).toContain("<TodayClasses");
    expect(source("app/admin/mis-clases/page.tsx")).toContain('redirect("/admin")');
    expect(source("app/coach/page.tsx")).toContain('redirect("/admin")');
  });

  it("keeps Coach scoped to assigned sessions at the backend boundary", () => {
    expect(coachToday).toContain('supabase.rpc("coach_my_sessions"');
    expect(coachToday).toContain('supabase.rpc("coach_session_roster"');
    expect(coachToday).not.toContain('.from("class_sessions")');
    expect(coachToday).not.toContain('.from("reservations")');
  });

  it("hides business metrics and admin destinations from Coach", () => {
    expect(coachToday).not.toContain("hoy-kpi-grid");
    expect(layout).toContain('href: "/admin/perfil"');
    expect(layout).toContain('label: "Perfil"');
    expect(layout).toContain("instructorOnly");
  });

  it("shows the approved class lifecycle states in the shared class card", () => {
    for (const label of ["Próxima", "En curso", "Finalizada", "Cancelada"]) {
      expect(classes).toContain(label);
    }
    expect(classes).toContain("today-class-countdown");
    expect(classes).toContain("serverNow");
  });

  it("keeps finalized Coach attendance read-only while Administration can correct", () => {
    expect(coachToday).toContain("canCorrectCompleted={false}");
    expect(adminToday).toContain("canCorrectCompleted");
    expect(operations).toContain("canCorrectCompleted");
    expect(operations).toContain("Clase finalizada · asistencia en modo solo lectura.");
  });

  it("surfaces kiosk versus manual attendance provenance in the same roster", () => {
    expect(adminToday).toContain("attendance_checkins");
    expect(coachToday).toContain("attendance_checkins");
    expect(operations).toContain('item.attendanceSource === "KIOSK" ? "Check-in" : "Manual"');
  });
});
