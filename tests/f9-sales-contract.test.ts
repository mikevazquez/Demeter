import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F9 sales contracts", () => {
  it("keeps sale, payment and acquisition as separate records", () => {
    const migration = source("supabase/migrations/20260915220918_f9_sales_payments_core.sql");

    expect(migration).toContain("create table if not exists public.sales");
    expect(migration).toContain("create table if not exists public.sale_lines");
    expect(migration).toContain("create table if not exists public.payments");
    expect(migration).toContain("insert into public.product_acquisitions");
    expect(migration).toContain("insert into public.credit_ledger");
  });

  it("creates at most one acquisition per sale line", () => {
    const migration = source("supabase/migrations/20260915220918_f9_sales_payments_core.sql");

    expect(migration).toContain("product_acquisitions_sale_line_unique");
    expect(migration).toContain(
      "on conflict (sale_line_id) where sale_line_id is not null do nothing",
    );
  });

  it("registers later payments without creating another acquisition", () => {
    const migration = source("supabase/migrations/20260915220918_f9_sales_payments_core.sql");
    const registerPayment =
      migration.split("create or replace function public.register_sale_payment")[1] ?? "";

    expect(registerPayment).toContain("insert into public.payments");
    expect(registerPayment).not.toContain("insert into public.product_acquisitions");
    expect(registerPayment).not.toContain("insert into public.credit_ledger");
    expect(registerPayment).toContain("payment_exceeds_balance");
  });

  it("protects commercial writes with the sales capability", () => {
    const migration = source("supabase/migrations/20260915220918_f9_sales_payments_core.sql");
    const actions = source("app/admin/ventas/actions.ts");

    expect(migration).toContain("private.has_capability(v_student.studio_id,'sales.write')");
    expect(migration).toContain("private.has_capability(v_sale.studio_id,'sales.write')");
    expect(actions).toContain("CAPABILITIES.SALES_WRITE");
  });

  it("exposes the canonical sales screens", () => {
    const layout = source("app/admin/layout.tsx");
    const list = source("app/admin/ventas/page.tsx");
    const wizard = source("app/admin/ventas/nueva/page.tsx");
    const detail = source("app/admin/ventas/[saleId]/page.tsx");

    expect(layout).toContain('{ href: "/admin/ventas", label: "Ventas", enabled: true }');
    expect(list).toContain("Nueva venta");
    expect(wizard).toContain("Confirmar venta");
    expect(detail).toContain("Registrar pago");
    expect(detail).toContain("Productos y adquisiciones");
  });
});
