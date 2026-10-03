import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi WhatsApp service booking bridge", () => {
  const actions = source("lib/assistant/action-tools.ts");
  const migration = source("supabase/migrations/20261003172200_demi_service_booking_runtime.sql");

  it("uses service-only eligibility for WhatsApp runtime", () => {
    expect(actions).toContain("service_booking_eligibility");
    expect(actions).toContain("ctx.serviceMode");
    expect(migration).toContain("private.booking_eligibility_core");
    expect(migration).toContain("to service_role;");
    expect(migration).toContain("revoke all on function public.service_booking_eligibility");
  });

  it("uses the service booking path for confirmed WhatsApp bookings", () => {
    expect(actions).toContain("service_book_student");
    expect(migration).toContain("'assistant_whatsapp'");
    expect(migration).toContain("revoke all on function public.service_book_student");
  });
});
