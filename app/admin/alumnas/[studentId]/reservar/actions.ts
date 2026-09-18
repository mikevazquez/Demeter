"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

function reservationUrl(studentId: string, error?: string) {
  const base = `/admin/alumnas/${studentId}/reservar`;
  return error ? `${base}?error=${encodeURIComponent(error)}` : base;
}

export async function reserveStudentFromOnboarding(formData: FormData) {
  const studentId = String(formData.get("student_id") ?? "").trim();
  const sessionId = String(formData.get("session_id") ?? "").trim();

  if (!studentId || !sessionId) redirect(reservationUrl(studentId, "invalid_request"));

  const { supabase, studio } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);

  const [{ data: student }, { data: session }] = await Promise.all([
    supabase
      .from("students")
      .select("id")
      .eq("id", studentId)
      .eq("studio_id", studio.id)
      .eq("active", true)
      .eq("lifecycle_status", "active")
      .maybeSingle(),
    supabase
      .from("class_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("studio_id", studio.id)
      .maybeSingle(),
  ]);

  if (!student) redirect(reservationUrl(studentId, "student_not_operable"));
  if (!session) redirect(reservationUrl(studentId, "session_not_found"));

  const { data: eligibility, error: eligibilityError } = await supabase.rpc(
    "booking_eligibility",
    {
      target_session_id: sessionId,
      target_student_id: studentId,
    },
  );

  if (eligibilityError) {
    redirect(reservationUrl(studentId, "booking"));
  }

  const result = (eligibility ?? {}) as { eligible?: boolean; reason_code?: string | null };
  if (result.eligible !== true) {
    redirect(reservationUrl(studentId, result.reason_code ?? "booking"));
  }

  const { error } = await supabase.rpc("admin_book_student", {
    target_session_id: sessionId,
    target_student_id: studentId,
  });

  if (error) redirect(reservationUrl(studentId, error.message));

  revalidatePath("/admin");
  revalidatePath("/admin/agenda");
  revalidatePath(`/admin/agenda/${sessionId}`);
  revalidatePath(`/admin/alumnas/${studentId}`);

  redirect(`/admin/alumnas/${studentId}?alta=reserva_realizada`);
}
