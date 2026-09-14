"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login/admin");

  const { data: membership } = await supabase
    .from("studio_memberships")
    .select("studio_id, role")
    .eq("user_id", user.id)
    .eq("active", true)
    .maybeSingle();

  if (!membership || !["owner", "admin"].includes(membership.role))
    redirect("/login/admin?error=access");
  return { supabase, studioId: membership.studio_id };
}

export async function bookStudent(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const studentId = String(formData.get("student_id") ?? "");
  if (!sessionId || !studentId) redirect(`/admin/agenda/${sessionId}?error=booking`);

  const { supabase, studioId } = await requireAdmin();
  const { data: session } = await supabase
    .from("class_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("studio_id", studioId)
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

  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc("admin_cancel_reservation", {
    target_reservation_id: reservationId,
  });
  if (error) redirect(`/admin/agenda/${sessionId}?error=cancel`);

  revalidatePath(`/admin/agenda/${sessionId}`);
  revalidatePath("/admin");
  redirect(`/admin/agenda/${sessionId}?created=cancel`);
}
