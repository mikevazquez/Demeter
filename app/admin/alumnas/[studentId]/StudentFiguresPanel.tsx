import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import StudentFiguresClient from "./StudentFiguresClient";

type FigureRow = {
  elementId: string;
  slug: string;
  name: string;
  originalName: string;
  catalogLevel: string;
  type: string;
  family: string;
  inCoreProgram: boolean;
  completed: boolean;
};

function toCatalogLevel(title: string | null | undefined) {
  const normalized = (title ?? "").toLowerCase();
  if (normalized.includes("avanz")) return "avanzado";
  if (normalized.includes("inter")) return "intermedio";
  return "principiante";
}

export default async function StudentFiguresPanel({ studentId }: { studentId: string }) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.EVALUATIONS_READ);

  const { data: poleDiscipline } = await supabase
    .from("disciplines")
    .select("id,name")
    .eq("studio_id", studio.id)
    .ilike("name", "Pole Fitness")
    .eq("active", true)
    .maybeSingle();

  if (!poleDiscipline) {
    return (
      <section className="profile360-view-panel">
        <div className="empty-state">Pole Fitness no está configurado para este estudio.</div>
      </section>
    );
  }

  const { data: studentLevel } = await supabase
    .from("student_discipline_levels")
    .select("discipline_technical_level_id")
    .eq("studio_id", studio.id)
    .eq("student_id", studentId)
    .eq("discipline_id", poleDiscipline.id)
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  let currentLevelTitle = "Principiante";

  if (studentLevel?.discipline_technical_level_id) {
    const { data: disciplineLevel } = await supabase
      .from("discipline_technical_levels")
      .select("technical_level_id,discipline_order")
      .eq("studio_id", studio.id)
      .eq("id", studentLevel.discipline_technical_level_id)
      .maybeSingle();

    if (disciplineLevel?.technical_level_id) {
      const { data: levelDefinition } = await supabase
        .from("technical_level_definitions")
        .select("title")
        .eq("studio_id", studio.id)
        .eq("id", disciplineLevel.technical_level_id)
        .maybeSingle();

      if (levelDefinition?.title) {
        currentLevelTitle = levelDefinition.title;
      }
    }
  }

  const [{ data: profiles }, { data: elements }, { data: achievements }] = await Promise.all([
    supabase
      .from("pole_figure_profiles")
      .select(
        "element_id,slug,original_name,catalog_level,figure_type,family,in_core_program,sort_order",
      )
      .eq("studio_id", studio.id)
      .eq("discipline_id", poleDiscipline.id)
      .order("sort_order"),
    supabase
      .from("technical_elements")
      .select("id,name")
      .eq("studio_id", studio.id)
      .eq("discipline_id", poleDiscipline.id)
      .eq("active", true)
      .not("pole_catalog_slug", "is", null),
    supabase
      .from("student_pole_figure_achievements")
      .select("figure_element_id")
      .eq("studio_id", studio.id)
      .eq("student_id", studentId),
  ]);

  const nameByElement = new Map((elements ?? []).map((item) => [item.id, item.name]));
  const completed = new Set((achievements ?? []).map((item) => item.figure_element_id));

  const currentCatalogLevel = toCatalogLevel(currentLevelTitle);

  const figures: FigureRow[] = (profiles ?? [])
    .filter((profile) => profile.catalog_level === currentCatalogLevel)
    .map((profile) => ({
      elementId: profile.element_id,
      slug: profile.slug,
      name: nameByElement.get(profile.element_id) ?? profile.original_name,
      originalName: profile.original_name,
      catalogLevel: profile.catalog_level,
      type: profile.figure_type,
      family: profile.family,
      inCoreProgram: profile.in_core_program,
      completed: completed.has(profile.element_id),
    }));

  return (
    <StudentFiguresClient
      currentLevelTitle={currentLevelTitle}
      figures={figures}
      totalCatalogFigures={
        (profiles ?? []).filter((profile) => profile.catalog_level === currentCatalogLevel).length
      }
    />
  );
}
