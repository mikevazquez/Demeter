import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F11 coach walk-in and finalization contract", () => {
  it("uses an exact-phone walk-in lookup without exposing a global student browser", () => {
    const migration = source(
      "supabase/migrations/20260916154500_f11_coach_walkin_exact_lookup.sql",
    );
    const form = source("app/coach/clases/[sessionId]/walk-in/walk-in-form.tsx");

    expect(migration).toContain("target_phone text");
    expect(migration).toContain("pc.value = target_phone");
    expect(migration).toContain("private.can_manage_attendance_session");
    expect(migration).not.toContain("ilike");
    expect(migration).not.toContain("email");
    expect(form).toContain("Buscar por teléfono exacto");
    expect(form).not.toContain("students.read");
  });

  it("reuses canonical F8 walk-in RPCs and never creates a sale or acquisition", () => {
    const actions = source("app/coach/actions.ts");

    expect(actions).toContain('supabase.rpc("add_existing_walkin_student"');
    expect(actions).toContain('supabase.rpc("create_walkin_student"');
    expect(actions).not.toContain('.from("sales")');
    expect(actions).not.toContain('.from("product_acquisitions")');
  });

  it("keeps finalized Coach attendance read-only after automatic close", () => {
    const finalized = source("app/coach/clases/[sessionId]/finalizada/page.tsx");
    const closeMigration = source(
      "supabase/migrations/20260922173000_kiosco01_automatic_session_close.sql",
    );
    const scopeMigration = source(
      "supabase/migrations/20260922175000_kiosco01_attendance_edit_scope.sql",
    );

    expect(closeMigration).toContain("private.finalize_due_sessions()");
    expect(closeMigration).toContain("'studio-flow-finalize-due-sessions'");
    expect(finalized).toContain("Vista de consulta para Coach");
    expect(finalized).toContain("las realiza Administración");
    expect(finalized).not.toContain("correctCoachAttendanceAction");
    expect(scopeMigration).toContain("if v_session.status = 'completed' then");
    expect(scopeMigration).toContain("if not v_is_admin then");
  });
});
