"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

export async function bookStudentFromToday(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "");
  const studentId = String(formData.get("student_id") ?? "");
  const returnDate = String(formData.get("return_date") ?? "");
  const returnUrl = returnDate ? `/admin?date=${encodeURIComponent(returnDate)}` : "/admin";
  if (!sessionId || !studentId) redirect(`${returnUrl}&error=booking`);

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
  if (error)
    redirect(
      `${returnUrl}${returnUrl.includes("?") ? "&" : "?"}error=${encodeURIComponent(error.message)}`,
    );

  revalidatePath("/admin");
  revalidatePath(`/admin/agenda/${sessionId}`);
  redirect(`${returnUrl}${returnUrl.includes("?") ? "&" : "?"}created=booking`);
}
