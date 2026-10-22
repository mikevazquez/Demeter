import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  dynamicUrlSuffix,
  maskEmail,
  newPasswordError,
  parseRecoveryHash,
  passwordRuleState,
  phoneTail,
  recoveryTemplateShape,
  sessionCameFromRecovery,
} from "@/lib/auth/password-recovery-core";

function token(claims: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256" })}.${encode(claims)}.signature`;
}

describe("AUTH-REC-01 password rules", () => {
  it("requires 8 characters, letters, numbers and a matching confirmation", () => {
    expect(newPasswordError("abc12", "abc12")).toBe("weak");
    expect(newPasswordError("abcdefgh", "abcdefgh")).toBe("weak");
    expect(newPasswordError("12345678", "12345678")).toBe("weak");
    expect(newPasswordError("pole2026", "pole2027")).toBe("mismatch");
    expect(newPasswordError("pole2026", "pole2026")).toBeNull();
    expect(passwordRuleState("Ñandú2026", "Ñandú2026")).toEqual({
      length: true,
      lettersAndNumbers: true,
      matches: true,
    });
  });
});

describe("AUTH-REC-01 masking", () => {
  it("shows only the phone tail and the email initial", () => {
    expect(phoneTail("+523312345678")).toBe("78");
    expect(maskEmail("Mike@Demeter.mx")).toBe("m•••@demeter.mx");
    expect(maskEmail("sin-arroba")).toBeNull();
  });
});

describe("AUTH-REC-01 Meta template with dynamic link", () => {
  const components = [
    { type: "BODY", text: "Hola {{1}}, crea tu contraseña con el botón." },
    {
      type: "BUTTONS",
      buttons: [
        { type: "QUICK_REPLY", text: "No fui yo" },
        { type: "URL", text: "Crear contraseña", url: "https://app.demeter.mx/{{1}}" },
      ],
    },
  ];

  it("finds the body variables and the dynamic URL button", () => {
    expect(recoveryTemplateShape(components)).toEqual({
      bodyVariableCount: 1,
      urlButtonIndex: 1,
      urlButtonTemplate: "https://app.demeter.mx/{{1}}",
    });
  });

  it("rejects templates whose button has a fixed URL", () => {
    expect(
      recoveryTemplateShape([
        { type: "BUTTONS", buttons: [{ type: "URL", url: "https://app.demeter.mx/login" }] },
      ]).urlButtonIndex,
    ).toBeNull();
  });

  it("builds the suffix only when the link lives under the template domain", () => {
    expect(
      dynamicUrlSuffix(
        "https://app.demeter.mx/{{1}}",
        "https://app.demeter.mx/login/student/recuperar/nueva?token_hash=abc",
      ),
    ).toBe("login/student/recuperar/nueva?token_hash=abc");
    expect(
      dynamicUrlSuffix("https://app.demeter.mx/{{1}}", "https://preview.vercel.app/login"),
    ).toBeNull();
    expect(
      dynamicUrlSuffix("https://app.demeter.mx/login", "https://app.demeter.mx/login"),
    ).toBeNull();
  });
});

describe("AUTH-REC-01 recovery session", () => {
  const now = 1_800_000_000;

  it("accepts only recent recovery sessions", () => {
    expect(
      sessionCameFromRecovery(token({ amr: [{ method: "recovery", timestamp: now - 60 }] }), now),
    ).toBe(true);
    expect(
      sessionCameFromRecovery(token({ amr: [{ method: "recovery", timestamp: now - 7200 }] }), now),
    ).toBe(false);
    expect(
      sessionCameFromRecovery(token({ amr: [{ method: "password", timestamp: now }] }), now),
    ).toBe(false);
    expect(sessionCameFromRecovery("not-a-token", now)).toBe(false);
  });

  it("reads the implicit-flow fragment", () => {
    expect(parseRecoveryHash("#access_token=a&refresh_token=r&type=recovery")).toEqual({
      kind: "session",
      accessToken: "a",
      refreshToken: "r",
    });
    expect(parseRecoveryHash("#error=access_denied&error_code=otp_expired").kind).toBe("error");
    expect(parseRecoveryHash("").kind).toBe("none");
  });
});

describe("AUTH-REC-01 wiring", () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

  it("spends the student token only on submit, never when the page opens", () => {
    expect(read("app/login/student/recuperar/nueva/page.tsx")).not.toContain("verifyOtp");
    expect(read("app/login/recovery-actions.ts")).toContain('type: "recovery"');
  });

  it("links the login card to both recovery portals", () => {
    const card = read("app/login/login-card.tsx");
    expect(card).toContain("/login/student/recuperar");
    expect(card).toContain("/login/studio/recuperar");
  });

  it("uses the implicit flow for staff email links", () => {
    expect(read("lib/auth/password-recovery.ts")).toContain('flowType: "implicit"');
  });

  it("rate limits through service-only functions", () => {
    const migration = read(
      "supabase/migrations/20261022150000_auth_rec_01_password_recovery_requests.sql",
    );
    expect(migration).toContain("v_identifier_count >= 3");
    expect(migration).toContain("from public, anon, authenticated");
  });
});
