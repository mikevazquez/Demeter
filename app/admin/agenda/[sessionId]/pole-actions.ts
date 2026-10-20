"use server";

import { revalidatePath } from "next/cache";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

export async function markPoleFigureFromClassAction(formData: FormData) {
  const sessionId = String(formData.get("session_id") ?? "").trim();
  const studentId = String(formData.get("student_id") ?? "").trim();
  const elementId = String(formData.get("element_id") ?? "").trim();

  if (!sessionId || !studentId || !elementId) {
    throw new Error("pole_figure_mark_invalid");
  }

  const { supabase } = await getAdminContext(CAPABILITIES.EVALUATIONS_WRITE);
  const { error } = await supabase.rpc("set_student_pole_figure_achievement", {
    p_student_id: studentId,
    p_figure_element_id: elementId,
    p_completed: true,
    p_class_session_id: sessionId,
  });

  if (error) {
    console.error("[catalog.class-combo] Could not mark Pole figure", {
      code: error.code,
      message: error.message.slice(0, 160),
    });
    throw new Error("pole_figure_mark_failed");
  }

  revalidatePath(`/admin/agenda/${sessionId}`);
  revalidatePath("/admin");
  revalidatePath(`/admin/alumnas/${studentId}`);
  revalidatePath("/student/figuras");
}
