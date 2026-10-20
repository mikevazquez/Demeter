"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

function text(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

/** Crea una plantilla base por nivel desde el catálogo de figuras de Pole. */
export async function seedPoleEvaluationTemplatesAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_CONFIGURE);
  const disciplineId = text(formData, "discipline_id");
  const base = `/admin/evaluaciones/disciplina/${disciplineId}`;

  const { data, error } = await ctx.supabase.rpc("admin_seed_pole_evaluation_templates", {
    p_discipline_id: disciplineId,
  });

  if (error) {
    redirect(
      `${base}?error=${error.message.includes("pole_catalog_missing") ? "pole_catalog" : "pole_seed"}`,
    );
  }

  const created = Array.isArray((data as { created?: unknown[] } | null)?.created)
    ? (data as { created: unknown[] }).created.length
    : 0;

  revalidatePath("/admin/evaluaciones");
  revalidatePath(base);
  redirect(`${base}?seeded=${created}`);
}

export type PersonalItemResult = { ok: true } | { ok: false; message: string };

const PERSONAL_ITEM_ERRORS: Record<string, string> = {
  evaluation_not_editable: "La evaluación ya se publicó.",
  evaluation_access_denied: "No tienes permiso para calificar evaluaciones.",
  evaluation_personal_item_not_found: "Esta figura ya no está en la evaluación.",
};

/** Guarda Cumple / No cumple de una figura de la parte personalizada. */
export async function saveEvaluationPersonalItemAction(
  itemId: string,
  resultStatus: "meets" | "does_not_meet" | "not_evaluated",
  attemptCount: number | null,
  notes: string | null,
): Promise<PersonalItemResult> {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_WRITE);
  const { error } = await ctx.supabase.rpc("staff_save_evaluation_personal_item", {
    p_item_id: itemId,
    p_result_status: resultStatus,
    p_attempt_count: attemptCount,
    p_notes: notes,
  });

  if (error) {
    const code = Object.keys(PERSONAL_ITEM_ERRORS).find((key) => error.message.includes(key));
    return { ok: false, message: code ? PERSONAL_ITEM_ERRORS[code] : "No se pudo guardar." };
  }
  return { ok: true };
}

/** Vuelve a armar la parte personalizada (conserva lo ya calificado). */
export async function refreshEvaluationPersonalItemsAction(formData: FormData) {
  const ctx = await getAdminContext(CAPABILITIES.EVALUATIONS_WRITE);
  const evaluationId = text(formData, "evaluation_id");
  const { error } = await ctx.supabase.rpc("staff_refresh_evaluation_personal_items", {
    p_evaluation_id: evaluationId,
  });
  revalidatePath(`/admin/evaluaciones/${evaluationId}`);
  redirect(`/admin/evaluaciones/${evaluationId}${error ? "?error=personal" : "?refreshed=1"}`);
}
