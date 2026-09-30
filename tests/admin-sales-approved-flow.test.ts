import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Registrar venta reuses the approved commercial flow", () => {
  const page = source("app/admin/ventas/nueva/page.tsx");
  const form = source("app/admin/alumnas/[studentId]/alta/StudentOnboardingForm.tsx");
  const actions = source("app/admin/alumnas/[studentId]/alta/actions.ts");
  const profile = source("app/admin/alumnas/[studentId]/page.tsx");

  it("selects a student first when there is no context", () => {
    expect(page).toContain('name="student_id"');
    expect(page).toContain("Selecciona la alumna");
    expect(page).toContain("Cambiar alumna");
  });

  it("includes fixed-credit packages and unlimited memberships in the approved flow", () => {
    const onboardingPage = source("app/admin/alumnas/[studentId]/alta/page.tsx");
    const migration = source(
      "supabase/migrations/20260921041000_hotfix_unlimited_membership_sales.sql",
    );

    expect(page).toContain('.in("product_type", ["package", "membership"])');
    expect(onboardingPage).toContain('.in("product_type", ["package", "membership"])');
    expect(actions).toContain('.in("product_type", ["package", "membership"])');
    expect(migration).toContain("product_type in ('package','membership')");
    expect(form).toContain('item.unlimited ? "Clases ilimitadas"');

    expect(page).toContain("StudentOnboardingForm");
  });

  it("uses the exact approved package, discount and payment controls", () => {
    expect(page).toContain("StudentOnboardingForm");
    expect(page).toContain('flowContext="sale"');
    expect(form).toContain("¿Qué adquiere {studentName}?");
    expect(form).toContain("Inicio del paquete");
    expect(form).toContain("Descuento por porcentaje");
    expect(form).toContain("Descuento por monto");
    expect(form).toContain("Cortesía total");
    expect(form).toContain("Fecha real del pago");
    expect(form).toContain("Fecha compromiso de pago");
    expect(form).toContain("Saldo pendiente");
  });

  it("keeps the approved RPC and only changes the return context", () => {
    expect(actions).toContain('supabase.rpc("create_student_onboarding_sale_v2"');
    expect(actions).toContain('flowContext === "sale"');
    expect(actions).toContain("/admin/ventas/${result.sale_id}?created=sale");
  });

  it("keeps Perfil 360 consultation-first and leaves sales in the Ventas flow", () => {
    expect(profile).not.toContain("/admin/ventas/nueva?student_id=${student.id}");
    expect(profile).not.toContain("Registrar venta");
  });
});
