import { redirect } from "next/navigation";

export default async function LegacyEvaluationDisciplineConfigurationPage({
  params,
}: {
  params: Promise<{ disciplineId: string }>;
}) {
  const { disciplineId } = await params;
  redirect(`/admin/evaluaciones/disciplina/${disciplineId}`);
}
