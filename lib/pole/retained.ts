// POLE-01-18 · Retained promotion: the student reached the minimum but still needs mandatory
// figures. Shown in the student profile (admin) and in the student portal.

import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type PoleRetainedPromotion = {
  evaluationId: string;
  toLevelTitle: string;
  missing: { id: string; name: string; achieved: boolean }[];
};

export async function loadPoleRetainedPromotion(
  supabase: SupabaseClient,
  studioId: string,
  studentId: string,
  disciplineId: string,
): Promise<PoleRetainedPromotion | null> {
  const { data: retained, error } = await supabase
    .from("pole_retained_promotions")
    .select("evaluation_id,to_level_id,missing_figure_ids")
    .eq("studio_id", studioId)
    .eq("student_id", studentId)
    .eq("discipline_id", disciplineId)
    .eq("status", "retained")
    .maybeSingle();
  // Missing table (migration not applied yet) or nothing retained.
  if (error || !retained) return null;

  const ids: string[] = retained.missing_figure_ids ?? [];
  const [{ data: level }, { data: elements }, { data: achievements }] = await Promise.all([
    supabase
      .from("discipline_technical_levels")
      .select("technical_level_id")
      .eq("studio_id", studioId)
      .eq("id", retained.to_level_id)
      .maybeSingle(),
    supabase.from("technical_elements").select("id,name").eq("studio_id", studioId).in("id", ids),
    supabase
      .from("student_pole_figure_achievements")
      .select("figure_element_id")
      .eq("studio_id", studioId)
      .eq("student_id", studentId)
      .in("figure_element_id", ids),
  ]);

  const nameById = new Map<string, string>(
    (elements ?? []).map((item: { id: string; name: string }) => [item.id, item.name]),
  );
  const achieved = new Set<string>(
    (achievements ?? []).map((item: { figure_element_id: string }) => item.figure_element_id),
  );
  const { data: definition } = level?.technical_level_id
    ? await supabase
        .from("technical_level_definitions")
        .select("title")
        .eq("studio_id", studioId)
        .eq("id", level.technical_level_id)
        .maybeSingle()
    : { data: null };
  const toLevelTitle: string = definition?.title ?? "el siguiente nivel";

  return {
    evaluationId: retained.evaluation_id,
    toLevelTitle,
    missing: ids.map((id) => ({
      id,
      name: nameById.get(id) ?? "Figura",
      achieved: achieved.has(id),
    })),
  };
}

export function retainedPromotionCopy(retained: PoleRetainedPromotion) {
  const pending = retained.missing.filter((figure) => !figure.achieved).map((f) => f.name);
  return {
    title: `Falta ${pending.length === 1 ? "1 figura" : `${pending.length} figuras`} para subir a ${retained.toLevelTitle}`,
    pending,
    detail:
      "Ya alcanzaste la calificación. Cuando tu coach marque estas figuras como logradas en clase, subes de nivel sin repetir la evaluación.",
  };
}
