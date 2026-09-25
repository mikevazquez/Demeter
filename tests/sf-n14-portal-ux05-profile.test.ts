import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("SF-N14 PORTAL UX-05 Perfil", () => {
  const profile = source("app/student/perfil/page.tsx");
  const picker = source("app/student/perfil/AvatarFilePicker.tsx");
  const actions = source("app/student/actions.ts");

  it("presents Profile as account settings and secondary navigation", () => {
    expect(profile).toContain('data-profile-block="identity"');
    expect(profile).toContain("Mi cuenta");
    expect(profile).toContain("Alumna de Demeter");
    expect(profile).toContain("Editar mis datos");
    expect(profile).not.toContain("Accesos rápidos");
    expect(profile).not.toContain("Studio Flow");
  });

  it("separates Demeter-managed identity from editable onboarding fields", () => {
    expect(profile).toContain("Datos administrados por Demeter");
    expect(profile).toContain("Datos que puedes cambiar");
    expect(profile).not.toContain("Solo lectura");
    expect(profile).not.toContain('name="first_name"');
    expect(profile).not.toContain('name="last_name"');
    expect(profile).not.toContain('name="phone"');
    expect(profile).toContain('name="email"');
    expect(profile).toContain('type="email"');
    expect(profile).toContain('name="birth_date"');
    expect(profile).toContain('type="date"');
  });

  it("previews a new avatar before explicit confirmation", () => {
    expect(profile).toContain("AvatarFilePicker");
    expect(profile).toContain("Usar esta foto");
    expect(picker).toContain("URL.createObjectURL");
    expect(picker).toContain("Vista previa lista");
  });

  it("preserves the approved pending, success and recovery feedback", () => {
    expect(profile).toContain('pendingLabel="Guardando…"');
    expect(profile).toContain('title="Tu perfil está actualizado"');
    expect(profile).toContain('title="Revisa tus datos"');
    expect(profile).toContain('dismissHref="/student/perfil"');
    expect(profile).toContain('query.edit === "1" || Boolean(query.error)');
  });

  it("keeps the canonical profile mutation and avoids direct frontend identity writes", () => {
    expect(actions).toContain('supabase.rpc("student_update_reward_onboarding_profile"');
    expect(actions).not.toContain('.from("persons")');
    expect(actions).not.toContain('.from("person_contacts")');
    expect(actions).not.toContain('formData.get("first_name")');
    expect(actions).not.toContain('formData.get("last_name")');
    expect(actions).not.toContain('formData.get("phone")');
  });

  it("groups only secondary account surfaces and does not duplicate Mis clases", () => {
    expect(profile).toContain('href="/student/paquete"');
    expect(profile).toContain('href="/student/movimientos"');
    expect(profile).toContain('href="/student/pagos"');
    expect(profile).toContain('href="/student/documentos"');
    expect(profile).toContain('href="/student/perfil/notificaciones"');
    expect(profile).toContain('href="/student/evaluaciones"');
    expect(profile).toContain('href="/student/recompensas"');
    expect(profile).not.toContain('href="/student/mis-clases"');
  });
});
