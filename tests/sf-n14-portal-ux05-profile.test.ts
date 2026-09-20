import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("SF-N14 PORTAL UX-05 Perfil", () => {
  const profile = source("app/student/perfil/page.tsx");
  const actions = source("app/student/actions.ts");

  it("presents Perfil as a compact account surface with approved Studio Flow styling", () => {
    expect(profile).toContain('data-profile-block="identity"');
    expect(profile).toContain('data-profile-block="accesses"');
    expect(profile).toContain("Mi cuenta");
    expect(profile).toContain("bg-fuchsia-600");
    expect(profile).toContain("Editar correo");
  });

  it("keeps identity display-only and exposes only email editing", () => {
    expect(profile.match(/Solo lectura/g)?.length).toBeGreaterThanOrEqual(3);
    expect(profile).not.toContain('name="first_name"');
    expect(profile).not.toContain('name="last_name"');
    expect(profile).not.toContain('name="phone"');
    expect(profile).toContain('name="email"');
    expect(profile).toContain('type="email"');
  });

  it("preserves the approved pending, success and recovery feedback", () => {
    expect(profile).toContain('pendingLabel="Guardando…"');
    expect(profile).toContain('title="Tu correo está actualizado"');
    expect(profile).toContain('title="Revisa tus datos"');
    expect(profile).toContain('dismissHref="/student/perfil"');
    expect(profile).toContain('query.edit === "1" || Boolean(query.error)');
  });

  it("keeps the canonical profile mutation and avoids direct frontend identity writes", () => {
    expect(actions).toContain('supabase.rpc("student_update_own_profile"');
    expect(actions).not.toContain('.from("persons")');
    expect(actions).not.toContain('.from("person_contacts")');
    expect(actions).not.toContain('formData.get("first_name")');
    expect(actions).not.toContain('formData.get("last_name")');
    expect(actions).not.toContain('formData.get("phone")');
  });

  it("links only to existing account surfaces in the approved portal", () => {
    expect(profile).toContain('href="/student/paquete"');
    expect(profile).toContain('href="/student/mis-clases"');
    expect(profile).toContain('href="/student/movimientos"');
    expect(profile).toContain('href="/student/pagos"');
    expect(profile).toContain('href="/student/documentos"');
  });
});
