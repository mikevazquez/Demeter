import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("admin live class booking", () => {
  it("limits late booking to schedule staff while the session is in progress", () => {
    const migration = source(
      "supabase/migrations/20261007013000_admin_live_session_booking.sql",
    );

    expect(migration).toContain("v_is_staff := private.has_capability");
    expect(migration).toContain("not v_is_staff");
    expect(migration).toContain("v_session.ends_at<=now()");
    expect(migration).toContain("'session_not_bookable'");
    expect(migration).toContain("'schedule.write'");
  });

  it("preserves the production payment-pending package guard", () => {
    const migration = source(
      "supabase/migrations/20261007013000_admin_live_session_booking.sql",
    );

    expect(migration).toContain("v_has_blocked_acquisition");
    expect(migration).toContain("payment_pending");
    expect(migration).toContain("access_blocked");
  });

  it("shows scheduled classes that are upcoming or in progress", () => {
    const page = source("app/admin/alumnas/[studentId]/reservar/page.tsx");

    expect(page).toContain('.gt("ends_at", now)');
    expect(page).not.toContain('.gt("starts_at", new Date().toISOString())');
  });
});
