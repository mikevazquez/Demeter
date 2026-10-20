import catalog from "@/app/admin/catalogo/pole-catalog-data.json";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import PoleClassComboClient, { type PoleComboRecommendation } from "./PoleClassComboClient";

type RosterStudent = {
  studentId: string;
  name: string;
};

type CatalogCombo = {
  nivel: "Principiante" | "Intermedio" | "Avanzado";
  figuras: string[];
};

const comboLevelRank: Record<CatalogCombo["nivel"], number> = {
  Principiante: 1,
  Intermedio: 2,
  Avanzado: 4,
};

export default async function PoleClassComboPanel({
  sessionId,
  disciplineId,
  roster,
}: {
  sessionId: string;
  disciplineId: string | null;
  roster: RosterStudent[];
}) {
  if (!disciplineId || !roster.length) return null;

  const { supabase, studio } = await getAdminContext(CAPABILITIES.EVALUATIONS_READ);
  const studentIds = roster.map((item) => item.studentId);

  const { count: poleFigureCount } = await supabase
    .from("pole_figure_profiles")
    .select("element_id", { count: "exact", head: true })
    .eq("studio_id", studio.id)
    .eq("discipline_id", disciplineId);

  if (!poleFigureCount) return null;

  const [
    { data: levelAssignments },
    { data: disciplineLevels },
    { data: levelDefinitions },
    { data: profiles },
    { data: elements },
    { data: achievements },
  ] = await Promise.all([
    supabase
      .from("student_discipline_levels")
      .select("student_id,discipline_technical_level_id,effective_from")
      .eq("studio_id", studio.id)
      .eq("discipline_id", disciplineId)
      .in("student_id", studentIds)
      .order("effective_from", { ascending: false }),
    supabase
      .from("discipline_technical_levels")
      .select("id,technical_level_id,discipline_order")
      .eq("studio_id", studio.id)
      .eq("discipline_id", disciplineId)
      .eq("active", true),
    supabase
      .from("technical_level_definitions")
      .select("id,title,level_order")
      .eq("studio_id", studio.id)
      .eq("active", true),
    supabase
      .from("pole_figure_profiles")
      .select("element_id,slug,original_name,catalog_level")
      .eq("studio_id", studio.id)
      .eq("discipline_id", disciplineId),
    supabase
      .from("technical_elements")
      .select("id,name")
      .eq("studio_id", studio.id)
      .eq("discipline_id", disciplineId)
      .eq("active", true)
      .not("pole_catalog_slug", "is", null),
    supabase
      .from("student_pole_figure_achievements")
      .select("student_id,figure_element_id")
      .eq("studio_id", studio.id)
      .in("student_id", studentIds),
  ]);

  const latestAssignmentByStudent = new Map<string, string>();
  for (const assignment of levelAssignments ?? []) {
    if (!latestAssignmentByStudent.has(assignment.student_id)) {
      latestAssignmentByStudent.set(assignment.student_id, assignment.discipline_technical_level_id);
    }
  }

  const levelDefinitionById = new Map((levelDefinitions ?? []).map((item) => [item.id, item]));
  const levelByDisciplineLevelId = new Map(
    (disciplineLevels ?? []).map((item) => {
      const definition = levelDefinitionById.get(item.technical_level_id);
      return [
        item.id,
        {
          title: definition?.title ?? "Principiante",
          order: definition?.level_order ?? item.discipline_order ?? 1,
        },
      ] as const;
    }),
  );

  const rosterWithLevel = roster.map((student) => {
    const levelId = latestAssignmentByStudent.get(student.studentId);
    const level = levelId ? levelByDisciplineLevelId.get(levelId) : null;
    return {
      ...student,
      levelTitle: level?.title ?? "Principiante",
      levelOrder: level?.order ?? 1,
    };
  });

  const groupLevelOrder = Math.min(...rosterWithLevel.map((student) => student.levelOrder));
  const profileBySlug = new Map((profiles ?? []).map((item) => [item.slug, item]));
  const nameByElement = new Map((elements ?? []).map((item) => [item.id, item.name]));
  const completedByStudent = new Map<string, Set<string>>();

  for (const student of rosterWithLevel) {
    completedByStudent.set(student.studentId, new Set());
  }
  for (const achievement of achievements ?? []) {
    completedByStudent.get(achievement.student_id)?.add(achievement.figure_element_id);
  }

  const candidates = (catalog.combos_base as CatalogCombo[])
    .filter((combo) => comboLevelRank[combo.nivel] <= groupLevelOrder)
    .map((combo, comboIndex) => {
      const figures = combo.figuras
        .map((slug) => profileBySlug.get(slug))
        .filter((item): item is NonNullable<typeof item> => Boolean(item));

      if (figures.length !== combo.figuras.length || !figures.length) return null;

      const missingCounts = figures.map(
        (figure) =>
          rosterWithLevel.filter(
            (student) => !completedByStudent.get(student.studentId)?.has(figure.element_id),
          ).length,
      );
      const newFigureIndex = missingCounts.reduce(
        (bestIndex, value, index, values) => (value > values[bestIndex] ? index : bestIndex),
        0,
      );
      const supportKnown = figures.reduce((score, figure, index) => {
        if (index === newFigureIndex) return score;
        return (
          score +
          rosterWithLevel.filter((student) =>
            completedByStudent.get(student.studentId)?.has(figure.element_id),
          ).length
        );
      }, 0);

      const newReach = missingCounts[newFigureIndex] ?? 0;
      const score = supportKnown * 100 + newReach * 10 - comboIndex / 1000;

      const recommendation: PoleComboRecommendation = {
        id: `${combo.nivel}-${combo.figuras.join("-")}`,
        level: combo.nivel,
        newFigureElementId: figures[newFigureIndex].element_id,
        figures: figures.map((figure, index) => ({
          elementId: figure.element_id,
          slug: figure.slug,
          name: nameByElement.get(figure.element_id) ?? figure.original_name,
          originalName: figure.original_name,
          status: index === newFigureIndex ? "new" : "review",
          students: rosterWithLevel.map((student) => ({
            studentId: student.studentId,
            name: student.name,
            levelTitle: student.levelTitle,
            completed:
              completedByStudent.get(student.studentId)?.has(figure.element_id) ?? false,
          })),
        })),
      };

      return { score, recommendation };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((left, right) => right.score - left.score)
    .slice(0, 5)
    .map((item) => item.recommendation);

  if (!candidates.length) return null;

  return (
    <PoleClassComboClient
      sessionId={sessionId}
      recommendations={candidates}
      studentCount={rosterWithLevel.length}
    />
  );
}
