import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const operational = readFileSync(
  join(process.cwd(), "supabase/migrations/20260921191446_evaluaciones01_operational_cycle.sql"),
  "utf8",
);
const reminders = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260921200036_evaluaciones01_pending_schedule_reminders.sql",
  ),
  "utf8",
);
const studentReadModels = readFileSync(
  join(
    process.cwd(),
    "supabase/migrations/20260921192458_evaluaciones01_student_portal_read_models.sql",
  ),
  "utf8",
);
const adminDashboard = readFileSync(join(process.cwd(), "app/admin/evaluaciones/page.tsx"), "utf8");
const adminProfile = readFileSync(
  join(process.cwd(), "app/admin/alumnas/[studentId]/StudentEvaluationsPanel.tsx"),
  "utf8",
);
const evaluationDetail = readFileSync(
  join(process.cwd(), "app/admin/evaluaciones/[id]/page.tsx"),
  "utf8",
);
const evaluationActions = readFileSync(
  join(process.cwd(), "app/admin/evaluaciones/actions.ts"),
  "utf8",
);
const studentHome = readFileSync(join(process.cwd(), "app/student/page.tsx"), "utf8");
const studentOverview = readFileSync(
  join(process.cwd(), "app/student/evaluaciones/page.tsx"),
  "utf8",
);
const studentInvitation = readFileSync(
  join(process.cwd(), "app/student/evaluaciones/[invitationId]/page.tsx"),
  "utf8",
);
const studentSchedule = readFileSync(
  join(process.cwd(), "app/student/evaluaciones/[invitationId]/programar/page.tsx"),
  "utf8",
);
const studentEvaluationCheckout = readFileSync(
  join(process.cwd(), "app/student/evaluaciones/[invitationId]/checkout/page.tsx"),
  "utf8",
);
const mercadoPagoOrder = readFileSync(
  join(process.cwd(), "supabase/functions/create-mercadopago-order/index.ts"),
  "utf8",
);
const studentResult = readFileSync(
  join(process.cwd(), "app/student/evaluaciones/resultado/[evaluationId]/page.tsx"),
  "utf8",
);

describe("EVALUACIONES-01 operational cycle", () => {
  it("keeps global Admin Evaluaciones focused on configuration", () => {
    expect(adminDashboard).toContain("Elige una disciplina para configurar sus niveles técnicos.");
    expect(adminDashboard).not.toContain("+ Nueva evaluación");
    expect(adminDashboard).not.toContain("Historial de evaluaciones");
    expect(adminProfile).toContain("Ciclo técnico de");
    expect(adminProfile).toContain("Invitar a evaluación");
    expect(adminProfile).toContain("Continuar evaluación");
  });

  it("models first invitation, normal booking, cancellation recovery and recurring cycles", () => {
    expect(operational).toContain("create table if not exists public.student_evaluation_cycles");
    expect(operational).toContain("create table if not exists public.evaluation_invitations");
    expect(operational).toContain("public.admin_create_evaluation_invitation");
    expect(operational).toContain("public.student_respond_evaluation_invitation");
    expect(operational).toContain("public.student_schedule_evaluation");
    expect(operational).toContain("public.student_book_session(p_session_id)");
    expect(operational).toContain("new.status::text in ('cancelled','no_show')");
    expect(operational).toContain("public.admin_start_scheduled_evaluation");
    expect(operational).toContain("public.system_generate_due_evaluation_invitations");
    expect(operational).toContain("v_result.evaluation_date::timestamp");
    expect(reminders).toContain("public.system_emit_evaluation_schedule_reminders");
    expect(reminders).toContain("evaluation.pending_schedule.reminder");
  });

  it("uses an automatic technical outcome in the normal coach workflow", () => {
    expect(operational).toContain("evaluation_manual_outcome_disabled");
    expect(operational).toContain("final_outcome = v_auto_outcome");
    expect(evaluationDetail).not.toContain("Resultado final manual");
    expect(evaluationDetail).not.toContain("Override del resultado");
    expect(evaluationActions).toContain("p_final_outcome: null");
    expect(evaluationActions).toContain("p_override_reason: null");
    expect(evaluationDetail).toContain("Faltan datos obligatorios");
  });

  it("serves student-safe read models and hides drafts", () => {
    expect(studentReadModels).toContain("public.student_evaluations_snapshot");
    expect(studentReadModels).toContain("public.student_evaluation_invitation_detail");
    expect(studentReadModels).toContain("public.student_evaluation_result_detail");
    expect(studentReadModels).toContain("and e.status = 'published'");
    expect(studentOverview).toContain('supabase.rpc("student_evaluations_snapshot")');
    expect(studentInvitation).toContain('"student_evaluation_invitation_detail"');
    expect(studentResult).toContain('"student_evaluation_result_detail"');
  });

  it("surfaces an actionable invitation on the student landing screen only when present", () => {
    expect(studentHome).toContain('supabase.rpc("student_evaluations_snapshot")');
    expect(studentHome).toContain('data-home-block="evaluation-invitation"');
    expect(studentHome).toContain('"Evaluación disponible"');
    expect(studentHome).toContain('"Ver invitación"');
    expect(studentHome).toContain('"Programar evaluación"');
    expect(studentHome).toContain("activeEvaluationInvitation?.invitation_id");
  });

  it("reuses the normal class feed and keeps checkout inside evaluation scheduling", () => {
    expect(studentSchedule).toContain('"student_schedule_feed"');
    expect(studentSchedule).toContain("target_discipline_id: invitation.discipline_id");
    expect(studentSchedule).toContain("Pagar esta clase");
    expect(studentSchedule).toContain("Comprar un paquete");
    expect(studentSchedule).toContain("PurchaseSingleClassButton");
    expect(studentSchedule).toContain("PurchasePackageButton");
    expect(studentSchedule).toContain("evaluationInvitationId={invitation.id}");
    expect(mercadoPagoOrder).toContain("evaluationInvitationId");
    expect(mercadoPagoOrder).toContain("/student/evaluaciones/");
    expect(studentEvaluationCheckout).toContain('"reconcile-mercadopago-order"');
    expect(studentEvaluationCheckout).toContain('"student_schedule_evaluation"');
    expect(studentEvaluationCheckout).toContain("Evaluación programada");
  });

  it("renders both final student result states", () => {
    expect(studentResult).toContain("¡Subiste de nivel!");
    expect(studentResult).toContain("Te mantienes en tu nivel");
    expect(studentResult).toContain("Desglose técnico");
    expect(studentResult).toContain("Mensaje de tu coach");
    expect(studentResult).toContain("Siguiente evaluación");
  });
});
