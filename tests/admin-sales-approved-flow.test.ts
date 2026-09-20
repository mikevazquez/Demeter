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

  it("exposes the same sale flow contextually from Perfil 360", () => {
    expect(profile).toContain("/admin/ventas/nueva?student_id=${student.id}");
    expect(profile).toContain("Registrar venta");
  });
});
