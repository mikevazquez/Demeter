import type { getAdminContext } from "@/lib/auth/admin-context";
import {
  disciplineHasPoleCatalog,
  loadPoleCatalog,
  loadPoleStudents,
  loadSavedPolePlans,
} from "@/lib/pole/admin-data";
import type { PoleFigure } from "@/lib/pole/types";

import { PolePlanner } from "./PolePlanner";

type AdminSupabase = Awaited<ReturnType<typeof getAdminContext>>["supabase"];

/**
 * Sección "Figuras de Pole" del detalle de sesión. Sólo se muestra cuando la disciplina
 * de la clase tiene catálogo de figuras cargado.
 */
export async function PoleClassPanel({
  supabase,
  studioId,
  sessionId,
  disciplineId,
  students,
  canWrite,
}: {
  supabase: AdminSupabase;
  studioId: string;
  sessionId: string;
  disciplineId: string | null | undefined;
  students: { id: string; name: string }[];
  canWrite: boolean;
}) {
  if (!disciplineId || !(await disciplineHasPoleCatalog(supabase, studioId, disciplineId))) {
    return null;
  }

  const [catalog, poleStudents, savedPlans] = await Promise.all([
    loadPoleCatalog(supabase, studioId, disciplineId),
    loadPoleStudents(supabase, studioId, disciplineId, students),
    loadSavedPolePlans(supabase, sessionId),
  ]);

  const figures: PoleFigure[] = catalog
    .filter((figure) => figure.active)
    .map((figure) => ({
      id: figure.id,
      slug: figure.slug,
      name: figure.name,
      original_name: figure.original_name,
      level: figure.level,
      type: figure.type,
      family: figure.family,
      core: figure.core,
      sort_order: figure.sort_order,
      prerequisites: figure.prerequisites,
    }));

  return (
    <PolePlanner
      sessionId={sessionId}
      figures={figures}
      students={poleStudents}
      savedPlans={savedPlans}
      canWrite={canWrite}
    />
  );
}
