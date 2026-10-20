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

const levelRank: Record<string, number> = {
  principiante: 1,
  intermedio: 2,
  avanzado: 4,
  profesional: 5,
  por_revisar: 99,
};

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
  let currentLevelOrder = 1;

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
        .select("title,level_order")
        .eq("studio_id", studio.id)
        .eq("id", disciplineLevel.technical_level_id)
        .maybeSingle();

      if (levelDefinition) {
        currentLevelTitle = levelDefinition.title;
        currentLevelOrder = levelDefinition.level_order ?? disciplineLevel.discipline_order ?? 1;
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

  const figures: FigureRow[] = (profiles ?? [])
    .filter((profile) => {
      const rank = levelRank[profile.catalog_level] ?? 99;
      return rank <= currentLevelOrder;
    })
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
      totalCatalogFigures={(profiles ?? []).length}
    />
  );
}
