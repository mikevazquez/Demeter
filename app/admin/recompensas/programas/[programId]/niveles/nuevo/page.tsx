import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { RewardsShell } from "../../../../RewardsNav";
import { ProgramLevelForm } from "../ProgramLevelForm";

export default async function NewProgramLevelPage({
  params,
}: {
  params: Promise<{ programId: string }>;
}) {
  const { programId } = await params;
  const ctx = await getAdminContext(CAPABILITIES.REWARDS_MANAGE);
  const { data: program } = await ctx.supabase
    .from("reward_programs")
    .select("id,latest_version_number,published_version_number")
    .eq("id", programId)
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();
  if (!program || program.latest_version_number === program.published_version_number) notFound();

  const { count } = await ctx.supabase
    .from("reward_program_levels")
    .select("id", { count: "exact", head: true })
    .eq("program_id", programId)
    .eq("program_version_number", program.latest_version_number);

  return (
    <RewardsShell>
      <header>
        <Link
          href={`/admin/recompensas/programas/${programId}`}
          className="text-sm font-semibold text-zinc-400 hover:text-white"
        >
          ← Programa
        </Link>
        <p className="mt-4 eyebrow">CONFIGURAR NIVEL</p>
        <h1 className="dashboard-title">Nuevo nivel</h1>
      </header>
      <ProgramLevelForm programId={programId} nextOrder={(count ?? 0) + 1} />
    </RewardsShell>
  );
}
