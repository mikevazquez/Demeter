import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { PoleStudentLevel } from "@/lib/pole/level-settings";

// POLE-01-14/16 · Read model for the figures of one Pole evaluation.

export type PolePlanFigure = { id: string; name: string };

export type PoleEvaluationPlanView = {
  levelKey: PoleStudentLevel;
  catalogLevel: string;
  combo: PolePlanFigure[];
  dictated: PolePlanFigure[];
  confirmed: string[];
  locked: boolean;
  candidates: PolePlanFigure[];
} | null;

export type PoleEvaluationContext = {
  isPole: boolean;
  levelKey: PoleStudentLevel | null;
  plan: PoleEvaluationPlanView;
};

export async function loadPoleEvaluationContext(
  supabase: SupabaseClient,
  studioId: string,
  evaluation: { id: string; discipline_id: string; template_version_id: string | null },
): Promise<PoleEvaluationContext> {
  if (!evaluation.template_version_id) return { isPole: false, levelKey: null, plan: null };

  const { data: generated, error } = await supabase
    .from("pole_generated_templates")
    .select("level_key")
    .eq("studio_id", studioId)
    .eq("template_version_id", evaluation.template_version_id)
    .maybeSingle();

  // Missing table (migration not applied) or a template not generated from the catalog.
  if (error || !generated) return { isPole: false, levelKey: null, plan: null };

  const { data: planRow } = await supabase
    .from("pole_evaluation_figure_plans")
    .select(
      "level_key,catalog_level,combo_figure_ids,dictated_figure_ids,confirmed_figure_ids,locked_at",
    )
    .eq("studio_id", studioId)
    .eq("evaluation_id", evaluation.id)
    .maybeSingle();

  if (!planRow) {
    return { isPole: true, levelKey: generated.level_key as PoleStudentLevel, plan: null };
  }

  const [{ data: profiles }, { data: mandatory }] = await Promise.all([
    supabase
      .from("pole_figure_profiles")
      .select("element_id,in_core_program,sort_order")
      .eq("studio_id", studioId)
      .eq("discipline_id", evaluation.discipline_id)
      .eq("catalog_level", planRow.catalog_level)
      .order("sort_order"),
    supabase
      .from("pole_level_mandatory_figures")
      .select("figure_element_id")
      .eq("studio_id", studioId)
      .eq("discipline_id", evaluation.discipline_id)
      .eq("level_key", planRow.level_key),
  ]);

  const mandatoryIds = new Set((mandatory ?? []).map((row) => row.figure_element_id as string));
  const candidateIds = (profiles ?? [])
    .filter((row) => row.in_core_program || planRow.catalog_level === "profesional")
    .map((row) => row.element_id as string)
    .filter((id) => !mandatoryIds.has(id));

  const planIds = [
    ...(planRow.combo_figure_ids as string[]),
    ...(planRow.dictated_figure_ids as string[]),
  ];
  const ids = [...new Set([...planIds, ...candidateIds])];
  const { data: elements } = ids.length
    ? await supabase.from("technical_elements").select("id,name,active").in("id", ids)
    : { data: [] as Array<{ id: string; name: string; active: boolean }> };

  const names = new Map((elements ?? []).map((row) => [row.id, row.name]));
  const active = new Set((elements ?? []).filter((row) => row.active).map((row) => row.id));
  const figure = (id: string): PolePlanFigure => ({ id, name: names.get(id) ?? "Figura" });

  return {
    isPole: true,
    levelKey: planRow.level_key as PoleStudentLevel,
    plan: {
      levelKey: planRow.level_key as PoleStudentLevel,
      catalogLevel: planRow.catalog_level as string,
      combo: (planRow.combo_figure_ids as string[]).map(figure),
      dictated: (planRow.dictated_figure_ids as string[]).map(figure),
      confirmed: (planRow.confirmed_figure_ids as string[]) ?? [],
      locked: Boolean(planRow.locked_at),
      candidates: candidateIds
        .filter((id) => active.has(id))
        .map(figure)
        .sort((a, b) => a.name.localeCompare(b.name, "es")),
    },
  };
}
