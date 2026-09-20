import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("ADMIN-UX-01 approved login visual contract", () => {
  const card = source("app/login/login-card.tsx");
  const styles = source("app/globals.css");

  it("uses the approved Demeter branded login composition", () => {
    expect(card).toContain("DemeterBrand");
    expect(card).toContain('className="auth-brand"');
    expect(card).toContain('className="auth-back-button"');
    expect(card).not.toContain("Studio Flow");
    expect(styles).toContain(".auth-login-card");
    expect(styles).toContain("background: transparent");
    expect(styles).toContain("border: 0");
  });

  it("keeps the approved compact copy for Studio and Student", () => {
    expect(card).toContain('title: "Acceso al estudio"');
    expect(card).toContain('copy: "Entra con la cuenta que usas para trabajar en el estudio."');
    expect(card).toContain('title: "Portal de alumna"');
    expect(card).toContain('copy: "Entra con tu número de teléfono y contraseña."');
    expect(card).toContain('placeholder="tu@demeter.com"');
    expect(card).toContain('placeholder="33 1234 5678"');
  });

  it("renders icon fields, remember row and the approved portal switch", () => {
    expect(card).toContain("MailIcon");
    expect(card).toContain("PhoneIcon");
    expect(card).toContain("LockIcon");
    expect(card).toContain("¿Olvidaste tu contraseña?");
    expect(card).toContain("Recordarme");
    expect(card).toContain('className="auth-divider"');
    expect(card).toContain('className="auth-switch-button"');
    expect(card).toContain('"Acceso al estudio" : "Soy alumna"');
  });

  it("preserves loading feedback and password visibility behavior", () => {
    expect(card).toContain("useFormStatus");
    expect(card).toContain('pending ? "Entrando…" : "Entrar"');
    expect(card).toContain("aria-busy={pending}");
    expect(card).toContain("setPasswordVisible");
    expect(card).toContain("EyeIcon");
  });

  it("keeps the mobile login compact and viewport-safe", () => {
    expect(styles).toContain("min-height: 100dvh");
    expect(styles).toContain("max-width: 390px");
    expect(styles).toContain("env(safe-area-inset-top)");
    expect(styles).toContain("env(safe-area-inset-bottom)");
  });
});
