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
    const refundMigration = source("supabase/migrations/20260915222558_f9_refunds_voids.sql");
    const actions = source("app/admin/ventas/actions.ts");

    expect(migration).toContain("private.has_capability(v_student.studio_id,'sales.write')");
    expect(migration).toContain("private.has_capability(v_sale.studio_id,'sales.write')");
    expect(refundMigration).toContain("private.has_capability(v_sale.studio_id,'sales.write')");
    expect(actions).toContain("CAPABILITIES.SALES_WRITE");
  });

  it("refunds a specific sale line and keeps credit history intact", () => {
    const migration = source("supabase/migrations/20260915222558_f9_refunds_voids.sql");
    const refundFunction =
      migration
        .split("create or replace function public.refund_sale_line")[1]
        ?.split("create or replace function public.void_sale")[0] ?? "";

    expect(refundFunction).toContain("sale_line_id");
    expect(refundFunction).toContain("kind='refund'");
    expect(refundFunction).toContain("status='cancelled'");
    expect(refundFunction).toContain("refunded_at=coalesce(refunded_at,now())");
    expect(refundFunction).not.toContain("delete from public.credit_ledger");
    expect(refundFunction).not.toContain("update public.credit_ledger");
  });

  it("persists the refund reason without column-parameter ambiguity", () => {
    const fix = source("supabase/migrations/20260915223341_f9_refund_reason_fix.sql");

    expect(fix).toContain("v_reason := trim(refund_reason)");
    expect(fix).toContain("refund_reason=coalesce(pa.refund_reason,v_reason)");
    expect(fix).toContain("v_reason,(select auth.uid())");
  });

  it("blocks refund and void while future reservations use the acquisition", () => {
    const migration = source("supabase/migrations/20260915222558_f9_refunds_voids.sql");

    expect(migration).toContain("refund_future_reservations_exist");
    expect(migration).toContain("void_future_reservations_exist");
    expect(migration).toContain("r.status='reserved'");
    expect(migration).toContain("cs.status='scheduled'");
    expect(migration).toContain("cs.starts_at > now()");
  });

  it("does not turn refunds into new outstanding debt", () => {
    const migration = source("supabase/migrations/20260915222558_f9_refunds_voids.sql");

    expect(migration).toContain("pa.refunded_at is null");
    expect(migration).toContain("v_collectible_total - v_net_collected");
    expect(migration).toContain("refund_exceeds_collected");
  });

  it("voids only after collected funds have been returned", () => {
    const migration = source("supabase/migrations/20260915222558_f9_refunds_voids.sql");
    const voidFunction = migration.split("create or replace function public.void_sale")[1] ?? "";

    expect(voidFunction).toContain("sale_has_unreturned_funds");
    expect(voidFunction).toContain("status='voided'");
    expect(voidFunction).toContain("void_reason=trim(target_reason)");
  });

  it("exposes the canonical sales screens", () => {
    const layout = source("app/admin/layout.tsx");
    const list = source("app/admin/ventas/page.tsx");
    const wizard = source("app/admin/ventas/nueva/page.tsx");
    const detail = source("app/admin/ventas/[saleId]/page.tsx");

    expect(layout).toContain('{ href: "/admin/ventas", label: "Ventas", enabled: true }');
    expect(list).toContain("Nueva venta");
    expect(list).toContain("Reembolsada");
    expect(wizard).toContain("Confirmar venta");
    expect(detail).toContain("Registrar pago");
    expect(detail).toContain("Productos y adquisiciones");
    expect(detail).toContain("Registrar reembolso");
    expect(detail).toContain("Anular venta");
  });
});
