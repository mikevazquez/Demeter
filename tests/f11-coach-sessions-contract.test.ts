import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F11 coach session scope", () => {
  it("scopes instructor reads through the authenticated instructor identity", () => {
    const migration = source(
      "supabase/migrations/20260916141700_f11_coach_scope_hardening_and_feed.sql",
    );

    expect(migration).toContain("private.current_instructor_id");
    expect(migration).toContain(
      "private.is_current_instructor_assignment(studio_id, instructor_id)",
    );
    expect(migration).toContain("private.is_current_instructor_session(studio_id, session_id)");
    expect(migration).not.toContain(
      "array['owner'::public.studio_role, 'admin'::public.studio_role, 'instructor'::public.studio_role]",
    );
  });

  it("uses a coach feed that never accepts an arbitrary instructor id", () => {
    const migration = source("supabase/migrations/20260916142100_f11_coach_feed_local_dates.sql");
    const page = source("app/coach/page.tsx");

    expect(migration).toContain("public.coach_my_sessions(");
    expect(migration).toContain("target_studio_id uuid");
    expect(migration).toContain("target_start date");
    expect(migration).not.toContain("target_instructor_id");
    expect(page).toContain('supabase.rpc("coach_my_sessions"');
    expect(page).not.toContain('.from("class_sessions")');
  });

  it("protects class detail with the same authenticated assignment", () => {
    const migration = source("supabase/migrations/20260916142600_f11_coach_session_detail.sql");
    const page = source("app/coach/clases/[sessionId]/page.tsx");

    expect(migration).toContain("cs.instructor_id = v_instructor_id");
    expect(migration).toContain("raise exception 'session_not_available'");
    expect(page).toContain('supabase.rpc("coach_session_detail"');
    expect(page).toContain("notFound()");
  });
});
