"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getStudentPortalContext } from "@/lib/student/portal";

export async function enrollChallengeAction(formData: FormData) {
  const ruleId = String(formData.get("rule_id") ?? "").trim();
  if (!ruleId) redirect("/student/retos?error=challenge_required");

  const portal = await getStudentPortalContext();
  const { error } = await portal.supabase.rpc("student_enroll_reward_challenge", {
    p_rule_id: ruleId,
  });

  if (error) {
    redirect(`/student/retos/${ruleId}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/student/retos");
  revalidatePath(`/student/retos/${ruleId}`);
  redirect(`/student/retos/${ruleId}?joined=1`);
}
