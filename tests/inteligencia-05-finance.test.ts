import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("INTEL-05 financial intelligence", () => {
  const migration = source("supabase/migrations/20260926123500_inteligencia05_expenses.sql");
  const actions = source("app/admin/inteligencia/actions.ts");

  it("stores tenant-scoped effective-date expenses behind RLS", () => {
    expect(migration).toContain("create table if not exists public.studio_expenses");
    expect(migration).toContain("effective_on date not null");
    expect(migration).toContain("alter table public.studio_expenses enable row level security");
    expect(migration).toContain("private.has_capability(studio_id, 'sales.write')");
  });

  it("validates expense writes server-side", () => {
    expect(actions).toContain("EXPENSE_CATEGORIES");
    expect(actions).toContain("Math.round(amount * 100)");
    expect(actions).toContain("CAPABILITIES.SALES_WRITE");
    expect(actions).toContain('.from("studio_expenses").insert');
  });
});
