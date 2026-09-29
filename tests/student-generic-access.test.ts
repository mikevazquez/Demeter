import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("student generic access entry", () => {
  const edge = source("supabase/functions/student-access-entry/index.ts");
  const action = source("app/acceso/actions.ts");
  const page = source("app/acceso/page.tsx");

  it("keeps the public entry URL generic", () => {
    expect(page).toContain("Acceso de alumna");
    expect(page).not.toContain("token_hash");
    expect(action).toContain('"demeter-fitness"');
  });

  it("returns only routing states from the elevated lookup", () => {
    expect(edge).toContain('"login" | "pending" | "not_found"');
    expect(edge).toContain('select("id, user_id")');
    expect(edge).not.toContain("full_name");
    expect(edge).not.toContain("email");
  });

  it("never creates an account or password from the generic URL", () => {
    expect(edge).not.toContain("auth.admin.createUser");
    expect(edge).not.toContain("auth.admin.updateUserById");
    expect(edge).not.toContain("auth.admin.updateUserById");\n    expect(edge).not.toContain("auth.admin.createUser");
    expect(action).not.toContain("password");
  });

  it("routes activated accounts to the existing student login", () => {
    expect(action).toContain('if (status === "login")');
    expect(action).toContain('redirect("/login/student")');
  });

  it("keeps first access blocked until secure verification exists", () => {
    expect(action).toContain('if (status === "pending")');
    expect(action).toContain('redirect("/acceso?state=pending")');
    expect(page).toContain("acceso inicial todavía no está activado");
  });
});
