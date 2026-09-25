import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F10/N14 student home and profile UAT contracts", () => {
  const homePage = source("app/student/page.tsx");
  const profilePage = source("app/student/perfil/page.tsx");
  const actions = source("app/student/actions.ts");
  const profileMigration = source(
    "supabase/migrations/20260916040850_f10_profile_identity_readonly.sql",
  );

  it("shows the next class before package context on Home", () => {
    expect(homePage.indexOf('data-home-block="next-class"')).toBeLessThan(
      homePage.indexOf('data-home-block="package"'),
    );
    expect(homePage).toContain("Reserva tu próxima clase");
    expect(homePage).toContain("Activa tu paquete");
    expect(homePage).toContain("clases disponibles");
  });

  it("delegates class discovery to Reservar and class management to Mis clases", () => {
    expect(homePage).toContain('"/student/reservar"');
    expect(homePage).toContain('"/student/mis-clases"');
    expect(homePage).not.toContain('supabase.rpc("student_schedule_feed"');
    expect(homePage).not.toContain("cancelStudentReservationAction");
  });

  it("keeps the canonical cancellation engine available in the dedicated flow", () => {
    const cancelPage = source("app/student/mis-clases/[reservationId]/cancelar/page.tsx");
    expect(cancelPage).toContain("cancelStudentReservationAction");
    expect(actions).toContain('supabase.rpc("student_cancel_own_reservation"');
  });

  it("separates Demeter-managed identity from student-editable profile data", () => {
    expect(profilePage).not.toContain("Solo lectura");
    expect(profilePage).toContain("Datos administrados por Demeter");
    expect(profilePage).toContain("Datos que puedes cambiar");
    expect(profilePage).not.toContain('name="first_name"');
    expect(profilePage).not.toContain('name="last_name"');
    expect(profilePage).not.toContain('name="phone"');
    expect(profilePage).toContain('name="email"');
    expect(profilePage).toContain('name="birth_date"');
    expect(actions).not.toContain('formData.get("first_name")');
    expect(actions).not.toContain('formData.get("last_name")');
    expect(actions).not.toContain('formData.get("phone")');
  });

  it("uses Profile as secondary navigation rather than a second dashboard", () => {
    expect(profilePage).toContain('title="Mis datos"');
    expect(profilePage).toContain('title="Nivel técnico y evaluaciones"');
    expect(profilePage).toContain('title="Mi medalla y beneficios"');
    expect(profilePage).toContain('title="Uso de mis clases"');
    expect(profilePage).toContain('title="Mis pagos"');
    expect(profilePage).not.toContain("Accesos rápidos");
    expect(profilePage).not.toContain('title="Mis clases"');
  });

  it("enforces identity immutability in the database contract too", () => {
    expect(profileMigration).not.toContain("update public.persons set first_name");
    expect(profileMigration).not.toContain("last_name=v_last");
    expect(profileMigration).toContain("set email=v_email,updated_at=now()");
  });
});
