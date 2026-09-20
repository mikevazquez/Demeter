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

  it("shows the compact active package as the primary home context", () => {
    expect(homePage.indexOf('data-home-block="package"')).toBeLessThan(
      homePage.indexOf('data-home-block="next-class"'),
    );
    expect(homePage).toContain('data-density="compact"');
    expect(homePage).toContain("Vence");
    expect(homePage).toContain("used_credits");
  });

  it("delegates class discovery to Reservar and class management to Mis clases", () => {
    expect(homePage).toContain('href="/student/reservar"');
    expect(homePage).toContain('href="/student/mis-clases"');
    expect(homePage).not.toContain('supabase.rpc("student_schedule_feed"');
    expect(homePage).not.toContain("cancelStudentReservationAction");
  });

  it("keeps the canonical cancellation engine available in the dedicated flow", () => {
    const cancelPage = source("app/student/mis-clases/[reservationId]/cancelar/page.tsx");
    expect(cancelPage).toContain("cancelStudentReservationAction");
    expect(actions).toContain('supabase.rpc("student_cancel_own_reservation"');
  });

  it("keeps identity display-only while email remains the only editable profile field", () => {
    expect(profilePage.match(/Solo lectura/g)?.length).toBeGreaterThanOrEqual(3);
    expect(profilePage).not.toContain('name="first_name"');
    expect(profilePage).not.toContain('name="last_name"');
    expect(profilePage).not.toContain('name="phone"');
    expect(profilePage).toContain('name="email"');
    expect(actions).not.toContain('formData.get("first_name")');
    expect(actions).not.toContain('formData.get("last_name")');
    expect(actions).not.toContain('formData.get("phone")');
  });

  it("enforces identity immutability in the database contract too", () => {
    expect(profileMigration).not.toContain("update public.persons set first_name");
    expect(profileMigration).not.toContain("last_name=v_last");
    expect(profileMigration).toContain("set email=v_email,updated_at=now()");
  });
});
