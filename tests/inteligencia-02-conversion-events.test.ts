import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("INTEL-02 conversion event intelligence", () => {
  const adminActions = source("app/admin/actions.ts");
  const adminRoster = source("app/admin/hoy/SessionOperations.tsx");
  const studentCancel = source("app/student/mis-clases/[reservationId]/cancelar/page.tsx");

  it("requires structured cancellation reasons in admin and student flows", () => {
    expect(adminActions).toContain("CANCELLATION_REASON_CODES");
    expect(adminActions).toContain("target_reason: reason");
    expect(adminActions).toContain('supabase.rpc("cancel_reservation"');
    expect(adminRoster).toContain('name="reason"');
    expect(adminRoster).toContain('value="schedule_conflict"');
    expect(studentCancel).toContain('name="reason"');
    expect(studentCancel).toContain("required");
    expect(studentCancel).toContain('value="prefer_not_say"');
  });
});
