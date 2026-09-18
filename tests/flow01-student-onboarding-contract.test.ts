import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Flow 01 student onboarding", () => {
  it("keeps the student in context after creation and duplicate detection", () => {
    const actions = source("app/admin/alumnas/actions.ts");
    expect(actions).toContain("existingStudentRedirect");
    expect(actions).toContain("duplicada_archivada");
    expect(actions).toContain("/alta");
  });

  it("models the onboarding sale as one idempotent commercial operation", () => {
    const migration = source("supabase/migrations/20260918152000_flow01_student_onboarding.sql");
    expect(migration).toContain("sales_studio_idempotency_unique");
    expect(migration).toContain("create_student_onboarding_sale");
    expect(migration).toContain("'replayed',true");
    expect(migration).toContain("access_blocked");
  });

  it("preserves list price while recording discounts and courtesy history", () => {
    const migration = source("supabase/migrations/20260918152000_flow01_student_onboarding.sql");
    expect(migration).toContain("discount_minor");
    expect(migration).toContain("discount_kind");
    expect(migration).toContain("discount_reason");
    expect(migration).toContain("discount_authorized_by");
  });

  it("supports fixed start or activation on first attendance", () => {
    const migration = source("supabase/migrations/20260918152000_flow01_student_onboarding.sql");
    expect(migration).toContain("activation_mode");
    expect(migration).toContain("'first_attendance'");
    expect(migration).toContain("v_reservation.status='attended'");
    expect(migration).toContain("starts_on=v_class_date");
  });

  it("blocks booking when a no-payment acquisition has not been authorized", () => {
    const migration = source("supabase/migrations/20260918152000_flow01_student_onboarding.sql");
    expect(migration).toContain("'reason_code','payment_pending'");
    expect(migration).toContain("pending_access_exception");
    expect(migration).toContain("pending_access_reason");
  });

  it("supports multiple enrollment terms while keeping the configured default compatible", () => {
    const migration = source(
      "supabase/migrations/20260918161000_flow01_enrollment_multiterm.sql",
    );
    const actions = source("app/admin/alumnas/[studentId]/alta/actions.ts");
    const form = source("app/admin/alumnas/[studentId]/alta/StudentOnboardingForm.tsx");

    expect(migration).toContain("create_student_onboarding_sale_v2");
    expect(migration).toContain("target_enrollment_product_id uuid");
    expect(migration).toContain(
      "coalesce(target_enrollment_product_id,v_policy.enrollment_product_template_id)",
    );
    expect(actions).toContain('supabase.rpc("create_student_onboarding_sale_v2"');
    expect(actions).toContain("target_enrollment_product_id");
    expect(form).toContain("Vigencia de inscripción");
    expect(form).toContain("enrollmentProducts");
    expect(form).toContain('"Vitalicia"');
  });

  it("keeps the first reservation contextual to the same student", () => {
    const page = source("app/admin/alumnas/[studentId]/reservar/page.tsx");
    const actions = source("app/admin/alumnas/[studentId]/reservar/actions.ts");
    expect(page).toContain('name="student_id" value={student.id}');
    expect(actions).toContain("target_student_id: studentId");
    expect(actions).toContain("admin_book_student");
  });

  it("finishes in Profile 360 with Spanish user-visible states", () => {
    const profile = source("app/admin/alumnas/[studentId]/page.tsx");
    expect(profile).toContain("lifecycleCopy");
    expect(profile).toContain("Pendiente de primera asistencia");
    expect(profile).toContain("Bloqueada por pago pendiente");
    expect(profile).toContain("Reservar primera clase");
  });
});
