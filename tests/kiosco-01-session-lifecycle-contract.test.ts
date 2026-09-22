import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("KIOSCO-01 automatic session lifecycle", () => {
  const closeMigration = source(
    "supabase/migrations/20260922173000_kiosco01_automatic_session_close.sql",
  );
  const tokenExpiry = source(
    "supabase/migrations/20260922173500_kiosco01_token_expiry_on_close.sql",
  );

  it("finalizes only after the programmed end and remains idempotent", () => {
    expect(closeMigration).toContain("if now() < v_session.ends_at then");
    expect(closeMigration).toContain("raise exception 'session_not_ended'");
    expect(closeMigration).toContain("if v_session.status = 'completed' then");
    expect(closeMigration).toContain("'already_finalized', true");
  });

  it("converts unresolved reservations to no-show before completing the session", () => {
    const noShow = closeMigration.indexOf("set status = 'no_show'");
    const completed = closeMigration.indexOf("set status = 'completed'");

    expect(noShow).toBeGreaterThan(-1);
    expect(completed).toBeGreaterThan(noShow);
    expect(closeMigration).toContain("and status = 'reserved'");
  });

  it("keeps the same credit close semantics used by attendance", () => {
    expect(closeMigration).toContain("cl.movement_type = 'reserve'");
    expect(closeMigration).toContain("'release'");
    expect(closeMigration).toContain("'consume'");
    expect(closeMigration).toContain("on conflict (reservation_id, movement_type) do nothing");
    expect(closeMigration).toContain("private.activate_acquisition_on_first_usage");
  });

  it("runs the due-session worker every minute without depending on an authenticated coach", () => {
    expect(closeMigration).toContain("private.finalize_due_sessions()");
    expect(closeMigration).toContain("cs.ends_at <= now()");
    expect(closeMigration).toContain("'studio-flow-finalize-due-sessions'");
    expect(closeMigration).toContain("'* * * * *'");
    expect(closeMigration).toContain("'select private.finalize_due_sessions();'");
  });

  it("uses the same session-first locking order as QR check-in", () => {
    expect(closeMigration).toContain("from public.class_sessions\n  where id = target_session_id\n  for update;");
  });

  it("revokes reservation QR credentials when a session is cancelled or completed", () => {
    expect(tokenExpiry).toContain("new.status in ('cancelled', 'completed')");
    expect(tokenExpiry).toContain("set revoked_at = coalesce(t.revoked_at, now())");
  });
});
