import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F10 student home and profile UAT contracts", () => {
  const homePage = source("app/student/page.tsx");
  const profilePage = source("app/student/perfil/page.tsx");
  const actions = source("app/student/actions.ts");
  const profileMigration = source(
    "supabase/migrations/20260916040850_f10_profile_identity_readonly.sql",
  );

  it("shows one compact package credit summary instead of a duplicated large balance", () => {
    expect(homePage).toContain("Disponibles");
    expect(homePage).toContain("Reservadas");
    expect(homePage).toContain("Utilizadas");
    expect(homePage.match(/activePackage\.available_credits/g)?.length).toBe(1);
    expect(homePage).not.toContain("clases disponibles</span>");
  });

  it("shows a weekly day selector and the selected day's classes on home", () => {
    expect(homePage).toContain("const weekStart = startOfWeek(selectedDate)");
    expect(homePage).toContain('aria-label="Semana anterior"');
    expect(homePage).toContain('aria-label="Semana siguiente"');
    expect(homePage).toContain('supabase.rpc("student_schedule_feed"');
    expect(homePage).toContain("target_start: selectedDate");
    expect(homePage).toContain("target_end: selectedDate");
    expect(homePage).toContain("target_discipline_id: null");
  });

  it("allows an own reservation to be cancelled directly from home", () => {
    expect(homePage).toContain("action={cancelStudentReservationAction}");
    expect(homePage).toContain('name="return_to" value="/student"');
    expect(actions).toContain('return String(formData.get("return_to") ?? "") === "/student"');
    expect(actions).toContain('supabase.rpc("student_cancel_own_reservation"');
  });

  it("keeps name, surname and phone read-only while email remains editable", () => {
    expect(profilePage.match(/readOnly/g)?.length).toBeGreaterThanOrEqual(3);
    expect(profilePage).not.toContain('name="first_name"');
    expect(profilePage).not.toContain('name="last_name"');
    expect(profilePage).toContain('name="email"');
    expect(actions).not.toContain('formData.get("first_name")');
    expect(actions).not.toContain('formData.get("last_name")');
  });

  it("enforces identity immutability in the database contract too", () => {
    expect(profileMigration).not.toContain("update public.persons set first_name");
    expect(profileMigration).not.toContain("last_name=v_last");
    expect(profileMigration).toContain("set email=v_email,updated_at=now()");
  });
});
