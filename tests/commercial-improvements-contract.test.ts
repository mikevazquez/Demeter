import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { calculateSingleClassCheckout } from "../lib/student/checkout-pricing";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("commercial improvements contracts", () => {
  it("persists package term classification across create, edit and duplicate flows", () => {
    const actions = source("app/admin/productos/actions.ts");
    const editor = source("app/admin/productos/[productId]/editar/page.tsx");

    for (const term of ["monthly", "quarterly", "semiannual", "annual", "custom"]) {
      expect(actions).toContain(`\"${term}\"`);
    }
    expect(actions).toContain("package_term: values.packageTerm");
    expect(actions).toContain("package_term: source.package_term");
    expect(editor).toContain("initialPackageTerm={product.package_term}");
  });

  it("stores and exposes a standalone class price without adding checkout", () => {
    // Keep this title as the ratchet identifier. Current behavior adds required enrollment at checkout.
    expect(calculateSingleClassCheckout(15000, null)).toEqual({
      dropInPriceMinor: 15000,
      enrollmentExtraMinor: 0,
      totalMinor: 15000,
    });
    expect(calculateSingleClassCheckout(15000, { missing: true, price_minor: 20000 })).toEqual({
      dropInPriceMinor: 15000,
      enrollmentExtraMinor: 20000,
      totalMinor: 35000,
    });
    expect(calculateSingleClassCheckout(15000, { missing: false, price_minor: 20000 })).toEqual({
      dropInPriceMinor: 15000,
      enrollmentExtraMinor: 0,
      totalMinor: 15000,
    });
  });

  it("passes an explicit acquisition start date through the approved contextual sale flow", () => {
    const salePage = source("app/admin/ventas/nueva/page.tsx");
    const saleForm = source("app/admin/alumnas/[studentId]/alta/StudentOnboardingForm.tsx");
    const saleAction = source("app/admin/alumnas/[studentId]/alta/actions.ts");
    const onboardingMigration = source(
      "supabase/migrations/20260918152000_flow01_student_onboarding.sql",
    );

    expect(salePage).toContain("StudentOnboardingForm");
    expect(salePage).toContain('flowContext="sale"');
    expect(saleForm).toContain('name="package_starts_on"');
    expect(saleForm).toContain('value="specific"');
    expect(saleAction).toContain("package_starts_on:");
    expect(saleAction).toContain("create_student_onboarding_sale_v2");
    expect(onboardingMigration).toContain("package_starts_on date");
  });

  it("adjusts available credits through an auditable ledger movement with a required reason", () => {
    const actions = source("app/admin/alumnas/[studentId]/actions.ts");
    const packageCard = source("app/admin/alumnas/[studentId]/StudentPackageCard.tsx");
    const migration = source(
      "supabase/migrations/20260916170000_commercial_catalog_and_acquisition_controls.sql",
    );

    expect(actions).toContain('rpc("admin_set_acquisition_available_credits"');
    expect(actions).toContain("target_reason: reason");
    expect(packageCard).toContain("Motivo del ajuste");
    expect(migration).toContain("movement_type");
    expect(migration).toContain("'adjustment'");
    expect(migration).toContain("adjustment_reason_required");
    expect(migration).toContain("unlimited_acquisition");
  });

  it("groups student packages by explicit commercial term", () => {
    const packagePage = source("app/student/paquete/page.tsx");
    const portalTypes = source("lib/student/portal.ts");
    const portalMigration = source(
      "supabase/migrations/20260916170200_student_portal_package_term.sql",
    );

    expect(portalTypes).toContain("package_term: string | null");
    for (const label of ["1 mes", "3 meses", "6 meses", "12 meses", "Otros"]) {
      expect(packagePage).toContain(label);
    }
    expect(packagePage).toContain("item.package_term");
    expect(portalMigration).toContain("'package_term',pt.package_term");
  });

  it("keeps administrative acquisition mutations unavailable to anon", () => {
    const migration = source(
      "supabase/migrations/20260916170000_commercial_catalog_and_acquisition_controls.sql",
    );

    expect(migration).toContain(
      "revoke all on function public.admin_set_acquisition_start_date(uuid, date) from public, anon",
    );
    expect(migration).toContain(
      "revoke all on function public.admin_set_acquisition_available_credits(uuid, integer, text) from public, anon",
    );
  });
});
