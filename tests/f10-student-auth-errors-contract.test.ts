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
    expect(card).toContain("Accede con el teléfono registrado en el estudio y tu contraseña.");
    expect(card).not.toContain("Habilita Phone en Authentication → Providers");
  });

  it("provisions and migrates student Auth without Phone provider or SMS", () => {
    const edgeFunction = source("supabase/functions/provision-student-access/index.ts");
    const createUserBlock =
      edgeFunction.split("adminClient.auth.admin.createUser({")[1]?.split("});")[0] ?? "";

    expect(edgeFunction).toContain("studentAuthEmailFromPhone");
    expect(createUserBlock).toContain("email: authEmail");
    expect(createUserBlock).toContain("email_confirm: true");
    expect(createUserBlock).not.toMatch(/^\s*phone:/m);
    expect(edgeFunction).not.toContain("phone_confirm: true");
    expect(edgeFunction).toContain("adminClient.auth.admin.updateUserById(student.user_id");
  });

  it("keeps bad credentials generic and surfaces Auth diagnostics safely", () => {
    const actions = source("app/auth/actions.ts");
    const card = source("app/login/login-card.tsx");
    const diagnosticBlock =
      actions.split("Supabase Auth rejected sign-in")[1]?.split("});")[0] ?? "";

    expect(actions).toContain("?error=invalid");
    expect(actions).toContain("?error=rate");
    expect(actions).toContain("?error=auth");
    expect(actions).toContain("Supabase Auth rejected sign-in");
    expect(actions).toContain("passwordLength");
    expect(actions).toContain("hasOuterWhitespace");
    expect(actions).toContain("asciiOnly");
    expect(actions).toContain("unicodeNormalizationChanged");
    expect(diagnosticBlock).not.toContain("password,");
    expect(card).toContain('invalid: "El teléfono o la contraseña no son correctos."');
  });

  it("lets users reveal and hide the password before submitting", () => {
    const card = source("app/login/login-card.tsx");

    expect(card).toContain('"use client"');
    expect(card).toContain("useState(false)");
    expect(card).toContain('type={passwordVisible ? "text" : "password"}');
    expect(card).toContain('"Mostrar contraseña"');
    expect(card).toContain('"Ocultar contraseña"');
    expect(card).toContain("aria-pressed={passwordVisible}");
    expect(card).toContain("<EyeIcon visible={passwordVisible} />");
  });

  it("prevents mobile text assistance from mutating a revealed password", () => {
    const card = source("app/login/login-card.tsx");
    const actions = source("app/auth/actions.ts");

    expect(card).toContain('autoCapitalize="none"');
    expect(card).toContain('autoCorrect="off"');
    expect(card).toContain("spellCheck={false}");
    expect(actions).toContain("trimRetryAttempted");
    expect(actions).toContain("const trimmedPassword = password.trim()");
  });

  it("refreshes the SSR auth client before post-login RLS checks", () => {
    const actions = source("app/auth/actions.ts");

    expect(actions).toContain("const accessClient = await createClient()");
    expect(actions).toContain('.from("user_accounts")');
    expect(actions).toContain('.from("studio_memberships")');
    expect(actions).toContain("Account lookup failed");
    expect(actions).toContain("Student membership lookup failed");
    expect(actions).toContain("Student portal capability lookup failed");
    expect(actions).toContain("membershipResult.error");
    expect(actions).toContain("capabilityResult.error");
  });
});
