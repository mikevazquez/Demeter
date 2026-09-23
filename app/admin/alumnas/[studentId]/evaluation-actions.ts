"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function evaluationError(error: { message?: string } | null) {
  const message = error?.message ?? "";
  const known = [
    "evaluation_invitation_already_open",
    "evaluation_level_not_configured",
    "evaluation_invitation_window_invalid",
    "evaluation_invitation_cadence_invalid",
    "evaluation_level_not_available",
    "evaluation_diagnostic_level_selection_disabled",
    "evaluation_diagnostic_next_level_not_configured",
    "evaluation_confirmed_level_missing",
    "evaluation_level_mismatch",
    "evaluation_reservation_not_active",
    "evaluation_not_scheduled",
  ];
  return known.find((code) => message.includes(code)) ?? "evaluation_action_failed";
}

export async function inviteStudentToEvaluationAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_WRITE);
  const studentId = value(formData, "student_id");
  const disciplineId = value(formData, "discipline_id");
  const windowStart = value(formData, "window_start");
  const windowEnd = value(formData, "window_end");

  const returnTo = `/admin/alumnas/${studentId}?view=evaluations`;

  if (!studentId || !disciplineId || !windowStart || !windowEnd) {
    redirect(`${returnTo}&evaluation_error=evaluation_invitation_window_invalid`);
  }

  const { error } = await ctx.supabase.rpc("admin_create_evaluation_invitation_v2", {
    p_student_id: studentId,
    p_discipline_id: disciplineId,
    p_window_start: windowStart,
    p_window_end: windowEnd,
    p_cadence_months: 3,
    p_discipline_level_id: null,
  });

  if (error) {
    redirect(`${returnTo}&evaluation_error=${encodeURIComponent(evaluationError(error))}`);
  }

  revalidatePath(returnTo);
  revalidatePath("/student/evaluaciones");
  redirect(returnTo);
}

export async function startScheduledEvaluationAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_WRITE);
  const studentId = value(formData, "student_id");
  const invitationId = value(formData, "invitation_id");
  const returnTo = `/admin/alumnas/${studentId}?view=evaluations`;

  if (!studentId || !invitationId) {
    redirect(`${returnTo}&evaluation_error=evaluation_action_failed`);
  }

  const { data, error } = await ctx.supabase.rpc("admin_start_scheduled_evaluation", {
    p_invitation_id: invitationId,
  });

  if (error || !data) {
    redirect(`${returnTo}&evaluation_error=${encodeURIComponent(evaluationError(error))}`);
  }

  revalidatePath(returnTo);
  redirect(`/admin/evaluaciones/${data}`);
}
