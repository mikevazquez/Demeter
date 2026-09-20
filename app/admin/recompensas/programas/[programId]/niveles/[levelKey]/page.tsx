import Link from "next/link";
import { notFound } from "next/navigation";

import { getAdminContext } from "@/lib/auth/admin-context";
import { CAPABILITIES } from "@/lib/auth/capabilities";

import { RewardsShell } from "../../../../RewardsNav";
import { ProgramLevelForm } from "../ProgramLevelForm";

export default async function EditProgramLevelPage({
  params,
}: {
  params: Promise<{ programId: string; levelKey: string }>;
}) {
  const { programId, levelKey } = await params;
  const ctx = await getAdminContext(CAPABILITIES.REWARDS_MANAGE);
  const { data: program } = await ctx.supabase
    .from("reward_programs")
    .select("id,latest_version_number,published_version_number")
    .eq("id", programId)
    .eq("studio_id", ctx.studio.id)
    .maybeSingle();
  if (!program || program.latest_version_number === program.published_version_number) notFound();

  const { data: level } = await ctx.supabase
    .from("reward_program_levels")
    .select(
      "level_key,level_order,title,description,rule_id,rule_version_number,level_visibility,reward_visibility",
    )
    .eq("program_id", programId)
    .eq("program_version_number", program.latest_version_number)
    .eq("level_key", decodeURIComponent(levelKey))
    .maybeSingle();
  if (!level) notFound();

  const { data: ruleVersion } = await ctx.supabase
    .from("reward_rule_versions")
    .select("condition_definition,reward_definition")
    .eq("rule_id", level.rule_id)
    .eq("version_number", level.rule_version_number)
    .maybeSingle();

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
        <h1 className="dashboard-title">{level.title}</h1>
      </header>
      <ProgramLevelForm
        programId={programId}
        level={level}
        ruleVersion={ruleVersion}
        nextOrder={level.level_order}
      />
    </RewardsShell>
  );
}
