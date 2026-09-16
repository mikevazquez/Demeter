import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F11 coach shell contract", () => {
  it("keeps Coach as a separate protected portal", () => {
    const actions = source("app/auth/actions.ts");
    const loginCard = source("app/login/login-card.tsx");
    const context = source("lib/auth/coach-context.ts");

    expect(actions).toContain("CAPABILITIES.INSTRUCTOR_PORTAL");
    expect(actions).toContain('redirect("/coach")');
    expect(loginCard).toContain('mode: "admin" | "coach" | "student"');
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

  it("does not implement roster or arbitrary student access in SF-108", () => {
    const coachHome = source("app/coach/page.tsx");
    const context = source("lib/auth/coach-context.ts");

    expect(coachHome).toContain(
      "El listado de Hoy, Mañana y calendario se incorpora en SF-109",
    );
    expect(context).not.toContain('.from("students")');
    expect(context).not.toContain('.from("reservations")');
  });
});
