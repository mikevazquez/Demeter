import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(join(process.cwd(), path), "utf8");
}

describe("Flow 01 student onboarding", () => {
  it("keeps the creation flow in context and handles duplicates without leaving the form", () => {
    const actions = source("app/admin/alumnas/actions.ts");
    const studentsPage = source("app/admin/alumnas/page.tsx");
    const duplicateDialog = source("app/admin/alumnas/DuplicateStudentDialog.tsx");

    expect(actions).toContain("existingStudentRedirect");
    expect(actions).toContain("#alta-rapida");
    expect(actions).toContain("redirect(\`/admin/alumnas/\${studentId}/alta\`)");
    expect(studentsPage).toContain('id="alta-rapida"');
    expect(studentsPage).toContain("DuplicateStudentDialog");
    expect(duplicateDialog).toContain("Ya encontramos este expediente");
    expect(duplicateDialog).toContain("NoticeDialog");
    const noticeDialog = source("app/admin/components/NoticeDialog.tsx");
    expect(noticeDialog).toContain('aria-modal="true"');
    expect(noticeDialog).toContain('confirmLabel = "Aceptar"');
    expect(noticeDialog).toContain("backdrop-blur-sm");
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
    expect(migration).toContain(
      "activation_mode=case when package_start_mode='first_attendance' then 'first_attendance' else 'fixed_date' end",
    );
    expect(migration).toContain("'first_attendance'");
    expect(migration).toContain("v_reservation.status='attended'");
    expect(migration).toContain("starts_on=v_class_date");
  });

  it("blocks booking when a no-payment acquisition has not been authorized", () => {
    const migration = source("supabase/migrations/20260918152000_flow01_student_onboarding.sql");
    expect(migration).toContain("'reason_code','payment_pending'");
    expect(migration).toContain("pending_access_exception");
    expect(migration).toContain("pending_access_reason");
    expect(migration).toContain("create_student_onboarding_sale.payment_due_on");
    expect(migration).toContain("create_student_onboarding_sale.collection_note");
  });

  it("supports multiple enrollment terms while keeping the configured default compatible", () => {
    const migration = source("supabase/migrations/20260918161000_flow01_enrollment_multiterm.sql");
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

  it("shows successful onboarding in the submit context before the user chooses the next action", () => {
    const actions = source("app/admin/alumnas/[studentId]/alta/actions.ts");
    const page = source("app/admin/alumnas/[studentId]/alta/page.tsx");
    const form = source("app/admin/alumnas/[studentId]/alta/StudentOnboardingForm.tsx");
    const dialog = source("app/admin/alumnas/[studentId]/alta/OnboardingCompletedDialog.tsx");

    expect(actions).toContain("#confirmar-alta");
    expect(actions).toContain("completed=1");
    expect(page).toContain("OnboardingCompletedDialog");
    expect(form).toContain('id="confirmar-alta"');
    expect(form).toContain("completedSaleId");
    expect(dialog).toContain("NoticeDialog");
    expect(dialog).toContain("La operación se guardó correctamente");
  });

  it("finishes in Profile 360 with Spanish user-visible states", () => {
    const profile = source("app/admin/alumnas/[studentId]/page.tsx");
    expect(profile).toContain("lifecycleCopy");
    expect(profile).toContain("Pendiente de primera asistencia");
    expect(profile).toContain("Bloqueada por pago pendiente");
    expect(profile).toContain("Reservar primera clase");
    expect(profile).not.toContain("DuplicateStudentDialog");
  });
});
