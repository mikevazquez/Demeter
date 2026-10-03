import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi WhatsApp service cancellation bridge", () => {
  const actions = source("lib/assistant/action-tools.ts");
  const migration = source(
    "supabase/migrations/20261003172400_demi_service_cancellation_runtime.sql",
  );

  it("uses the service cancellation RPC in service mode", () => {
    expect(actions).toContain("service_cancel_reservation");
    expect(actions).toContain("ctx.serviceMode");
  });

  it("keeps the service cancellation RPC restricted and preserves cancellation rules", () => {
    expect(migration).toContain("private.reservation_cancellation_outcome");
    expect(migration).toContain("private.reservation_credit_should_consume");
    expect(migration).toContain("revoke all on function public.service_cancel_reservation");
    expect(migration).toContain("to service_role;");
  });
});
