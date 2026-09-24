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


export async function archiveChallengeAction(formData: FormData) {
  const ruleId = String(formData.get("rule_id") ?? "").trim();
  if (!ruleId) redirect("/student/retos?error=challenge_required");

  const portal = await getStudentPortalContext();
  const { error } = await portal.supabase.rpc("student_archive_reward_challenge", {
    p_rule_id: ruleId,
  });

  if (error) {
    redirect(`/student/retos/${ruleId}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/student/retos");
  revalidatePath(`/student/retos/${ruleId}`);
  redirect("/student/retos?archived=1");
}


export async function claimChallengeCreditsAction(formData: FormData) {
  const ruleId = String(formData.get("rule_id") ?? "").trim();
  const rewardInstanceId = String(formData.get("reward_instance_id") ?? "").trim();

  if (!ruleId || !rewardInstanceId) {
    redirect("/student/retos?error=reward_required");
  }

  const portal = await getStudentPortalContext();
  const { error } = await portal.supabase.rpc("student_claim_reward_credits", {
    p_reward_instance_id: rewardInstanceId,
  });

  if (error) {
    redirect(`/student/retos/${ruleId}?error=${encodeURIComponent(error.message)}`);
  }

  revalidatePath("/student/retos");
  revalidatePath(`/student/retos/${ruleId}`);
  revalidatePath("/student/paquete");
  revalidatePath("/student/recompensas");
  revalidatePath("/student/recompensas/mis-recompensas");

  redirect(`/student/retos/${ruleId}?claimed=1`);
}
