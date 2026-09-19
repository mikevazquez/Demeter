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
    expect(login).toContain('pattern="(?:[0-9]{10}|\\+[1-9][0-9]{7,14})"');
    expect(login).toContain("maxLength={16}");
    expect(login).toContain("México: escribe tus 10 dígitos. Agregamos +52 automáticamente.");
  });

  it("normalizes the student phone on the server before authentication", () => {
    expect(auth).toContain("normalizeMexicanPhone");
    expect(phone).toContain('normalized = `+52${digits}`');
  });

  it("preserves full E.164 numbers for sandbox and international compatibility", () => {
    expect(login).toContain('raw.startsWith("+")');
    expect(login).toContain('!studentPhone.startsWith("+")');
    expect(login).toContain("digits.slice(0, 15)");
  });
});
