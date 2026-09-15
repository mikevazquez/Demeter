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

  it("protects commercial writes with sales capability", () => {
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
    expect(refundFunction).not.toContain("delete from public.credit_ledger");
    expect(refundFunction).not.toContain("update public.credit_ledger");
  });

  it("persists refund reason without column-parameter ambiguity", () => {
    const fix = source("supabase/migrations/20260915223341_f9_refund_reason_fix.sql");
    expect(fix).toContain("v_reason := trim(refund_reason)");
    expect(fix).toContain("refund_reason=coalesce(pa.refund_reason,v_reason)");
  });

  it("blocks refund and void while future reservations use an acquisition", () => {
    const migration = source("supabase/migrations/20260915222558_f9_refunds_voids.sql");
    expect(migration).toContain("refund_future_reservations_exist");
    expect(migration).toContain("void_future_reservations_exist");
    expect(migration).toContain("r.status='reserved'");
    expect(migration).toContain("cs.status='scheduled'");
  });

  it("does not turn refunds into new outstanding debt", () => {
    const migration = source("supabase/migrations/20260915224105_f9_enrollment_core.sql");
    expect(migration).toContain("sl.refunded_at is null");
    expect(migration).toContain("v_collectible_total-v_net_collected");
    expect(migration).toContain("refund_exceeds_collected");
  });

  it("voids only after collected funds have been returned", () => {
    const migration = source("supabase/migrations/20260915222558_f9_refunds_voids.sql");
    const voidFunction = migration.split("create or replace function public.void_sale")[1] ?? "";
    expect(voidFunction).toContain("sale_has_unreturned_funds");
    expect(voidFunction).toContain("status='voided'");
    expect(voidFunction).toContain("void_reason=trim(target_reason)");
  });

  it("models enrollment as a configurable studio policy and student state", () => {
    const enumMigration = source(
      "supabase/migrations/20260915223919_f9_enrollment_product_type.sql",
    );
    const enrollment = source("supabase/migrations/20260915224105_f9_enrollment_core.sql");
    expect(enumMigration).toContain("'enrollment'");
    expect(enrollment).toContain("create table if not exists public.enrollment_policies");
    expect(enrollment).toContain("create table if not exists public.student_enrollments");
    expect(enrollment).toContain("required_for_booking boolean");
    expect(enrollment).toContain("rules jsonb");
    expect(enrollment).toContain("private.has_capability(target_studio_id,'settings.write')");
  });

  it("creates enrollment without fabricating package credits", () => {
    const enrollment = source("supabase/migrations/20260915224105_f9_enrollment_core.sql");
    const createSale =
      enrollment
        .split("create or replace function public.create_manual_sale")[1]
        ?.split("create or replace function public.refund_sale_line")[0] ?? "";
    expect(createSale).toContain("if v_product.product_type='enrollment' then");
    expect(createSale).toContain("insert into public.student_enrollments");
    expect(createSale).toContain("else\n      insert into public.product_acquisitions");
    expect(createSale).toContain("insert into public.credit_ledger");
  });

  it("refunds or voids enrollment while preserving commercial history", () => {
    const enrollment = source("supabase/migrations/20260915224105_f9_enrollment_core.sql");
    expect(enrollment).toContain("status='refunded'");
    expect(enrollment).toContain("where se.source_sale_id=v_sale.id and se.status='active'");
    expect(enrollment).toContain("update public.sale_lines sl");
    expect(enrollment).not.toContain("delete from public.student_enrollments");
  });

  it("enforces required enrollment through the canonical booking eligibility", () => {
    const eligibility = source(
      "supabase/migrations/20260915225318_f9_enrollment_booking_eligibility.sql",
    );
    expect(eligibility).toContain("v_policy.enabled and v_policy.required_for_booking");
    expect(eligibility).toContain("from public.student_enrollments se");
    expect(eligibility).toContain("se.status='active'");
    expect(eligibility).toContain("se.starts_on<=v_class_date");
    expect(eligibility).toContain("se.expires_on is null or se.expires_on>=v_class_date");
    expect(eligibility).toContain("'reason_code','enrollment_required'");
  });

  it("does not bypass required enrollment through the existing-student walk-in fallback", () => {
    const adminActions = source("app/admin/actions.ts");
    const operations = source("app/admin/hoy/SessionOperations.tsx");
    expect(adminActions).toContain(
      'new Set(["no_active_product", "outside_product", "no_credits"])',
    );
    expect(adminActions).not.toContain(
      'new Set(["no_active_product", "outside_product", "no_credits", "enrollment_required"])',
    );
    expect(operations).toContain("walkinFallbackDetails");
    expect(operations).toContain('error === "enrollment_required"');
    expect(operations).toContain("disabled={!candidate.eligible && !canFallbackToWalkin}");
  });

  it("exposes enrollment product and policy UI", () => {
    const products = source("app/admin/productos/nuevo/page.tsx");
    const productActions = source("app/admin/productos/actions.ts");
    const policy = source("app/admin/ventas/inscripcion/page.tsx");
    const saleWizard = source("app/admin/ventas/nueva/page.tsx");
    const detail = source("app/admin/ventas/[saleId]/page.tsx");
    expect(products).toContain('<option value="enrollment">Inscripción</option>');
    expect(productActions).toContain('productType === "enrollment"');
    expect(policy).toContain("Política por estudio");
    expect(policy).toContain("required_for_booking");
    expect(saleWizard).toContain("enrollment_product_template_id");
    expect(detail).toContain("Productos y derechos");
    expect(detail).toContain("Inscripción");
  });

  it("exposes sales through the simplified Empresa navigation", () => {
    const layout = source("app/admin/layout.tsx");
    const company = source("app/admin/empresa/page.tsx");
    const list = source("app/admin/ventas/page.tsx");
    const wizard = source("app/admin/ventas/nueva/page.tsx");
    const detail = source("app/admin/ventas/[saleId]/page.tsx");
    expect(layout).toContain('{ href: "/admin", label: "Hoy", enabled: true }');
    expect(layout).toContain('{ href: "/admin/alumnas", label: "Alumnas", enabled: true }');
    expect(layout).toContain('href: "/admin/empresa"');
    expect(layout).toContain('label: "Empresa"');
    expect(layout).toContain('"/admin/ventas"');
    expect(layout).not.toContain('{ href: "/admin/ventas", label: "Ventas", enabled: true }');
    expect(company).toContain("Ventas y pagos");
    expect(company).toContain('href: "/admin/ventas"');
    expect(company).toContain("Coaches");
    expect(company).toContain("Productos y paquetes");
    expect(list).toContain("Nueva venta");
    expect(list).toContain("Inscripción");
    expect(wizard).toContain("Confirmar venta");
    expect(detail).toContain("Registrar pago");
    expect(detail).toContain("Registrar reembolso");
    expect(detail).toContain("Anular venta");
  });
});
