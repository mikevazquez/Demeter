import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F11 coach shell contract", () => {
  it("integrates Coach into the protected Studio portal without regressing password handling", () => {
    const actions = source("app/auth/actions.ts");
    const loginCard = source("app/login/login-card.tsx");
    const context = source("lib/auth/coach-context.ts");
    const coachLayout = source("app/coach/layout.tsx");

    expect(actions).toContain("CAPABILITIES.INSTRUCTOR_PORTAL");
    expect(actions).toContain('return "/admin"');
    expect(actions).toContain("Supabase Auth rejected sign-in");
    expect(loginCard).toContain('mode: "studio" | "student"');
    expect(loginCard).toContain('type={passwordVisible ? "text" : "password"}');
    expect(loginCard).toContain('title: "Acceso al estudio"');
    expect(context).toContain('redirect("/login/studio")');
    expect(context).toContain("CAPABILITIES.INSTRUCTOR_PORTAL");
    expect(coachLayout).toContain("<AdminLayout>{children}</AdminLayout>");
  });

  it("requires an active instructor linked through the current membership person", () => {
    const context = source("lib/auth/coach-context.ts");

    expect(context).toContain('.from("instructors")');
    expect(context).toContain('.eq("person_id", membership.person_id)');
    expect(context).toContain('instructor.status !== "active"');
    expect(context).not.toContain("student_id");
  });

  it("keeps student and reservation access out of the generic Coach context", () => {
    const context = source("lib/auth/coach-context.ts");
    const coachHome = source("app/admin/hoy/CoachTodayView.tsx");
    const detail = source("app/coach/clases/[sessionId]/page.tsx");

    expect(context).not.toContain('.from("students")');
    expect(context).not.toContain('.from("reservations")');
    expect(coachHome).toContain('supabase.rpc("coach_my_sessions"');
    expect(detail).toContain('redirect(`/admin#session-${sessionId}`)');
  });
});
