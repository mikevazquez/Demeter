import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Enrollment V2", () => {
  const migration = source("supabase/migrations/20261001053000_enrollment_v2_required_checkout.sql");
  const bookingCore = source("supabase/migrations/20260930005800_packages03_activity_restrictions.sql");
  const policyAction = source("app/admin/ventas/inscripcion/actions.ts");
  const policyPage = source("app/admin/ventas/inscripcion/page.tsx");
  const studentActions = source("app/student/actions.ts");
  const packagePage = source("app/student/paquete/page.tsx");
  const home = source("app/student/page.tsx");
  const sessionDetail = source("app/student/reservar/[sessionId]/page.tsx");
  const edge = source("supabase/functions/create-mercadopago-order/index.ts");
  const packageCheckout = source("app/student/paquete/checkout/page.tsx");
  const singleCheckout = source("app/student/reservar/checkout/page.tsx");

  it("uses one mandatory rule whenever enrollment is enabled", () => {
    expect(migration).toContain("required_for_package_purchase");
    expect(migration).toContain("required_for_single_class");
    expect(migration).toContain("single_class_grace_count = 0");
    expect(policyAction).toContain('rpc("set_enrollment_policy_v2"');
    expect(policyAction).toContain("target_required_for_booking: enabled");
    expect(policyAction).toContain("target_required_for_package_purchase: enabled");
    expect(policyAction).toContain("target_required_for_single_class: enabled");
    expect(policyAction).toContain("target_single_class_grace_count: 0");
    expect(policyPage).toContain("Obligatoria");
  });

  it("blocks booking consistently when enrollment is missing", () => {
    expect(migration).toContain("private.student_enrollment_requirement_for_booking");
    expect(bookingCore).toContain("'enrollment_required'");
    expect(sessionDetail).toContain('reason === "enrollment_required"');
    expect(sessionDetail).toContain('enrollmentMode === "package_booking"');
    expect(sessionDetail).toContain('"Pagar inscripción"');
  });

  it("supports standalone enrollment checkout", () => {
    expect(migration).toContain("public.student_create_enrollment_checkout_attempt");
    expect(studentActions).toContain("createEnrollmentMercadoPagoOrderAction");
    expect(studentActions).toContain("enrollmentOnly: true");
    expect(edge).toContain("enrollmentOnly");
    expect(edge).toContain('rpc("student_create_enrollment_checkout_attempt"');
    expect(packagePage).toContain("PurchaseEnrollmentButton");
    expect(packageCheckout).toContain('"¡Tu inscripción ya está activa!"');
    expect(packageCheckout).toContain('"¡Tu paquete y tu inscripción ya están listos!"');
  });

  it("bundles enrollment into package and single-class checkout without redundant purchases", () => {
    expect(migration).toContain("public.student_create_online_checkout_attempt");
    expect(migration).toContain("required_for_package_purchase");
    expect(migration).toContain("extra_fulfillment_snapshot");
    expect(migration).toContain("public.student_create_single_class_checkout_attempt");
    expect(migration).toContain("student_enrollment_checkout_requirement");
    expect(packagePage).toContain("incluirá también la inscripción requerida");
    expect(sessionDetail).toContain("checkoutTotalMinor");
    expect(sessionDetail).toContain("enrollmentCanBundleSingle");
    expect(singleCheckout).toContain("Tu clase y tu inscripción ya están listas");
    expect(singleCheckout).toContain("extra_fulfillment_snapshot");
  });

  it("warns about expiration seven days before and missing enrollment", () => {
    expect(home).toContain("enrollmentDaysRemaining <= 7");
    expect(home).toContain("Tu inscripción está por vencer");
    expect(home).toContain("No tienes una inscripción vigente");
    expect(packagePage).toContain("Tu inscripción no está vigente");
  });

  it("keeps privileged enrollment helpers off the anonymous API", () => {
    expect(migration).toContain(
      "revoke all on function private.student_has_active_enrollment(uuid,uuid,date)",
    );
    expect(migration).toContain(
      "revoke all on function public.student_create_enrollment_checkout_attempt(uuid,uuid)",
    );
    expect(migration).toContain(
      "grant execute on function public.student_create_enrollment_checkout_attempt(uuid,uuid)",
    );
  });
});
