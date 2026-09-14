"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { CAPABILITIES } from "@/lib/auth/capabilities";
import { getAdminContext } from "@/lib/auth/admin-context";

export async function bookStudent(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const studentId = String(formData.get("student_id") ?? "");
  if (!sessionId || !studentId) redirect(`/admin/agenda/${sessionId}?error=booking`);

  const { supabase, membership } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const { data: session } = await supabase
    .from("class_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("studio_id", membership.studio_id)
    .single();
  if (!session) redirect("/admin/agenda");

  const { error } = await supabase.rpc("admin_book_student", {
    target_session_id: sessionId,
    target_student_id: studentId,
  });
  if (error) redirect(`/admin/agenda/${sessionId}?error=${encodeURIComponent(error.message)}`);

  revalidatePath(`/admin/agenda/${sessionId}`);
  revalidatePath("/admin");
  redirect(`/admin/agenda/${sessionId}?created=booking`);
}

export async function cancelReservation(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const reservationId = String(formData.get("reservation_id") ?? "");
  if (!sessionId || !reservationId) redirect(`/admin/agenda/${sessionId}?error=cancel`);

  const { supabase } = await getAdminContext(CAPABILITIES.SCHEDULE_WRITE);
  const { error } = await supabase.rpc("admin_cancel_reservation", {
    target_reservation_id: reservationId,
  });
  if (error) redirect(`/admin/agenda/${sessionId}?error=cancel`);

  revalidatePath(`/admin/agenda/${sessionId}`);
  revalidatePath("/admin");
  redirect(`/admin/agenda/${sessionId}?created=cancel`);
}
