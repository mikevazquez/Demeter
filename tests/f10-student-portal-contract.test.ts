import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F10 student portal contracts", () => {
  const portalMigration = source("supabase/migrations/20260916003136_f10_student_portal_core.sql");
  const accessMigration = source(
    "supabase/migrations/20260916012349_f10_student_access_provisioning.sql",
  );
  const personRlsMigration = source(
    "supabase/migrations/20260916012957_f10_harden_student_person_identity_rls.sql",
  );

  it("resolves the student from auth.uid instead of accepting a client student id", () => {
    expect(portalMigration).toMatch(/s\.user_id\s*=\s*\(select auth\.uid\(\)\)/);
    expect(portalMigration).toContain("private.is_current_student");
    expect(portalMigration).toContain(
      "public.student_schedule_feed(target_start date, target_end date, target_discipline_id uuid default null)",
    );
    expect(portalMigration).toContain("public.student_session_detail(target_session_id uuid)");
    expect(portalMigration).toContain("public.student_book_session(target_session_id uuid)");
    expect(portalMigration).not.toContain("student_schedule_feed(target_student_id");
    expect(portalMigration).not.toContain("student_book_session(target_student_id");
  });

  it("reuses the canonical booking engines", () => {
    expect(portalMigration).toMatch(/public\.booking_eligibility\([^,]+,v_student\.id\)/);
    expect(portalMigration).toContain("return public.book_student(target_session_id,v_student_id)");
    expect(portalMigration).toContain(
      "public.cancel_reservation(target_reservation_id,target_reason)",
    );
  });

  it("keeps commercial data read-only for students", () => {
    expect(portalMigration).toContain("product_acquisitions_student_self_read");
    expect(portalMigration).toContain("credit_ledger_student_self_read");
    expect(portalMigration).toContain("sales_student_self_read");
    expect(portalMigration).toContain("sale_lines_student_self_read");
    expect(portalMigration).toContain("payments_student_self_read");

    const actions = source("app/student/actions.ts");
    expect(actions).not.toContain('.from("sales").insert');
    expect(actions).not.toContain('.from("payments").insert');
    expect(actions).not.toContain('.from("product_acquisitions").insert');
    expect(actions).not.toContain('.from("credit_ledger").insert');
  });

  it("allows profile edits only through the own-profile wrapper", () => {
    const actions = source("app/student/actions.ts");
    expect(actions).toContain('supabase.rpc("student_update_own_profile"');
    expect(actions).not.toContain('.from("persons").update');
    expect(actions).not.toContain('.from("person_contacts").update');
    expect(portalMigration).toMatch(/s\.user_id\s*=\s*\(select auth\.uid\(\)\)/);
  });

  it("hardens persons and person_contacts to the active current-student context", () => {
    expect(personRlsMigration).toContain("private.is_current_student(s.id, s.studio_id)");
    expect(personRlsMigration).toContain("persons_identity_scoped_read");
    expect(personRlsMigration).toContain("person_contacts_identity_scoped_read");
    expect(personRlsMigration).not.toContain("s.user_id = (select auth.uid())");
  });

  it("does not expose other students through the schedule feed", () => {
    const feed =
      portalMigration
        .split("create or replace function public.student_schedule_feed")[1]
        ?.split("create or replace function public.student_session_detail")[0] ?? "";
    expect(feed).not.toContain("student_name");
    expect(feed).not.toContain("student_phone");
    expect(feed).not.toContain("student_email");
    expect(feed).toContain("'spots_available'");
  });

  it("provisions Auth only through a privileged backend boundary", () => {
    const edgeFunction = source("supabase/functions/provision-student-access/index.ts");
    const adminAction = source("app/admin/alumnas/[studentId]/actions.ts");
    const accessLayout = source("app/admin/alumnas/[studentId]/layout.tsx");
    expect(edgeFunction).toContain('withSupabase({ auth: "user" }');
    expect(edgeFunction).toContain("context.supabaseAdmin");
    expect(edgeFunction).toContain("userClient.auth.getUser()");
    expect(edgeFunction).toContain('await userClient\n      .from("students")');
    expect(edgeFunction).toContain('await userClient\n      .from("studio_memberships")');
    expect(edgeFunction).toContain('await userClient\n      .from("role_capabilities")');
    expect(edgeFunction).not.toContain('await adminClient\n      .from("students")');
    expect(edgeFunction).toContain('.eq("capability_key", "settings.write")');
    expect(edgeFunction).toContain("auth.admin.createUser");
    expect(edgeFunction).toContain("phone_confirm: true");
    expect(edgeFunction).toContain('rpc("service_link_student_access"');
    expect(edgeFunction).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(edgeFunction).not.toContain("SUPABASE_ANON_KEY");
    expect(adminAction).toContain("CAPABILITIES.SETTINGS_WRITE");
    expect(adminAction).toContain("supabase.auth.getSession()");
    expect(adminAction).toContain("Authorization: `Bearer ${session.access_token}`");
    expect(adminAction).toContain("FunctionsHttpError");
    expect(adminAction).toContain("error.context.json()");
    expect(accessLayout).toContain("CAPABILITIES.SETTINGS_WRITE");
    expect(adminAction).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(adminAction).not.toContain("service_role");
  });

  it("never writes auth.users from business SQL", () => {
    expect(accessMigration.toLowerCase()).not.toContain("insert into auth.users");
    expect(accessMigration.toLowerCase()).not.toContain("update auth.users");
    expect(accessMigration.toLowerCase()).not.toContain("delete from auth.users");
    expect(accessMigration).toContain(
      "grant execute on function public.service_link_student_access(uuid, uuid) to service_role",
    );
    expect(accessMigration).toContain("must_change_password = true");
  });

  it("forces a temporary-password account through first-login activation", () => {
    const login = source("app/auth/actions.ts");
    const activation = source("app/login/student/activar/actions.ts");
    const portal = source("lib/student/portal.ts");
    expect(login).toContain('redirect("/login/student/activar")');
    expect(portal).toContain(
      'if (account.must_change_password) redirect("/login/student/activar")',
    );
    expect(activation).toContain("supabase.auth.updateUser({ password })");
    expect(activation).toContain('supabase.rpc("student_complete_password_activation")');
  });

  it("removes direct RPC execution from trigger-only security-definer code", () => {
    const revokeMigration = source(
      "supabase/migrations/20260916013227_f10_revoke_trigger_rpc_execute.sql",
    );
    expect(revokeMigration).toContain(
      "revoke all on function public.handle_session_cancelled_reservations() from public, anon, authenticated",
    );
  });

  it("uses the canonical F10 model and keeps documents as a future-state access", () => {
    const studentFiles = [
      "app/student/page.tsx",
      "app/student/paquete/page.tsx",
      "app/student/movimientos/page.tsx",
      "app/student/pagos/page.tsx",
      "app/student/perfil/page.tsx",
      "app/student/reservar/page.tsx",
      "app/student/mis-clases/page.tsx",
    ]
      .map(source)
      .join("\n");
    expect(studentFiles).not.toContain("student_packages");

    const documents = source("app/student/documentos/page.tsx");
    expect(documents).toContain("F12");
    expect(documents).toMatch(/no\s+mostraremos\s+documentos\s+ficticios/i);
  });
});
