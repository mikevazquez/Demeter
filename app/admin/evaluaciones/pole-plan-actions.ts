"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function back(evaluationId: string, params: Record<string, string> = {}): never {
  const path = `/admin/evaluaciones/${evaluationId}`;
  revalidatePath(path);
  const query = new URLSearchParams(params).toString();
  redirect(query ? `${path}?${query}` : path);
}

function poleError(message: string | undefined) {
  const known = [
    "pole_plan_invalid",
    "pole_plan_locked",
    "pole_plan_confirmation_required",
    "pole_plan_not_enough_figures",
    "forbidden",
  ];
  return known.find((code) => message?.includes(code)) ?? "pole_plan_failed";
}

export async function proposePolePlanAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_WRITE);
  const evaluationId = text(formData, "evaluation_id");
  const { error } = await ctx.supabase.rpc("staff_propose_pole_evaluation_plan", {
    p_evaluation: evaluationId,
  });
  back(evaluationId, error ? { pole: poleError(error.message) } : {});
}

export async function savePolePlanAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_WRITE);
  const evaluationId = text(formData, "evaluation_id");
  const combo = [0, 1, 2, 3].map((index) => text(formData, `combo_${index}`));
  const dictated = [0, 1, 2].map((index) => text(formData, `dictated_${index}`));
  if ([...combo, ...dictated].some((value) => !value))
    back(evaluationId, { pole: "pole_plan_invalid" });

  const { error } = await ctx.supabase.rpc("staff_set_pole_evaluation_plan", {
    p_evaluation: evaluationId,
    p_combo: combo,
    p_dictated: dictated,
  });
  back(evaluationId, error ? { pole: poleError(error.message) } : { pole: "saved" });
}

export async function confirmPoleFigureAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_WRITE);
  const evaluationId = text(formData, "evaluation_id");
  const { error } = await ctx.supabase.rpc("staff_confirm_pole_plan_figure", {
    p_evaluation: evaluationId,
    p_figure: text(formData, "figure_id"),
    p_confirmed: text(formData, "confirmed") === "true",
  });
  back(evaluationId, error ? { pole: poleError(error.message) } : {});
}

export async function startPolePlanAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_WRITE);
  const evaluationId = text(formData, "evaluation_id");
  const { error } = await ctx.supabase.rpc("staff_start_pole_evaluation_plan", {
    p_evaluation: evaluationId,
  });
  back(evaluationId, error ? { pole: poleError(error.message) } : {});
}
