"use server";

import { revalidatePath } from "next/cache";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

export async function setStudentFigureProgressAction(formData: FormData) {
  const studentId = String(formData.get("student_id") ?? "").trim();
  const elementId = String(formData.get("element_id") ?? "").trim();
  const completed = String(formData.get("completed") ?? "") === "true";

  if (!studentId || !elementId) {
    throw new Error("student_figure_progress_invalid");
  }

  const { supabase } = await getAdminContext(CAPABILITIES.EVALUATIONS_WRITE);
  const { error } = await supabase.rpc("set_student_technical_element_progress", {
    p_student_id: studentId,
    p_element_id: elementId,
    p_completed: completed,
  });

  if (error) {
    console.error("[catalog.progress] Could not update figure progress", {
      code: error.code,
      message: error.message.slice(0, 160),
    });
    throw new Error("student_figure_progress_update_failed");
  }

  revalidatePath(`/admin/alumnas/${studentId}`);
}
