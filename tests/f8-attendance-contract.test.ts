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
    const page = source("app/admin/page.tsx");

    expect(actions).toContain("getAdminContext(CAPABILITIES.ATTENDANCE_WRITE)");
    expect(page).toContain("can(CAPABILITIES.ATTENDANCE_WRITE)");
    expect(page).toContain("canAttendance && canWriteStudents");
  });
});
