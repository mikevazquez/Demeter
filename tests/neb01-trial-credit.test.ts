import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("NEB-01-36 primera clase y abono configurables", () => {
  it("la app ya no tiene $150 fijo en el alta ni en ventas", () => {
    for (const file of [
      "app/admin/alumnas/[studentId]/alta/StudentOnboardingForm.tsx",
      "app/admin/alumnas/[studentId]/alta/page.tsx",
      "app/admin/ventas/nueva/page.tsx",
    ]) {
      const source = read(file);
      expect(source, file).not.toContain("$150");
      expect(source, file).not.toContain("15000");
    }
  });

  it("la migración arranca con los valores de Demeter y ajusta las cuatro funciones", () => {
    const migration = read("supabase/migrations/20261023159000_neb01_trial_enrollment_credit.sql");
    expect(migration).toContain("trial_price_minor integer not null default 15000");
    expect(migration).toContain("enrollment_credit_valid_days integer not null default 0");
    for (const signature of [
      "public.get_trial_enrollment_credit_options(uuid)",
      "public.create_package_with_trial_enrollment_credit(",
      "public.assistant_trial_booking_preview(uuid,uuid,uuid,uuid)",
      "public.service_prepare_trial_transfer(uuid,uuid,uuid,uuid,uuid)",
    ]) {
      expect(migration).toContain(signature);
    }
    expect(migration).toContain("'trial_payment_towards_enrollment'");
  });

  it("Configuración › Reservas tiene la sección de primera clase", () => {
    expect(read("app/admin/configuracion/reservas/page.tsx")).toContain("<TrialCreditForm");
    expect(read("app/admin/configuracion/reservas/actions.ts")).toContain(
      'rpc("owner_update_studio_trial_credit"',
    );
  });
});
