import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi service booking credit revalidation", () => {
  const migration = source(
    "supabase/migrations/20261002224500_demi_service_booking_credit_fix.sql",
  );

  it("recomputes package credits directly under the acquisition lock", () => {
    expect(migration).toContain("from public.credit_ledger cl");
    expect(migration).toContain("where cl.acquisition_id = v_acquisition_id");
    expect(migration).not.toContain("acquisition_credit_balance(v_acquisition_id)");
  });

  it("keeps the service booking RPC restricted to service_role", () => {
    expect(migration).toContain(
      "revoke all on function public.service_book_student",
    );
    expect(migration).toContain("to service_role;");
  });
});
