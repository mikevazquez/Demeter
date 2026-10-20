import catalog from "@/app/admin/catalogo/pole-catalog-data.json";
import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import PoleClassComboClient, {
  type PoleClassGroup,
  type PoleComboRecommendation,
} from "./PoleClassComboClient";

type RosterStudent = {
  studentId: string;
  name: string;
};

type CatalogFigure = {
  id: string;
  nombre: string;
  nombre_es: string;
  nivel: "Principiante" | "Intermedio" | "Avanzado" | "Profesional" | "Por revisar";
  tipo: string;
  prerrequisitos_sugeridos: string[];
};

const catalogLevelOrder = {
  Principiante: 1,
  Intermedio: 2,
  Avanzado: 3,
} as const;

function toCatalogLevel(title: string | null | undefined): keyof typeof catalogLevelOrder {
  const normalized = (title ?? "").toLowerCase();

  if (normalized.includes("avanz")) return "Avanzado";
  if (normalized.includes("inter")) return "Intermedio";
  return "Principiante";
}

export default async function PoleClassComboPanel({
  sessionId,
  disciplineId,
  roster,
  canWrite,
}: {
  sessionId: string;
  disciplineId: string | null;
  roster: RosterStudent[];
  canWrite: boolean;
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
      latestAssignmentByStudent.set(
        assignment.student_id,
        assignment.discipline_technical_level_id,
      );
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

  const completedByStudent = new Map<string, Set<string>>();
  for (const student of roster) completedByStudent.set(student.studentId, new Set());
  for (const achievement of achievements ?? []) {
    completedByStudent.get(achievement.student_id)?.add(achievement.figure_element_id);
  }

  const profileBySlug = new Map((profiles ?? []).map((item) => [item.slug, item]));
  const slugByElementId = new Map((profiles ?? []).map((item) => [item.element_id, item.slug]));
  const nameByElement = new Map((elements ?? []).map((item) => [item.id, item.name]));
  const sourceFigures = catalog.figuras as CatalogFigure[];
  const sourceBySlug = new Map(sourceFigures.map((figure) => [figure.id, figure]));

  const students = roster.map((student) => {
    const levelId = latestAssignmentByStudent.get(student.studentId);
    const configuredLevel = levelId ? levelByDisciplineLevelId.get(levelId) : null;
    const catalogLevel = toCatalogLevel(configuredLevel?.title);
    const achievedSlugs = new Set(
      [...(completedByStudent.get(student.studentId) ?? [])]
        .map((elementId) => slugByElementId.get(elementId))
        .filter((slug): slug is string => Boolean(slug)),
    );
    const totalAtLevel = sourceFigures.filter((figure) => figure.nivel === catalogLevel).length;
    const completedAtLevel = sourceFigures.filter(
      (figure) => figure.nivel === catalogLevel && achievedSlugs.has(figure.id),
    ).length;

    return {
      ...student,
      levelTitle: configuredLevel?.title ?? "Principiante",
      catalogLevel,
      achievedSlugs,
      completedAtLevel,
      totalAtLevel,
    };
  });

  const grouped = new Map<keyof typeof catalogLevelOrder, typeof students>();
  for (const level of Object.keys(catalogLevelOrder) as Array<keyof typeof catalogLevelOrder>) {
    grouped.set(level, []);
  }
  for (const student of students) grouped.get(student.catalogLevel)?.push(student);

  const groups: PoleClassGroup[] = [];

  for (const level of Object.keys(catalogLevelOrder) as Array<keyof typeof catalogLevelOrder>) {
    const members = grouped.get(level) ?? [];
    if (!members.length) continue;

    const allKnow = (slug: string) => members.every((student) => student.achievedSlugs.has(slug));
    const nobodyKnows = (slug: string) => members.every((student) => !student.achievedSlugs.has(slug));

    const candidates = sourceFigures
      .filter(
        (figure) =>
          figure.nivel === level &&
          figure.prerrequisitos_sugeridos.length > 0 &&
          nobodyKnows(figure.id) &&
          figure.prerrequisitos_sugeridos.every(allKnow),
      )
      .sort(
        (left, right) =>
          Number(right.tipo === "Giro" || right.tipo === "Invertida") -
          Number(left.tipo === "Giro" || left.tipo === "Invertida"),
      );

    const known = sourceFigures.filter(
      (figure) =>
        figure.nivel !== "Profesional" &&
        figure.nivel !== "Por revisar" &&
        catalogLevelOrder[figure.nivel as keyof typeof catalogLevelOrder] <=
          catalogLevelOrder[level] &&
        allKnow(figure.id),
    );

    const recommendations: PoleComboRecommendation[] = candidates.slice(0, 12).map((candidate, index) => {
      const prerequisite =
        candidate.prerrequisitos_sugeridos.find((slug) => known.some((figure) => figure.id === slug)) ??
        null;
      const sameType = known.filter(
        (figure) => figure.id !== prerequisite && figure.tipo === candidate.tipo,
      );
      const otherKnown: CatalogFigure[] = [];

      for (let offset = 0; offset < sameType.length && otherKnown.length < 2; offset += 1) {
        const item = sameType[(offset + index * 2) % sameType.length];
        if (item && !otherKnown.some((figure) => figure.id === item.id)) otherKnown.push(item);
      }

      const sequence = [
        ...(prerequisite ? [sourceBySlug.get(prerequisite)] : []),
        candidate,
        ...otherKnown,
      ].filter((figure): figure is CatalogFigure => Boolean(figure));

      return {
        id: `${level}-${candidate.id}-${index}`,
        level,
        newFigureElementId: profileBySlug.get(candidate.id)?.element_id ?? "",
        newFigureSlug: candidate.id,
        figures: sequence.flatMap((figure) => {
          const profile = profileBySlug.get(figure.id);
          if (!profile) return [];

          return [
            {
              elementId: profile.element_id,
              slug: figure.id,
              name: nameByElement.get(profile.element_id) ?? figure.nombre_es ?? figure.nombre,
              originalName: figure.nombre,
              type: figure.tipo,
              status: figure.id === candidate.id ? ("new" as const) : ("review" as const),
            },
          ];
        }),
      };
    }).filter((recommendation) => recommendation.newFigureElementId && recommendation.figures.length >= 2);

    groups.push({
      level,
      label: members.length === 1 ? level : `${level}s`,
      members: members.map((student) => ({
        studentId: student.studentId,
        name: student.name,
        levelTitle: student.levelTitle,
        completedAtLevel: student.completedAtLevel,
        totalAtLevel: student.totalAtLevel,
      })),
      recommendations,
    });
  }

  return (
    <PoleClassComboClient
      sessionId={sessionId}
      groups={groups}
      canWrite={canWrite}
    />
  );
}
