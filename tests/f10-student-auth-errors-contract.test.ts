import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F10 student auth login contracts", () => {
  it("keeps phone as the visible login while Auth uses an internal email alias", () => {
    const actions = source("app/auth/actions.ts");
    const helper = source("lib/auth/student-login-identifier.ts");
    const card = source("app/login/login-card.tsx");

    expect(actions).toContain("studentAuthEmailFromPhone");
    expect(actions).toContain("{ email: studentAuthEmail!, password }");
    expect(actions).not.toContain("{ phone: phone!, password }");
    expect(helper).toContain("@auth.studioflow.invalid");
    expect(card).toContain(
      "Accede con el teléfono registrado en el estudio y tu contraseña.",
    );
    expect(card).not.toContain("Habilita Phone en Authentication → Providers");
  });

  it("provisions and migrates student Auth without Phone provider or SMS", () => {
    const edgeFunction = source("supabase/functions/provision-student-access/index.ts");
    const createUserBlock =
      edgeFunction.split("adminClient.auth.admin.createUser({")[1]?.split("});")[0] ?? "";

    expect(edgeFunction).toContain("studentAuthEmailFromPhone");
    expect(createUserBlock).toContain("email: authEmail");
    expect(createUserBlock).toContain("email_confirm: true");
    expect(createUserBlock).not.toContain("phone:");
    expect(edgeFunction).not.toContain("phone_confirm: true");
    expect(edgeFunction).toContain("adminClient.auth.admin.updateUserById(student.user_id");
  });

  it("keeps normal bad credentials generic", () => {
    const actions = source("app/auth/actions.ts");
    const card = source("app/login/login-card.tsx");

    expect(actions).toContain('redirect(`${loginPath(mode)}?error=invalid`)');
    expect(card).toContain('invalid: "El teléfono o la contraseña no son correctos."');
  });
});
