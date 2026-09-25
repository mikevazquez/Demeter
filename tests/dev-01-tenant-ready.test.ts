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
