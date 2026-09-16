import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F10 student auth diagnostics", () => {
  it("distinguishes disabled phone auth from invalid credentials", () => {
    const actions = source("app/auth/actions.ts");
    const card = source("app/login/login-card.tsx");

    expect(actions).toContain('error.code === "phone_provider_disabled"');
    expect(actions).toContain('message.includes("phone logins are disabled")');
    expect(actions).toContain('return "phone_disabled"');
    expect(card).toContain("phone_disabled:");
    expect(card).toContain("Habilita Phone en Authentication → Providers");
  });

  it("keeps normal bad credentials generic", () => {
    const actions = source("app/auth/actions.ts");
    const card = source("app/login/login-card.tsx");

    expect(actions).toContain('return "invalid"');
    expect(card).toContain('invalid: "El teléfono o la contraseña no son correctos."');
  });
});
