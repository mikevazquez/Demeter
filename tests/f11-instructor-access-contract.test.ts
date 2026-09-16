import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F11 instructor access provisioning", () => {
  it("keeps the service bridge restricted to service_role", () => {
    const migration = source(
      "supabase/migrations/20260916164000_f11_instructor_access_provisioning.sql",
    );

    expect(migration).toContain("public.service_link_instructor_access(");
    expect(migration).toContain("from public, anon, authenticated");
    expect(migration).toContain(
      "grant execute on function public.service_link_instructor_access(uuid, uuid) to service_role",
    );
    expect(migration).toContain("role = 'instructor'");
    expect(migration).toContain("person_id = excluded.person_id");
  });

  it("forces the Coach to replace the temporary password", () => {
    const migration = source(
      "supabase/migrations/20260916164000_f11_instructor_access_provisioning.sql",
    );
    const auth = source("app/auth/actions.ts");
    const activation = source("app/login/coach/activar/actions.ts");

    expect(migration).toContain("must_change_password = true");
    expect(migration).toContain("public.instructor_complete_password_activation()");
    expect(auth).toContain('redirect("/login/coach/activar")');
    expect(activation).toContain('supabase.rpc("instructor_complete_password_activation")');
    expect(activation).toContain("supabase.auth.updateUser({ password })");
  });

  it("provisions Auth only inside the protected Edge Function", () => {
    const edge = source("supabase/functions/provision-instructor-access/index.ts");
    const adminAction = source("app/admin/instructores/[instructorId]/access-actions.ts");

    expect(edge).toContain('withSupabase({ auth: "user" }');
    expect(edge).toContain('capability_key", "settings.write"');
    expect(edge).toContain("adminClient.auth.admin.createUser");
    expect(edge).toContain('adminClient.rpc("service_link_instructor_access"');
    expect(adminAction).toContain('supabase.functions.invoke("provision-instructor-access"');
    expect(adminAction).not.toContain("service_role");
  });

  it("requires instructor email and refuses silent linking of an existing Auth identity", () => {
    const edge = source("supabase/functions/provision-instructor-access/index.ts");
    const profile = source("app/admin/instructores/[instructorId]/page.tsx");
    const component = source(
      "app/admin/instructores/[instructorId]/InstructorAccessProvisioner.tsx",
    );

    expect(edge).toContain("instructor_email_required");
    expect(edge).toContain("auth_login_exists");
    expect(edge).not.toContain("listUsers");
    expect(profile).toContain("InstructorAccessProvisioner");
    expect(component).toContain("Habilitar acceso Coach");
  });
});
