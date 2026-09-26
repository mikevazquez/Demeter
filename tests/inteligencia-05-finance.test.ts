import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("INTEL-05 financial intelligence", () => {
  const migration = source(
    "supabase/migrations/20260926123500_inteligencia05_expenses.sql",
  );
  const actions = source("app/admin/inteligencia/actions.ts");
  const intelligence = source("app/admin/inteligencia/page.tsx");

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

  it("calculates operating result from cash received minus registered expenses", () => {
    expect(intelligence).toContain("currentOperatingResult = currentRevenue - currentExpenseTotal");
    expect(intelligence).toContain("currentOperatingMargin");
    expect(intelligence).toContain('label="Resultado operativo"');
    expect(intelligence).toContain('label="Margen registrado"');
  });

  it("makes expense coverage explicit instead of claiming accounting profit", () => {
    expect(intelligence).toContain("inteligencia operativa, no contabilidad fiscal");
    expect(intelligence).toContain("el resultado estará sobreestimado");
    expect(intelligence).toContain("No interpretes el resultado operativo como utilidad real");
  });

  it("supports direct expense capture and category breakdown", () => {
    expect(intelligence).toContain('action={createStudioExpense}');
    expect(intelligence).toContain("expenseCategoryRows");
    expect(intelligence).toContain('title="Gastos por categoría"');
    expect(intelligence).toContain('action={deleteStudioExpense}');
  });
});
