import { redirect } from "next/navigation";
export default async function Page({ params }: { params: Promise<{ ruleId: string }> }) {
  const { ruleId } = await params;
  redirect(`/admin/recompensas/retos/${ruleId}`);
}
