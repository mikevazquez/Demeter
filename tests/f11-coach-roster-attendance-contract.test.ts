import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F11 coach roster and attendance scope", () => {
  it("keeps attendance mutations inside owner/admin or the assigned instructor session", () => {
    const migration = source(
      "supabase/migrations/20260916143200_f11_coach_attendance_mutation_scope.sql",
    );

    expect(migration).toContain("private.can_manage_attendance_session");
    expect(migration).toContain("private.is_current_instructor_session");
    expect(migration).toContain("public.set_attendance_status(");
    expect(migration).toContain("public.finalize_attendance(target_session_id uuid)");
    expect(migration).toContain("public.add_existing_walkin_student(");
    expect(migration).toContain("public.create_walkin_student(");
    expect(migration).not.toContain("grant students.write");
  });

  it("returns only the roster of an assigned session", () => {
    const migration = source("supabase/migrations/20260916143800_f11_coach_session_roster.sql");
    const page = source("app/coach/clases/[sessionId]/roster/page.tsx");

    expect(migration).toContain("cs.instructor_id = v_instructor_id");
    expect(migration).toContain("raise exception 'session_not_available'");
    expect(migration).not.toContain("phone");
    expect(migration).not.toContain("email");
    expect(page).toContain('supabase.rpc("coach_session_roster"');
    expect(page).toContain("setCoachAttendanceAction");
  });

  it("uses the hardened canonical F8 attendance RPC instead of direct reservation updates", () => {
    const action = source("app/coach/actions.ts");

    expect(action).toContain('supabase.rpc("set_attendance_status"');
    expect(action).not.toContain('.from("reservations")');
    expect(action).not.toContain(".update(");
  });
});
