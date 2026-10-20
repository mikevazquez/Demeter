import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import StudentFiguresClient from "./StudentFiguresClient";

export default async function StudentFiguresPanel({
  studentId,
  canWrite,
}: {
  studentId: string;
  canWrite: boolean;
}) {
  const { supabase, studio } = await getAdminContext(CAPABILITIES.EVALUATIONS_READ);

  const [{ data: elements }, { data: progress }] = await Promise.all([
    supabase
      .from("technical_elements")
      .select("id,pole_catalog_slug")
      .eq("studio_id", studio.id)
      .eq("active", true)
      .not("pole_catalog_slug", "is", null),
    supabase
      .from("student_pole_figure_achievements")
      .select("figure_element_id")
      .eq("studio_id", studio.id)
      .eq("student_id", studentId),
  ]);

  const elementMap = (elements ?? [])
    .filter((item) => item.pole_catalog_slug)
    .map((item) => ({
      slug: item.pole_catalog_slug as string,
      elementId: item.id,
    }));

  const completedElementIds = (progress ?? []).map((item) => item.figure_element_id);

  return (
    <StudentFiguresClient
      studentId={studentId}
      canWrite={canWrite}
      elementMap={elementMap}
      completedElementIds={completedElementIds}
    />
  );
}
