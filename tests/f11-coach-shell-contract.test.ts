import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F11 coach shell contract", () => {
  it("keeps Coach as a separate protected portal without regressing the password hotfix", () => {
    const actions = source("app/auth/actions.ts");
    const loginCard = source("app/login/login-card.tsx");
    const context = source("lib/auth/coach-context.ts");

    expect(actions).toContain("CAPABILITIES.INSTRUCTOR_PORTAL");
    expect(actions).toContain('redirect("/coach")');
    expect(actions).toContain("Supabase Auth rejected sign-in");
    expect(loginCard).toContain('mode: "admin" | "coach" | "student"');
    expect(loginCard).toContain('type={passwordVisible ? "text" : "password"}');
    expect(loginCard).toContain('title: "Coach"');
    expect(context).toContain('redirect("/login/coach")');
    expect(context).toContain("CAPABILITIES.INSTRUCTOR_PORTAL");
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
    const coachHome = source("app/coach/page.tsx");
    const detail = source("app/coach/clases/[sessionId]/page.tsx");

    expect(context).not.toContain('.from("students")');
    expect(context).not.toContain('.from("reservations")');
    expect(coachHome).toContain('supabase.rpc("coach_my_sessions"');
    expect(detail).toContain('supabase.rpc("coach_session_detail"');
  });
});
