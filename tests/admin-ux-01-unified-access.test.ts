import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("ADMIN-UX-01 unified Studio access", () => {
  const home = source("app/page.tsx");
  const loginCard = source("app/login/login-card.tsx");
  const studioLogin = source("app/login/studio/page.tsx");
  const legacyAdminLogin = source("app/login/admin/page.tsx");
  const legacyCoachLogin = source("app/login/coach/page.tsx");
  const authActions = source("app/auth/actions.ts");
  const adminContext = source("lib/auth/admin-context.ts");
  const coachContext = source("lib/auth/coach-context.ts");
  const adminLayout = source("app/admin/layout.tsx");
  const myClasses = source("app/admin/mis-clases/page.tsx");
  const coachLayout = source("app/coach/layout.tsx");
  const coachHome = source("app/coach/page.tsx");

  it("shows only Studio and Student as public access contexts", () => {
    expect(home).toContain('href="/login/studio"');
    expect(home).toContain('href="/login/student"');
    expect(home).not.toContain('href="/login/coach"');
    expect(home).not.toContain("Mis clases");
  });

  it("does not ask Studio users to choose admin or coach before authentication", () => {
    expect(loginCard).toContain('mode: "studio" | "student"');
    expect(loginCard).not.toContain('"admin" | "coach"');
    expect(loginCard).not.toContain("¿Otro portal?");
    expect(studioLogin).toContain('mode="studio"');
    expect(legacyAdminLogin).toContain('"/login/studio"');
    expect(legacyCoachLogin).toContain('"/login/studio"');
  });

  it("provides visible pending feedback during sign in", () => {
    expect(loginCard).toContain("useFormStatus");
    expect(loginCard).toContain('pending ? "Entrando…" : "Entrar"');
    expect(loginCard).toContain("aria-busy={pending}");
  });

  it("resolves Studio access from membership and portal capabilities after authentication", () => {
    expect(authActions).toContain('from("studio_memberships")');
    expect(authActions).toContain("CAPABILITIES.ADMIN_PORTAL");
    expect(authActions).toContain("CAPABILITIES.INSTRUCTOR_PORTAL");
    expect(authActions).toContain('"/admin/mis-clases"');
    expect(authActions).not.toContain('requestedMode === "coach"');
  });

  it("keeps Student authentication separate and compatible", () => {
    expect(authActions).toContain('mode === "student"');
    expect(authActions).toContain("studentAuthEmailFromPhone");
    expect(authActions).toContain("CAPABILITIES.STUDENT_PORTAL");
    expect(authActions).toContain('redirect("/student")');
  });

  it("uses a validated selected Studio context instead of trusting the cookie alone", () => {
    expect(adminContext).toContain("STUDIO_CONTEXT_COOKIE");
    expect(adminContext).toContain(
      "memberships.find((item) => item.studio_id === selectedStudioId)",
    );
    expect(adminContext).toContain("CAPABILITIES.INSTRUCTOR_PORTAL");
    expect(coachContext).toContain("STUDIO_CONTEXT_COOKIE");
    expect(coachContext).toContain('.eq("role", "instructor")');
  });

  it("integrates instructor work into the Studio shell", () => {
    expect(adminLayout).toContain('href: "/admin/mis-clases"');
    expect(adminLayout).toContain('label: "Mis clases"');
    expect(adminLayout).toContain('activeFor: ["/coach"]');
    expect(myClasses).toContain("Mis clases");
    expect(myClasses).toContain("Operar clase");
    expect(coachLayout).toContain("<AdminLayout>{children}</AdminLayout>");
    expect(coachHome).toContain('"/admin/mis-clases"');
  });

  it("does not expose admin entity navigation to instructor-only access", () => {
    const instructorNav =
      adminLayout.split("const navItems = instructorOnly")[1]?.split(": [")[0] ?? "";
    expect(instructorNav).toContain('label: "Mis clases"');
    expect(instructorNav).not.toContain('label: "Alumnas"');
    expect(instructorNav).not.toContain('label: "Empresa"');
  });

  it("supports first access and multi-studio selection only when required", () => {
    expect(authActions).toContain('redirect("/login/studio/activar")');
    expect(authActions).toContain('redirect("/login/studio/seleccionar")');
    expect(authActions).toContain("studioAccess.memberships.length > 1");
  });
});
