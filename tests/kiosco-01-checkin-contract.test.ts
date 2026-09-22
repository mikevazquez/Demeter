import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("KIOSCO-01 check-in contracts", () => {
  const migration = source("supabase/migrations/20260922170000_kiosco01_checkin_core.sql");

  it("creates one opaque token per valid reservation and never models waitlist as a QR source", () => {
    expect(migration).toContain("reservation_checkin_tokens");
    expect(migration).toContain(
      "constraint reservation_checkin_tokens_reservation_unique unique (reservation_id)",
    );
    expect(migration).toContain("extensions.hmac(");
    expect(migration).toContain("extensions.digest(");
    expect(migration).toContain("where r.status in ('reserved','attended')");
    expect(migration).not.toContain("waitlist_checkin");
  });

  it("revokes cancelled reservations and cancelled sessions", () => {
    expect(migration).toContain("cancelled_on_time");
    expect(migration).toContain("cancelled_late");
    expect(migration).toContain("cancelled_by_studio");
    expect(migration).toContain("class_session_checkin_token_revoke");
    expect(migration).toContain("new.status = 'cancelled'");
  });

  it("uses the approved -30 minute to session-end check-in window", () => {
    expect(migration).toContain("v_session.starts_at - interval '30 minutes'");
    expect(migration).toContain("now() >= v_session.ends_at");
    expect(migration).toContain("'too_early'");
    expect(migration).toContain("'session_finished'");
  });

  it("marks attendance idempotently and emits one domain event", () => {
    expect(migration).toContain("status = 'attended'");
    expect(migration).toContain(
      "constraint attendance_checkins_reservation_unique unique (reservation_id)",
    );
    expect(migration).toContain("on conflict (reservation_id) do nothing");
    expect(migration).toContain("'attendance.checked_in'");
    expect(migration).toContain("'attendance:checked_in:' || v_reservation.id::text");
    expect(migration).toContain("'already_attended'");
  });

  it("locks session before reservation to avoid the close/check-in race", () => {
    const sessionLock = migration.indexOf("where id = v_session_id\n  for update;");
    const reservationLock = migration.indexOf("and session_id = v_session.id\n  for update;");

    expect(sessionLock).toBeGreaterThan(-1);
    expect(reservationLock).toBeGreaterThan(sessionLock);
  });

  it("allows students to retrieve only the QR for their own reservation or hosted guest", () => {
    expect(migration).toContain("public.student_reservation_checkin_token");
    expect(migration).toContain("v_reservation.student_user_id = v_uid");
    expect(migration).toContain("host.id = v_reservation.host_reservation_id");
    expect(migration).toContain(
      "private.has_capability(v_reservation.studio_id, 'attendance.write')",
    );
  });

  it("keeps the API authenticated and delegates the decision to the canonical RPC", () => {
    const route = source("app/api/check-in/route.ts");

    expect(route).toContain("supabase.auth.getUser()");
    expect(route).toContain('supabase.rpc("check_in_reservation"');
    expect(route).toContain('"unauthorized"');
    expect(route).toContain('"forbidden"');
    expect(route).toContain('"Cache-Control": "no-store"');
  });
});
