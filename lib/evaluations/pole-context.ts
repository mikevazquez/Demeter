import "server-only";

import type { getAdminContext } from "@/lib/auth/admin-context";

import {
  baseItemHint,
  readiness,
  type BaseItemHint,
  type PersonalItem,
  type PersonalReason,
  type PoleAchievementSnapshot,
  type Readiness,
  type ResultStatus,
} from "./pole-adaptive";

export type PoleEvaluationContext = {
  /** Pista por figura de la plantilla, por id de elemento de plantilla. */
  baseHints: Record<string, BaseItemHint>;
  /** Figuras de la plantilla que son del catálogo de Pole (para "qué cambia en su portal"). */
  baseFigures: Record<string, { elementId: string; achievement: PoleAchievementSnapshot | null }>;
  personalItems: PersonalItem[];
  readiness: Readiness;
};

type AdminSupabase = Awaited<ReturnType<typeof getAdminContext>>["supabase"];

type TemplateElementRef = { id: string; elementId: string };

type AchievementRow = {
  figure_element_id: string;
  source: "student" | "instructor";
  achieved_at: string;
  validated_at: string | null;
};

/**
 * Carga lo que la evaluación necesita del módulo de figuras. Devuelve null si la disciplina
 * no tiene catálogo de figuras (por ejemplo, Telas o Yoga) o si algo del módulo no responde:
 * la evaluación funciona igual sin esta capa.
 */
export async function loadPoleEvaluationContext(
  supabase: AdminSupabase,
  input: {
    studioId: string;
    evaluationId: string;
    studentId: string | null;
    disciplineId: string;
    templateElements: TemplateElementRef[];
    todayIso: string;
  },
): Promise<PoleEvaluationContext | null> {
  const catalog = await supabase
    .from("pole_figure_profiles")
    .select("element_id", { count: "exact", head: true })
    .eq("studio_id", input.studioId)
    .eq("discipline_id", input.disciplineId);
  if (catalog.error || !catalog.count) return null;

  const personalResult = await supabase
    .from("technical_evaluation_personal_items")
    .select("id,element_id,reason,sort_order,result_status,attempt_count,notes")
    .eq("studio_id", input.studioId)
    .eq("evaluation_id", input.evaluationId)
    .order("sort_order");
  if (personalResult.error) return null;
  const personalRows = personalResult.data ?? [];

  const templateElementIds = input.templateElements.map((item) => item.elementId);
  const personalElementIds = personalRows.map((row) => row.element_id as string);
  const nextLevelIds = personalRows
    .filter((row) => row.reason === "next_level")
    .map((row) => row.element_id as string);

  const prerequisitesResult = nextLevelIds.length
    ? await supabase
        .from("pole_figure_prerequisites")
        .select("figure_element_id,required_element_id")
        .eq("studio_id", input.studioId)
        .in("figure_element_id", nextLevelIds)
    : { data: [], error: null };
  if (prerequisitesResult.error) return null;
  const prerequisiteRows = prerequisitesResult.data ?? [];

  const allIds = [
    ...new Set([
      ...templateElementIds,
      ...personalElementIds,
      ...prerequisiteRows.map((row) => row.required_element_id as string),
    ]),
  ];

  const [profilesResult, elementsResult, achievementsResult] = await Promise.all([
    allIds.length
      ? supabase
          .from("pole_figure_profiles")
          .select("element_id,figure_type")
          .eq("studio_id", input.studioId)
          .eq("discipline_id", input.disciplineId)
          .in("element_id", allIds)
      : Promise.resolve({ data: [], error: null }),
    allIds.length
      ? supabase
          .from("technical_elements")
          .select("id,name")
          .eq("studio_id", input.studioId)
          .in("id", allIds)
      : Promise.resolve({ data: [], error: null }),
    input.studentId && allIds.length
      ? supabase
          .from("student_pole_figure_achievements")
          .select("figure_element_id,source,achieved_at,validated_at")
          .eq("studio_id", input.studioId)
          .eq("student_id", input.studentId)
          .in("figure_element_id", allIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (profilesResult.error || elementsResult.error || achievementsResult.error) return null;

  const typeById = new Map(
    (profilesResult.data ?? []).map((row) => [row.element_id as string, row.figure_type as string]),
  );
  const nameById = new Map(
    (elementsResult.data ?? []).map((row) => [row.id as string, row.name as string]),
  );
  const achievementById = new Map<string, PoleAchievementSnapshot>(
    ((achievementsResult.data ?? []) as AchievementRow[]).map((row) => [
      row.figure_element_id,
      { source: row.source, achievedAt: row.achieved_at, validatedAt: row.validated_at },
    ]),
  );

  const baseHints: Record<string, BaseItemHint> = {};
  const baseFigures: PoleEvaluationContext["baseFigures"] = {};
  let baseTotal = 0;
  let baseAchieved = 0;
  for (const item of input.templateElements) {
    if (!typeById.has(item.elementId)) continue;
    const achievement = achievementById.get(item.elementId) ?? null;
    baseHints[item.id] = baseItemHint(achievement, input.todayIso);
    baseFigures[item.id] = { elementId: item.elementId, achievement };
    baseTotal += 1;
    if (achievement) baseAchieved += 1;
  }

  const prerequisitesByFigure = new Map<string, string[]>();
  for (const row of prerequisiteRows) {
    const list = prerequisitesByFigure.get(row.figure_element_id as string) ?? [];
    list.push(nameById.get(row.required_element_id as string) ?? "Figura previa");
    prerequisitesByFigure.set(row.figure_element_id as string, list);
  }

  const personalItems: PersonalItem[] = personalRows.map((row) => ({
    id: row.id as string,
    elementId: row.element_id as string,
    name: nameById.get(row.element_id as string) ?? "Figura",
    figureType: typeById.get(row.element_id as string) ?? "",
    reason: row.reason as PersonalReason,
    resultStatus: row.result_status as ResultStatus,
    attemptCount: Number(row.attempt_count ?? 0),
    notes: (row.notes as string | null) ?? "",
    prerequisites: prerequisitesByFigure.get(row.element_id as string) ?? [],
    achievement: achievementById.get(row.element_id as string) ?? null,
  }));

  return {
    baseHints,
    baseFigures,
    personalItems,
    readiness: readiness(baseAchieved, baseTotal),
  };
}
