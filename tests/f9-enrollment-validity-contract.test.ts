import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("F9 enrollment validity contracts", () => {
  it("allows lifetime validity only for enrollment products", () => {
    const migration = source("supabase/migrations/20260915235102_f9_enrollment_lifetime.sql");
    expect(migration).toContain("alter column validity_days drop not null");
    expect(migration).toContain("product_type = 'enrollment'");
    expect(migration).toContain("validity_days is null");
    expect(migration).toContain("product_type <> 'enrollment'");
    expect(migration).toContain("validity_days is not null");
  });

  it("offers common enrollment validity presets plus custom days and lifetime", () => {
    const fields = source("app/admin/productos/product-form-fields.tsx");
    expect(fields).toContain('<option value="30">30 días</option>');
    expect(fields).toContain('<option value="90">3 meses</option>');
    expect(fields).toContain('<option value="180">6 meses</option>');
    expect(fields).toContain('<option value="365">1 año</option>');
    expect(fields).toContain('<option value="lifetime">Vitalicia</option>');
    expect(fields).toContain('<option value="custom">Días específicos</option>');
    expect(fields).toContain('enrollmentValidity === "lifetime" ? "" : enrollmentValidity');
  });

  it("stores lifetime enrollment as null validity while keeping other products finite", () => {
    const actions = source("app/admin/productos/actions.ts");
    expect(actions).toContain("isEnrollment && !validityRaw ? null");
    expect(actions).toContain('parsePositiveInt(validityRaw, "validity_days")');

    const enrollmentCore = source("supabase/migrations/20260915224105_f9_enrollment_core.sql");
    expect(enrollmentCore).toContain("v_start_date + v_product.validity_days");

    const eligibility = source(
      "supabase/migrations/20260915225318_f9_enrollment_booking_eligibility.sql",
    );
    expect(eligibility).toContain("se.expires_on is null or se.expires_on>=v_class_date");
  });

  it("shows lifetime enrollment clearly in the product catalog and detail", () => {
    const list = source("app/admin/productos/page.tsx");
    const detail = source("app/admin/productos/[productId]/page.tsx");
    expect(list).toContain('product.validity_days == null ? "Vitalicia"');
    expect(detail).toContain('product.validity_days == null ? "Vitalicia"');
    expect(detail).toContain("inscripción vitalicia, sin fecha de vencimiento");
  });
});
