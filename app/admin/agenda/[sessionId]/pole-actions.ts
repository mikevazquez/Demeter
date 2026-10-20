"use server";

import { revalidatePath } from "next/cache";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

type PoleResultEntry = {
  studentId: string;
  elementId: string;
};

export async function savePoleClassResultsAction(
  sessionId: string,
  entries: PoleResultEntry[],
): Promise<{ ok: true; saved: number }> {
  const normalizedSessionId = sessionId.trim();
  const normalizedEntries = entries
    .map((entry) => ({
      studentId: entry.studentId.trim(),
      elementId: entry.elementId.trim(),
    }))
    .filter((entry) => entry.studentId && entry.elementId);

  if (!normalizedSessionId) {
    throw new Error("pole_class_result_invalid");
  }

  const { supabase } = await getAdminContext(CAPABILITIES.EVALUATIONS_WRITE);

  for (const entry of normalizedEntries) {
    const { error } = await supabase.rpc("set_student_pole_figure_achievement", {
      p_student_id: entry.studentId,
      p_figure_element_id: entry.elementId,
      p_completed: true,
      p_class_session_id: normalizedSessionId,
    });

    if (error) {
      console.error("[catalog.class-combo] Could not save Pole class result", {
        code: error.code,
        message: error.message.slice(0, 160),
      });
      throw new Error("pole_class_result_save_failed");
    }

    revalidatePath(`/admin/alumnas/${entry.studentId}`);
  }

  revalidatePath(`/admin/agenda/${normalizedSessionId}`);
  revalidatePath("/admin");
  revalidatePath("/student/figuras");

  return { ok: true, saved: normalizedEntries.length };
}
