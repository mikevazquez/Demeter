import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F10 temporary password UX contracts", () => {
  it("does not revalidate the student page before credentials can be read", () => {
    const actions = source("app/admin/alumnas/[studentId]/actions.ts");
    const accessAction = actions
      .split("async function invokeStudentAccess")[1]
      ?.split("export async function provisionStudentAccess")[0];

    expect(accessAction).toBeTruthy();
    expect(accessAction).not.toContain("revalidatePath");
  });

  it("keeps temporary password regeneration server-only and safely reopens activation when needed", () => {
    const edgeFunction = source("supabase/functions/provision-student-access/index.ts");
    const actions = source("app/admin/alumnas/[studentId]/actions.ts");

    expect(edgeFunction).toContain('payload.mode === "reset"');
    expect(edgeFunction).toContain(
      "const shouldReopenActivation = account.must_change_password !== true",
    );
    expect(edgeFunction).toContain("adminClient.auth.admin.updateUserById(student.user_id");
    expect(edgeFunction).toContain("must_change_password: true");
    expect(edgeFunction).toContain("must_change_password: false");
    expect(actions).toContain("resetStudentTemporaryPassword");
    expect(actions).toContain('{ studentId, mode: "reset" }');
    expect(actions).toContain("account.must_change_password !== true");
  });

  it("keeps generated credentials visible until the admin acknowledges them", () => {
    const component = source("app/admin/alumnas/[studentId]/StudentAccessProvisioner.tsx");
    const accessSection = source("app/admin/alumnas/[studentId]/StudentPortalAccessSection.tsx");

    expect(component).toContain("Copiar contraseña");
    expect(component).toContain("Ya la guardé");
    expect(component).toContain("setCredentials(null)");
    expect(component).toContain("StudentTemporaryPasswordResetter");
    expect(accessSection).toContain("account?.must_change_password");
    expect(accessSection).toContain("StudentTemporaryPasswordResetter");
  });
});
