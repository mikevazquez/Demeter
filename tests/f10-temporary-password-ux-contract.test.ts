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

  it("allows a server-only temporary password regeneration only while activation is pending", () => {
    const edgeFunction = source("supabase/functions/provision-student-access/index.ts");
    const actions = source("app/admin/alumnas/[studentId]/actions.ts");

    expect(edgeFunction).toContain('payload.mode === "reset"');
    expect(edgeFunction).toContain("account.must_change_password !== true");
    expect(edgeFunction).toContain("adminClient.auth.admin.updateUserById(student.user_id");
    expect(edgeFunction).toContain('{ error: "temporary_password_reset_closed" }');
    expect(actions).toContain("resetStudentTemporaryPassword");
    expect(actions).toContain('{ studentId, mode: "reset" }');
    expect(actions).toContain("account.must_change_password !== true");
  });

  it("generates copy-safe temporary passwords as Demeter plus six digits", () => {
    const edgeFunction = source("supabase/functions/provision-student-access/index.ts");

    expect(edgeFunction).toContain("new Uint32Array(6)");
    expect(edgeFunction).toContain('String(value % 10)');
    expect(edgeFunction).toContain('return `Demeter${suffix}`');
    expect(edgeFunction).not.toContain('const symbols =');
  });

  it("keeps generated credentials visible until the admin acknowledges them", () => {
    const component = source("app/admin/alumnas/[studentId]/StudentAccessProvisioner.tsx");
    const layout = source("app/admin/alumnas/[studentId]/layout.tsx");

    expect(component).toContain("Copiar contraseña");
    expect(component).toContain("Ya la guardé");
    expect(component).toContain("setCredentials(null)");
    expect(component).toContain("StudentTemporaryPasswordResetter");
    expect(layout).toContain("account?.must_change_password");
    expect(layout).toContain("StudentTemporaryPasswordResetter");
  });
});
