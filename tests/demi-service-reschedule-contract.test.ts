import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi WhatsApp service reschedule bridge", () => {
  const actions = source("lib/assistant/action-tools.ts");
  const migration = source(
    "supabase/migrations/20261002231000_demi_service_reschedule_runtime.sql",
  );

  it("uses service eligibility and service reschedule in WhatsApp mode", () => {
    expect(actions).toContain("service_booking_eligibility");
    expect(actions).toContain("service_reschedule_student_reservation");
    expect(actions).toContain("ctx.serviceMode");
  });

  it("keeps reschedule atomic by failing the transaction if the new booking fails", () => {
    expect(migration).toContain("service_cancel_reservation");
    expect(migration).toContain("service_book_student");
    expect(migration).toContain("raise exception 'reschedule_booking_failed:%'");
  });

  it("restricts the reschedule bridge to service_role", () => {
    expect(migration).toContain(
      "revoke all on function public.service_reschedule_student_reservation",
    );
    expect(migration).toContain("to service_role;");
  });
});
