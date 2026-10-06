import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Demi transfer payment-method schema", () => {
  const migration = source("supabase/migrations/20261006043000_studio_payment_methods.sql");
  const transfer = source(
    "supabase/migrations/20261003172800_demi_provisional_transfer_packages.sql",
  );

  it("versions the payment method table required by transfer purchases", () => {
    expect(migration).toContain("create table if not exists public.studio_payment_methods");
    expect(migration).toContain("'bank_transfer'");
    expect(migration).toContain("'transfer'");
    expect(migration).toContain("on conflict (studio_id, code) do nothing");
  });

  it("keeps tenant-scoped RLS for reads and owner writes", () => {
    expect(migration).toContain("studio_payment_methods_read");
    expect(migration).toContain("studio_payment_methods_write");
    expect(migration).toContain("private.has_capability");
    expect(migration).toContain("private.has_studio_role");
  });

  it("satisfies the dependency used by the transfer purchase RPC", () => {
    expect(transfer).toContain("from public.studio_payment_methods spm");
    expect(transfer).toContain("spm.code='bank_transfer' or spm.category='transfer'");
  });
});
