import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("SF-N14 student phone login UX", () => {
  const login = source("app/login/login-card.tsx");
  const auth = source("app/auth/actions.ts");
  const phone = source("lib/phone.ts");

  it("lets students enter only their 10-digit Mexican number", () => {
    expect(login).toContain("+52");
    expect(login).toContain('pattern="[0-9]{10}"');
    expect(login).toContain("maxLength={10}");
    expect(login).toContain("Escribe tus 10 dígitos. Nosotros agregamos +52 automáticamente.");
  });

  it("normalizes the student phone on the server before authentication", () => {
    expect(auth).toContain("normalizeMexicanPhone");
    expect(phone).toContain('normalized = `+52${digits}`');
  });

  it("accepts pasted country-code values in the UI without exposing E.164 complexity", () => {
    expect(login).toContain('digits.startsWith("52")');
    expect(login).toContain("digits.slice(2, 12)");
  });
});
