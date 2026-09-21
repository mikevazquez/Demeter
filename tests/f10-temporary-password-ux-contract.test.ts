import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F10 student self-password activation contracts", () => {
  it("never exposes an initial student password to the admin UI", () => {
    const component = source("app/admin/alumnas/[studentId]/StudentAccessProvisioner.tsx");
    const actions = source("app/admin/alumnas/[studentId]/actions.ts");
    const edgeFunction = source("supabase/functions/provision-student-access/index.ts");

    expect(component).not.toContain("Copiar contraseña");
    expect(component).not.toContain("temporaryPassword");
    expect(actions).not.toContain("temporaryPassword");
    expect(edgeFunction).not.toContain("temporary_password");
    expect(edgeFunction).not.toContain("Demeter");
    expect(component).toContain("Reenviar enlace de activación");
  });

  it("generates a recovery activation link and sends only that link through student_welcome", () => {
    const edgeFunction = source("supabase/functions/provision-student-access/index.ts");

    expect(edgeFunction).toContain('type: "recovery"');
    expect(edgeFunction).toContain("adminClient.auth.admin.generateLink");
    expect(edgeFunction).toContain("activation_url: activationLink");
    expect(edgeFunction).toContain('template: "student_welcome"');
    expect(edgeFunction).toContain('source: "student_access_provisioning"');
  });

  it("allows activation-link resend only while the account is still pending activation", () => {
    const edgeFunction = source("supabase/functions/provision-student-access/index.ts");
    const actions = source("app/admin/alumnas/[studentId]/actions.ts");

    expect(edgeFunction).toContain('if (mode === "resend")');
    expect(edgeFunction).toContain("account.must_change_password !== true");
    expect(edgeFunction).toContain('error: "activation_already_completed"');
    expect(actions).toContain("resendStudentActivationLink");
    expect(actions).toContain('{ studentId, mode: "resend" as const, activationUrl }');
  });

  it("does not consume the one-time token on page load", () => {
    const page = source("app/login/student/activar/page.tsx");
    const actions = source("app/login/student/activar/actions.ts");

    expect(page).toContain('name="token_hash"');
    expect(page).not.toContain("verifyOtp");
    expect(page).toContain('supabase.rpc("student_portal_entry_route"');
    expect(page).toContain('if (entryRoute === "profile") redirect("/student")');
    expect(page).toContain('if (entryRoute === "login") redirect("/login/student")');
    expect(actions).toContain("supabase.auth.verifyOtp");
    expect(actions).toContain('type: "recovery"');

    const validationMarker = actions.indexOf("password.length < 8");
    const verifyMarker = actions.indexOf("supabase.auth.verifyOtp");
    expect(validationMarker).toBeGreaterThan(-1);
    expect(verifyMarker).toBeGreaterThan(validationMarker);
  });

  it("keeps the same welcome link useful after activation", () => {
    const edgeFunction = source("supabase/functions/provision-student-access/index.ts");
    const page = source("app/login/student/activar/page.tsx");
    const migration = source(
      "supabase/migrations/20260921180500_sf174_permanent_student_portal_entry.sql",
    );

    expect(edgeFunction).toContain('activationLink.searchParams.set("entry", entryKey)');
    expect(edgeFunction).toContain("portal_entry_key");
    expect(page).toContain('type EntryRoute = "activate" | "profile" | "login" | "invalid"');
    expect(migration).toContain("student_portal_entry_route");
    expect(migration).toContain("return 'profile'");
    expect(migration).toContain("return 'login'");
    expect(migration).toContain("grant execute on function public.student_portal_entry_route(text) to anon, authenticated");
  });

  it("builds the activation URL from the active environment host", () => {
    const actions = source("app/admin/alumnas/[studentId]/actions.ts");

    expect(actions).toContain('new URL("/login/student/activar", `https://${host}`).toString()');
    expect(actions).toContain("activationUrl");
  });
});
