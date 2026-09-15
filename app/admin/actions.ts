"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

function todayReturnUrl(returnDate: string) {
  return returnDate ? `/admin?date=${encodeURIComponent(returnDate)}` : "/admin";
}

function withQuery(url: string, key: string, value: string) {
  const [base, hash] = url.split("#", 2);
  const next = `${base}${base.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
  return hash ? `${next}#${hash}` : next;
}

function sessionReturnUrl(returnDate: string, sessionId: string) {
  const url = todayReturnUrl(returnDate);
  return sessionId ? `${url}#session-${sessionId}` : url;
}

function refreshSession(sessionId: string) {
  revalidatePath("/admin");
  revalidatePath(`/admin/agenda/${sessionId}`);
}

export async function bookStudentFromToday(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const studentId = String(formData.get("student_id") ?? "");
  const returnDate = String(formData.get("return_date") ?? "");
  const returnUrl = todayReturnUrl(returnDate);
  if (!sessionId || !studentId) redirect(withQuery(returnUrl, "error", "booking"));

  const { supabase, studio } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const { data: session } = await supabase
    .from("class_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("studio_id", studio.id)
    .single();
  if (!session) redirect(returnUrl);

  const { error } = await supabase.rpc("admin_book_student", {
    target_session_id: sessionId,
    target_student_id: studentId,
  });
  if (error) redirect(withQuery(sessionReturnUrl(returnDate, sessionId), "error", error.message));

  refreshSession(sessionId);
  redirect(withQuery(sessionReturnUrl(returnDate, sessionId), "created", "booking"));
}

export async function cancelReservationFromToday(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const reservationId = String(formData.get("reservation_id") ?? "");
  const returnDate = String(formData.get("return_date") ?? "");
  const returnUrl = todayReturnUrl(returnDate);
  if (!sessionId || !reservationId) redirect(withQuery(returnUrl, "error", "cancel"));

  const { supabase } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const { error } = await supabase.rpc("admin_cancel_reservation", {
    target_reservation_id: reservationId,
  });
  if (error) redirect(withQuery(sessionReturnUrl(returnDate, sessionId), "error", "cancel"));

  refreshSession(sessionId);
  redirect(withQuery(sessionReturnUrl(returnDate, sessionId), "created", "cancel"));
}

export async function setAttendanceFromToday(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const reservationId = String(formData.get("reservation_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const returnDate = String(formData.get("return_date") ?? "");
  const returnUrl = sessionReturnUrl(returnDate, sessionId);

  if (!sessionId || !reservationId || !["attended", "no_show"].includes(status)) {
    redirect(withQuery(returnUrl, "error", "attendance"));
  }

  const { supabase } = await getAdminContext(CAPABILITIES.ATTENDANCE_WRITE);
  const { error } = await supabase.rpc("set_attendance_status", {
    target_reservation_id: reservationId,
    target_status: status,
    target_reason: reason || null,
  });
  if (error) redirect(withQuery(returnUrl, "error", error.message));

  refreshSession(sessionId);
  redirect(withQuery(returnUrl, "created", status));
}

export async function finalizeAttendanceFromToday(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const returnDate = String(formData.get("return_date") ?? "");
  const returnUrl = sessionReturnUrl(returnDate, sessionId);
  if (!sessionId) redirect(withQuery(todayReturnUrl(returnDate), "error", "attendance"));

  const { supabase } = await getAdminContext(CAPABILITIES.ATTENDANCE_WRITE);
  const { error } = await supabase.rpc("finalize_attendance", { target_session_id: sessionId });
  if (error) redirect(withQuery(returnUrl, "error", error.message));

  refreshSession(sessionId);
  redirect(withQuery(returnUrl, "created", "attendance-finalized"));
}
