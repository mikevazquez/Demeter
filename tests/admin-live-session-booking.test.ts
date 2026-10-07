import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("admin live class booking", () => {
  it("allows schedule staff to book only while a class is in progress", () => {
    const migration = source("supabase/migrations/20261007011655_admin_live_session_booking.sql");

    expect(migration).toContain("v_is_staff := private.has_capability");
    expect(migration).toContain("not v_is_staff");
    expect(migration).toContain("v_session.ends_at<=now()");
    expect(migration).toContain("'session_not_bookable'");
    expect(migration).toContain("'schedule.write'");
  });

  it("shows ongoing sessions in the admin first-reservation picker", () => {
    const page = source("app/admin/alumnas/[studentId]/reservar/page.tsx");

    expect(page).toContain('.gt("ends_at", now.toISOString())');
    expect(page).not.toContain('.gt("starts_at", new Date().toISOString())');
  });

  it("keeps the student booking page on its existing self-service flow", () => {
    const studentPage = source("app/student/reservar/page.tsx");

    expect(studentPage).toContain("getStudentPortalContext");
    expect(studentPage).not.toContain('supabase.rpc("booking_eligibility"');
  });
});
