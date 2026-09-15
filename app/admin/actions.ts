"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

function todayReturnUrl(returnDate: string) {
  return returnDate ? `/admin?date=${encodeURIComponent(returnDate)}` : "/admin";
}

function withQuery(url: string, key: string, value: string) {
  return `${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

export async function bookStudentFromToday(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const studentId = String(formData.get("student_id") ?? "");
  const returnUrl = todayReturnUrl(String(formData.get("return_date") ?? ""));
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
  if (error) redirect(withQuery(returnUrl, "error", error.message));

  revalidatePath("/admin");
  revalidatePath(`/admin/agenda/${sessionId}`);
  redirect(withQuery(returnUrl, "created", "booking"));
}

export async function cancelReservationFromToday(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const reservationId = String(formData.get("reservation_id") ?? "");
  const returnUrl = todayReturnUrl(String(formData.get("return_date") ?? ""));
  if (!sessionId || !reservationId) redirect(withQuery(returnUrl, "error", "cancel"));

  const { supabase } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const { error } = await supabase.rpc("admin_cancel_reservation", {
    target_reservation_id: reservationId,
  });
  if (error) redirect(withQuery(returnUrl, "error", "cancel"));

  revalidatePath("/admin");
  revalidatePath(`/admin/agenda/${sessionId}`);
  redirect(withQuery(returnUrl, "created", "cancel"));
}
