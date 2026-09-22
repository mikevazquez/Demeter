import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F8 attendance contracts", () => {
  it("keeps no-show visible in the roster without counting it as occupied capacity", () => {
    const page = source("app/admin/page.tsx");
    const capacityFix = source("supabase/migrations/20260915203911_f8_walkin_capacity_fix.sql");

    expect(page).toContain('.in("status", ["reserved", "attended", "no_show"])');
    expect(page).toContain('new Set(["reserved", "attended"])');
    expect(capacityFix).toContain("status in ('reserved', 'attended')");
    expect(capacityFix).not.toContain("status in ('reserved', 'attended', 'no_show')");
  });

  it("keeps the selected attendance state visibly marked", () => {
    const operations = source("app/admin/hoy/SessionOperations.tsx");
    const styles = source("app/admin/roster-uat.css");

    expect(operations).toContain('"is-selected is-attended"');
    expect(operations).toContain('"is-selected is-no-show"');
    expect(operations).toContain("aria-pressed");
    expect(styles).toContain("button.is-selected");
    expect(styles).toContain("button.is-attended");
    expect(styles).toContain("button.is-no-show");
  });

  it("allows an existing student without valid commercial eligibility to join as a walk-in", () => {
    const actions = source("app/admin/actions.ts");
    const operations = source("app/admin/hoy/SessionOperations.tsx");
    const existingStudentForm = source("app/admin/hoy/ExistingStudentAddForm.tsx");
    const migration = source(
      "supabase/migrations/20260915215839_f8_existing_walkin_without_package.sql",
    );

    expect(actions).toContain("commercialPendingReasons");
    expect(actions).toContain('"no_active_product", "outside_product", "no_credits"');
    expect(actions).toContain('supabase.rpc("add_existing_walkin_student"');
    expect(existingStudentForm).toContain("walk-in / venta pendiente");
    expect(existingStudentForm).not.toContain("disabled={!candidate.eligible}");
    expect(migration).toContain("commercial_pending");
    expect(migration).toContain("'attendance.write'");
    expect(migration).toContain("status in ('reserved', 'attended')");
  });

  it("requires explicit traceable corrections after finalization", () => {
    const migration = source("supabase/migrations/20260915190000_f8_attendance_core.sql");
    const operations = source("app/admin/hoy/SessionOperations.tsx");

    expect(migration).toContain("correction_reason_required");
    expect(migration).toContain("insert into public.attendance_corrections");
    expect(migration).toContain("from_status, to_status, reason, corrected_by");
    expect(operations).toContain("Corrección");
    expect(operations).toContain('name="reason"');
    expect(operations).toContain("attendance-corrected");
  });

  it("converts the finite hold into one final consumption and leaves unlimited products untouched", () => {
    const migration = source(
      "supabase/migrations/20260915204501_f8_finalize_credit_hold_conversion.sql",
    );

    expect(migration).toContain("v_reservation.credits_held");
    expect(migration).toContain("not coalesce(v_reservation.unlimited, false)");
    expect(migration).toContain("cl.movement_type = 'reserve'");
    expect(migration).toContain("'release'");
    expect(migration).toContain("'consume'");
    expect(migration).toContain("on conflict (reservation_id, movement_type) do nothing");
  });

  it("keeps attendance actions behind the attendance capability", () => {
    const actions = source("app/admin/actions.ts");

    expect(actions).toContain("getAdminContext(CAPABILITIES.ATTENDANCE_WRITE)");
    expect(actions).toContain("if (!can(CAPABILITIES.ATTENDANCE_WRITE))");
  });
});
