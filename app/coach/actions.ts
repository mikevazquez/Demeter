"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getCoachContext } from "@/lib/auth/coach-context";

export type CoachWalkinLookupState = {
  status: "idle" | "invalid" | "not_found" | "found" | "already_in_roster" | "error";
  studentId?: string;
  studentName?: string;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isE164(value: string) {
  return /^\+[1-9][0-9]{7,14}$/.test(value);
}

function refreshCoachSession(sessionId: string) {
  revalidatePath(`/coach/clases/${sessionId}/roster`);
  revalidatePath(`/coach/clases/${sessionId}/resumen`);
  revalidatePath(`/coach/clases/${sessionId}/finalizada`);
  revalidatePath(`/coach/clases/${sessionId}`);
  revalidatePath("/coach");
}

export async function setCoachAttendanceAction(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const reservationId = String(formData.get("reservation_id") ?? "");
  const status = String(formData.get("status") ?? "");

  if (
    !isUuid(sessionId) ||
    !isUuid(reservationId) ||
    (status !== "attended" && status !== "no_show")
  ) {
    redirect("/coach?error=access");
  }

  const { supabase } = await getCoachContext(CAPABILITIES.ATTENDANCE_WRITE);
  const { error } = await supabase.rpc("set_attendance_status", {
    target_reservation_id: reservationId,
    target_status: status,
    target_reason: null,
  });

  refreshCoachSession(sessionId);
  const rosterPath = `/coach/clases/${sessionId}/roster`;

  if (error) redirect(`${rosterPath}?error=attendance`);
  redirect(`${rosterPath}?updated=1`);
}

export async function findCoachWalkinAction(
  _previousState: CoachWalkinLookupState,
  formData: FormData,
): Promise<CoachWalkinLookupState> {
  const sessionId = String(formData.get("session_id") ?? "");
  const phone = String(formData.get("phone") ?? "").trim();

  if (!isUuid(sessionId) || !isE164(phone)) return { status: "invalid" };

  const { supabase, studio } = await getCoachContext(CAPABILITIES.ATTENDANCE_WRITE);
  const { data, error } = await supabase.rpc("coach_find_walkin_student", {
    target_studio_id: studio.id,
    target_session_id: sessionId,
    target_phone: phone,
  });

  if (error) return { status: "error" };

  const result = data as {
    found?: boolean;
    student_id?: string;
    student_name?: string;
    already_in_roster?: boolean;
  } | null;

  if (!result?.found || !result.student_id || !result.student_name) {
    return { status: "not_found" };
  }

  if (result.already_in_roster) {
    return { status: "already_in_roster", studentName: result.student_name };
  }

  return {
    status: "found",
    studentId: result.student_id,
    studentName: result.student_name,
  };
}

export async function addCoachExistingWalkinAction(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const studentId = String(formData.get("student_id") ?? "");
  const walkinPath = `/coach/clases/${sessionId}/walk-in`;

  if (!isUuid(sessionId) || !isUuid(studentId)) redirect("/coach?error=access");

  const { supabase } = await getCoachContext(CAPABILITIES.ATTENDANCE_WRITE);
  const { error } = await supabase.rpc("add_existing_walkin_student", {
    target_session_id: sessionId,
    target_student_id: studentId,
  });

  refreshCoachSession(sessionId);
  if (error) redirect(`${walkinPath}?error=add`);
  redirect(`/coach/clases/${sessionId}/roster?walkin=1`);
}

export async function createCoachWalkinAction(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const firstName = String(formData.get("first_name") ?? "").trim();
  const lastName = String(formData.get("last_name") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const walkinPath = `/coach/clases/${sessionId}/walk-in`;

  if (!isUuid(sessionId)) redirect("/coach?error=access");
  if (!firstName || !isE164(phone)) redirect(`${walkinPath}?error=invalid`);

  const { supabase } = await getCoachContext(CAPABILITIES.ATTENDANCE_WRITE);
  const { error } = await supabase.rpc("create_walkin_student", {
    target_session_id: sessionId,
    p_first_name: firstName,
    p_last_name: lastName,
    p_phone: phone,
  });

  refreshCoachSession(sessionId);
  if (error?.message.includes("phone_exists")) redirect(`${walkinPath}?error=phone_exists`);
  if (error) redirect(`${walkinPath}?error=create`);
  redirect(`/coach/clases/${sessionId}/roster?walkin=1`);
}

export async function finalizeCoachAttendanceAction(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  if (!isUuid(sessionId)) redirect("/coach?error=access");

  const { supabase } = await getCoachContext(CAPABILITIES.ATTENDANCE_WRITE);
  const { error } = await supabase.rpc("finalize_attendance", {
    target_session_id: sessionId,
  });

  refreshCoachSession(sessionId);
  if (error) redirect(`/coach/clases/${sessionId}/resumen?error=finalize`);
  redirect(`/coach/clases/${sessionId}/finalizada`);
}

export async function correctCoachAttendanceAction(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const reservationId = String(formData.get("reservation_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const finalizedPath = `/coach/clases/${sessionId}/finalizada`;

  if (
    !isUuid(sessionId) ||
    !isUuid(reservationId) ||
    (status !== "attended" && status !== "no_show")
  ) {
    redirect("/coach?error=access");
  }
  if (!reason) redirect(`${finalizedPath}?error=reason`);

  const { supabase } = await getCoachContext(CAPABILITIES.ATTENDANCE_WRITE);
  const { error } = await supabase.rpc("set_attendance_status", {
    target_reservation_id: reservationId,
    target_status: status,
    target_reason: reason,
  });

  refreshCoachSession(sessionId);
  if (error) redirect(`${finalizedPath}?error=correction`);
  redirect(`${finalizedPath}?corrected=1`);
}
