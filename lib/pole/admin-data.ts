import "server-only";

import type { getAdminContext } from "@/lib/auth/admin-context";

import { resolvePoleLevel, type PoleLevelMapRow } from "./levels";
import type { PoleCatalogLevel, PoleFigure, PoleGroupLevel } from "./types";

type AdminSupabase = Awaited<ReturnType<typeof getAdminContext>>["supabase"];

const PAGE = 1000;

/** PostgREST limita filas por respuesta; pedimos por páginas. */
async function fetchAllPages<T>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

type ProfileRow = {
  element_id: string;
  slug: string;
  original_name: string;
  catalog_level: PoleCatalogLevel;
  figure_type: string;
  family: string;
  in_core_program: boolean;
  book_page: number | null;
  sort_order: number;
  technical_elements: { name: string; active: boolean; description: string | null } | null;
};

export type AdminPoleFigure = PoleFigure & { book_page: number | null; active: boolean };

export async function disciplineHasPoleCatalog(
  supabase: AdminSupabase,
  studioId: string,
  disciplineId: string | null | undefined,
) {
  if (!disciplineId) return false;
  const { count } = await supabase
    .from("pole_figure_profiles")
    .select("element_id", { count: "exact", head: true })
    .eq("studio_id", studioId)
    .eq("discipline_id", disciplineId);
  return (count ?? 0) > 0;
}

export async function loadPoleCatalog(
  supabase: AdminSupabase,
  studioId: string,
  disciplineId: string,
): Promise<AdminPoleFigure[]> {
  const [profiles, prerequisites] = await Promise.all([
    fetchAllPages<ProfileRow>(
      (from, to) =>
        supabase
          .from("pole_figure_profiles")
          .select(
            "element_id,slug,original_name,catalog_level,figure_type,family,in_core_program,book_page,sort_order,technical_elements(name,active,description)",
          )
          .eq("studio_id", studioId)
          .eq("discipline_id", disciplineId)
          .order("sort_order")
          .range(from, to) as unknown as PromiseLike<{ data: ProfileRow[] | null; error: unknown }>,
    ),
    fetchAllPages<{ figure_element_id: string; required_element_id: string }>((from, to) =>
      supabase
        .from("pole_figure_prerequisites")
        .select("figure_element_id,required_element_id")
        .eq("studio_id", studioId)
        .range(from, to),
    ),
  ]);

  const prerequisitesByFigure = new Map<string, string[]>();
  for (const row of prerequisites) {
    const list = prerequisitesByFigure.get(row.figure_element_id) ?? [];
    list.push(row.required_element_id);
    prerequisitesByFigure.set(row.figure_element_id, list);
  }

  return profiles.map((row) => ({
    id: row.element_id,
    slug: row.slug,
    name: row.technical_elements?.name ?? row.original_name,
    original_name: row.original_name,
    description: row.technical_elements?.description ?? null,
    level: row.catalog_level,
    type: row.figure_type,
    family: row.family,
    core: row.in_core_program,
    sort_order: row.sort_order,
    prerequisites: prerequisitesByFigure.get(row.element_id) ?? [],
    book_page: row.book_page,
    active: row.technical_elements?.active ?? true,
  }));
}

export type AdminPoleStudent = {
  id: string;
  name: string;
  level: PoleGroupLevel | null;
  levelTitle: string | null;
  proEligible: boolean;
  achieved: string[];
  authorized: string[];
};

type LevelRow = {
  student_id: string;
  discipline_technical_levels: {
    technical_level_definitions: { level_key: string; title: string } | null;
  } | null;
};

export async function loadPoleStudents(
  supabase: AdminSupabase,
  studioId: string,
  disciplineId: string,
  students: { id: string; name: string }[],
): Promise<AdminPoleStudent[]> {
  if (!students.length) return [];
  const ids = students.map((student) => student.id);

  const [levels, levelMap, achievements, authorizations] = await Promise.all([
    supabase
      .from("student_discipline_levels")
      .select(
        "student_id,discipline_technical_levels(technical_level_definitions(level_key,title))",
      )
      .eq("studio_id", studioId)
      .eq("discipline_id", disciplineId)
      .in("student_id", ids),
    supabase
      .from("pole_level_map")
      .select("level_key,catalog_level,pro_eligible")
      .eq("studio_id", studioId),
    fetchAllPages<{ student_id: string; element_id: string }>((from, to) =>
      supabase
        .from("student_pole_achievements")
        .select("student_id,element_id")
        .eq("studio_id", studioId)
        .in("student_id", ids)
        .range(from, to),
    ),
    supabase
      .from("student_pole_authorizations")
      .select("student_id,element_id")
      .eq("studio_id", studioId)
      .in("student_id", ids)
      .is("revoked_at", null),
  ]);

  const overrides = (levelMap.data ?? []) as PoleLevelMapRow[];
  const levelByStudent = new Map(
    ((levels.data ?? []) as unknown as LevelRow[]).map((row) => [
      row.student_id,
      row.discipline_technical_levels?.technical_level_definitions ?? null,
    ]),
  );

  return students.map((student) => {
    const definition = levelByStudent.get(student.id) ?? null;
    const resolved = resolvePoleLevel(definition?.level_key, overrides);
    return {
      id: student.id,
      name: student.name,
      level: resolved.catalogLevel,
      levelTitle: definition?.title ?? null,
      proEligible: resolved.proEligible,
      achieved: achievements
        .filter((row) => row.student_id === student.id)
        .map((row) => row.element_id),
      authorized: (authorizations.data ?? [])
        .filter((row) => row.student_id === student.id)
        .map((row) => row.element_id),
    };
  });
}

export type SavedPolePlan = {
  catalog_level: PoleGroupLevel;
  element_ids: string[];
  new_element_id: string | null;
};

export async function loadSavedPolePlans(supabase: AdminSupabase, sessionId: string) {
  const { data } = await supabase
    .from("class_session_pole_plans")
    .select("catalog_level,element_ids,new_element_id")
    .eq("class_session_id", sessionId);
  return (data ?? []) as SavedPolePlan[];
}
