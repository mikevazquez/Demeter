"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getStudentPortalContext } from "@/lib/student/portal";

function field(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function rpcError(error: { message?: string } | null, fallback: string) {
  const message = error?.message ?? "";
  const known = [
    "evaluation_invitation_not_found",
    "evaluation_invitation_not_respondable",
    "evaluation_invitation_not_schedulable",
    "evaluation_session_wrong_discipline",
    "evaluation_session_outside_window",
    "session_not_found",
    "forbidden",
  ];
  return known.find((code) => message.includes(code)) ?? fallback;
}

export async function respondEvaluationInvitationAction(formData: FormData) {
  const invitationId = field(formData, "invitation_id");
  const response = field(formData, "response");
  if (!invitationId || !["accept", "decline"].includes(response)) {
    redirect("/student/evaluaciones?error=evaluation_response_invalid");
  }

  const { supabase } = await getStudentPortalContext();
  const { data, error } = await supabase.rpc("student_respond_evaluation_invitation", {
    p_invitation_id: invitationId,
    p_accept: response === "accept",
  });

  if (error) {
    redirect(
      `/student/evaluaciones/${invitationId}?error=${encodeURIComponent(
        rpcError(error, "evaluation_response_failed"),
      )}`,
    );
  }

  const result = data as { status?: string } | null;
  revalidatePath("/student/evaluaciones");
  revalidatePath(`/student/evaluaciones/${invitationId}`);

  if (result?.status === "pending_schedule") {
    redirect(`/student/evaluaciones/${invitationId}/programar`);
  }

  redirect("/student/evaluaciones");
}

export async function scheduleEvaluationAction(formData: FormData) {
  const invitationId = field(formData, "invitation_id");
  const sessionId = field(formData, "session_id");

  if (!invitationId || !sessionId) {
    redirect("/student/evaluaciones?error=evaluation_schedule_invalid");
  }

  const { supabase } = await getStudentPortalContext();
  const { data, error } = await supabase.rpc("student_schedule_evaluation", {
    p_invitation_id: invitationId,
    p_session_id: sessionId,
  });

  if (error) {
    redirect(
      `/student/evaluaciones/${invitationId}/programar?error=${encodeURIComponent(
        rpcError(error, "evaluation_schedule_failed"),
      )}&session=${encodeURIComponent(sessionId)}`,
    );
  }

  const result = data as {
    eligible?: boolean;
    reason_code?: string | null;
    evaluation_status?: string;
  } | null;

  if (!result?.eligible || result.evaluation_status !== "scheduled") {
    const reason = result?.reason_code ?? "evaluation_schedule_failed";
    redirect(
      `/student/evaluaciones/${invitationId}/programar?error=${encodeURIComponent(
        reason,
      )}&session=${encodeURIComponent(sessionId)}`,
    );
  }

  revalidatePath("/student/evaluaciones");
  revalidatePath(`/student/evaluaciones/${invitationId}`);
  revalidatePath("/student/mis-clases");
  redirect("/student/evaluaciones");
}

export async function markEvaluationResultViewedAction(evaluationId: string) {
  if (!evaluationId) return { ok: false };

  const { supabase } = await getStudentPortalContext();
  const { error } = await supabase.rpc("student_mark_evaluation_result_viewed", {
    p_evaluation_id: evaluationId,
  });

  if (error) {
    return { ok: false };
  }

  revalidatePath("/student");
  revalidatePath("/student/evaluaciones");
  return { ok: true };
}
