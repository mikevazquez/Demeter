import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const home = readFileSync(join(process.cwd(), "app/student/page.tsx"), "utf8");
const experience = readFileSync(
  join(process.cwd(), "app/student/components/BirthdayGiftExperience.tsx"),
  "utf8",
);
const snapshotMigration = readFileSync(
  join(process.cwd(), "supabase/migrations/20261020022500_birthday_pass_snapshot_day.sql"),
  "utf8",
);

describe("Cumpleaños Demeter · B2 student portal", () => {
  it("loads the birthday pass snapshot into the real student home", () => {
    expect(home).toContain('supabase.rpc("student_birthday_pass_snapshot")');
    expect(home).toContain("<BirthdayGiftExperience");
    expect(home).toContain("pass={birthdayPass}");
  });

  it("keeps birthday data private while exposing only the day-state needed by the UI", () => {
    expect(snapshotMigration).toContain("'is_birthday',v_is_birthday");
    expect(snapshotMigration).not.toContain("'birth_date'");
    expect(snapshotMigration).not.toContain("'birth_year'");
  });

  it("matches the approved Claude artifact states", () => {
    expect(experience).toContain("Feliz cumpleaños");
    expect(experience).toContain("Este mes te festejamos");
    expect(experience).toContain("Tu regalo te espera");
    expect(experience).toContain("Abrir mi regalo");
    expect(experience).toContain("Un pase de clase para ti");
    expect(experience).toContain("Úsalo tú o regálaselo a una amiga");
    expect(experience).toContain("Regalo usado");
  });

  it("keeps the pass separate from the normal package in the copy and navigation", () => {
    expect(experience).toContain("Es un saldo aparte");
    expect(experience).toContain('href="/student/paquete"');
    expect(experience).toContain('href="/student/reservar"');
  });

  it("marks the private birthday message for the exact birthday only", () => {
    expect(experience).toContain('pass.is_birthday ? (');
    expect(experience).toContain("Solo tú ves este mensaje");
    expect(experience).toContain('data-home-block="birthday-message"');
    expect(experience).toContain('data-home-block="birthday-pass"');
  });

  it("keeps the visual UAT override restricted to Vercel Preview", () => {
    expect(home).toContain('process.env.VERCEL_ENV === "preview"');
    expect(home).toContain('query.birthday_demo === "day"');
    expect(home).toContain('query.birthday_demo === "month"');
    expect(home).toContain('query.birthday_demo === "used"');
  });
});
