import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("DEV-01 tenant ready", () => {
  const authActions = source("app/auth/actions.ts");
  const studentPortal = source("lib/student/portal.ts");
  const serverClient = source("lib/supabase/server.ts");
  const browserClient = source("lib/supabase/client.ts");
  const studentSelector = source("app/login/student/seleccionar/page.tsx");
  const activation = source("app/login/student/activar/actions.ts");
  const contextMigration = source(
    "supabase/migrations/20260925230412_dev_01_tenant_ready_context.sql",
  );
  const anonMigration = source(
    "supabase/migrations/20260925230510_dev_01_revoke_unintended_anon_rpc.sql",
  );
  const provisioningMigration = source(
    "supabase/migrations/20260925232943_dev_01_multi_studio_student_provisioning.sql",
  );
  const hardeningMigration = source(
    "supabase/migrations/20260925233039_dev_01b_cross_tenant_hardening.sql",
  );

  it("allows one auth user to be a student in more than one studio without duplicate rows per studio", () => {
    expect(contextMigration).toContain("drop index if exists public.students_user_unique");
    expect(contextMigration).toContain("students_studio_user_unique");
    expect(contextMigration).toContain("on public.students (studio_id,user_id)");
  });

  it("propagates the selected studio through server-side Supabase requests", () => {
    expect(serverClient).toContain("STUDIO_CONTEXT_COOKIE");
    expect(serverClient).toContain('"x-studio-id": selectedStudioId');
    expect(contextMigration).toContain("private.requested_studio_id()");
    expect(contextMigration).toContain("s.studio_id = private.requested_studio_id()");
  });

  it("does not reuse a browser singleton with a stale tenant header", () => {
    expect(browserClient).toContain("isSingleton: normalizedStudioId ? false : undefined");
    expect(browserClient).toContain('"x-studio-id": normalizedStudioId');
  });

  it("requires an explicit student studio selection when more than one membership exists", () => {
    expect(authActions).toContain("studentAccess.memberships.length > 1");
    expect(authActions).toContain('redirect("/login/student/seleccionar")');
    expect(authActions).toContain("selectStudentStudio");
    expect(studentSelector).toContain("Selecciona tu estudio");
    expect(studentSelector).toContain("selectStudentStudio");
    expect(activation).toContain('redirect("/login/student/seleccionar")');
  });

  it("validates the selected student membership instead of trusting the cookie alone", () => {
    expect(studentPortal).toContain("STUDIO_CONTEXT_COOKIE");
    expect(studentPortal).toContain(
      "memberships.find((item) => item.studio_id === selectedStudioId)",
    );
    expect(studentPortal).toContain('.eq("studio_id", membership.studio_id)');
    expect(studentPortal).toContain('redirect("/login/student/seleccionar")');
  });

  it("scopes notification preferences to the selected student studio", () => {
    expect(contextMigration).toContain(
      "v_requested_studio uuid := private.requested_studio_id()",
    );
    expect(contextMigration).toContain("and s.studio_id=v_requested_studio");
    expect(contextMigration).toContain("and s.studio_id = v_requested_studio");
  });

  it("provisions student access per studio instead of assuming one global student account", () => {
    expect(provisioningMigration).toContain("service_link_student_access");
    expect(provisioningMigration).toContain(
      "insert into public.studio_memberships(studio_id,user_id,role,active,person_id)",
    );
    expect(provisioningMigration).toContain("on conflict(studio_id,user_id)");
  });

  it("makes staff authorization honor the selected studio context", () => {
    expect(hardeningMigration).toContain(
      "private.requested_studio_id() is null",
    );
    expect(hardeningMigration).toContain(
      "target_studio_id = private.requested_studio_id()",
    );
    expect(hardeningMigration).toContain(
      "p_studio_id = private.requested_studio_id()",
    );
  });

  it("prevents stale reservation ownership from leaking another studio", () => {
    expect(hardeningMigration).toContain("drop policy if exists reservations_student_linked_self_read");
    expect(hardeningMigration).toContain(
      "and private.is_current_student(student_id, studio_id)",
    );
    expect(hardeningMigration).not.toContain(
      "student_user_id = ( SELECT auth.uid() AS uid)",
    );
  });

  it("scopes in-app notifications to the selected studio", () => {
    expect(hardeningMigration).toContain("drop policy if exists app_notifications_select");
    expect(hardeningMigration).toContain(
      "recipient_user_id = (select auth.uid())",
    );
    expect(hardeningMigration).toContain(
      "and private.is_studio_member(studio_id)",
    );
  });

  it("keeps rewards and push operations inside the selected studio", () => {
    expect(hardeningMigration).toContain(
      "student_reward_challenge_leaderboard",
    );
    expect(hardeningMigration).toContain(
      "student_claim_reward_credits",
    );
    expect(hardeningMigration).toContain(
      "private.is_current_student(id, studio_id)",
    );
    expect(hardeningMigration).toContain(
      "if not private.is_studio_member(p_studio_id) then",
    );
  });

  it("keeps service-only notification checks out of the authenticated API", () => {
    expect(hardeningMigration).toContain(
      "revoke execute on function public.service_notification_channel_allowed(uuid,text,uuid,text)",
    );
    expect(hardeningMigration).toContain(
      "from public, anon, authenticated",
    );
    expect(hardeningMigration).toContain("to service_role");
  });

  it("uses the hardened owner check for tenant-scoped storage paths", () => {
    expect(hardeningMigration).toContain(
      "private.is_current_user_studio_owner_path",
    );
    expect(hardeningMigration).toContain(
      "return private.has_studio_role",
    );
  });

  it("removes anonymous execution from privileged tenant RPCs", () => {
    expect(anonMigration).toContain(
      "owner_update_studio_portal_branding(uuid,text,text) from anon",
    );
    expect(anonMigration).toContain(
      "service_notification_channel_allowed(uuid,text,uuid,text) from anon",
    );
    expect(anonMigration).toContain(
      "student_get_notification_channel_preferences() from anon",
    );
    expect(anonMigration).toContain(
      "student_set_notification_channel_preference(text,boolean) from anon",
    );
  });
});
