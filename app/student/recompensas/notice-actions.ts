"use server";

import { revalidatePath } from "next/cache";

import { getStudentPortalContext } from "@/lib/student/portal";

export async function acknowledgeRewardNoticesAction(formData: FormData) {
  const sourceKeys = formData
    .getAll("source_key")
    .map((value) => String(value).trim())
    .filter(Boolean)
    .slice(0, 20);

  if (!sourceKeys.length) return;

  const { supabase } = await getStudentPortalContext();
  const { error } = await supabase.rpc("student_ack_reward_notices", {
    p_source_keys: sourceKeys,
  });

  if (error) {
    throw new Error("student_reward_notice_ack_failed");
  }

  revalidatePath("/student", "layout");
}
